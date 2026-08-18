#!/usr/bin/env node
/*
 * Coffee Cue print agent — runs on a venue machine (e.g. the Surface) and
 * bridges the cloud print queue to LAN thermal printers that can't (or
 * shouldn't) talk CloudPRNT themselves.
 *
 * How it works
 * ------------
 * For each printer in config.json the agent acts as that printer's
 * CloudPRNT client: it polls {cloudBase}/cloudprnt with the printer's MAC,
 * fetches the rendered 1-bit PNG when a job is ready, converts it to the
 * printer's native raster protocol, pushes it over TCP 9100, and confirms
 * (DELETE) back to the cloud with an honest result code — 200 on success,
 * 500 on failure so the cloud's retry accounting stays true.
 *
 * IMPORTANT: a printer is driven EITHER by its own native CloudPRNT client
 * OR by this agent — never both. Two pollers with the same MAC would steal
 * each other's jobs. The Star mC-Label3 supports CloudPRNT natively, but
 * ONLY over a network interface; point the agent at it when the printer is
 * USB-attached (see "cups" below) or when the venue network blocks the
 * printer's own outbound HTTPS.
 *
 * Protocol rules (do NOT mix):
 *   - protocol "star-raster"  -> Star printers ONLY (mC-Label3, TSP100…),
 *                                over TCP 9100. Needs "ip".
 *   - protocol "escpos"       -> Epson (and ESC/POS-compatible) ONLY,
 *                                over TCP 9100. Needs "ip".
 *   - protocol "cups"         -> ANY printer the host OS already prints to,
 *                                including USB-attached ones. Needs "queue"
 *                                (the CUPS queue name, `lpstat -p`). The
 *                                vendor driver does the rasterising, so we
 *                                hand it the PNG untouched and never build
 *                                raster bytes ourselves — which is why this
 *                                path is brand-agnostic.
 * Sending ESC/POS to a Star, or Star raster to an Epson, prints garbage.
 *
 * Crash safety: between fetch and confirm the PNG sits in spool/ on disk.
 * On startup any spooled jobs are printed (or re-confirmed) first, so a
 * crash or a dropped internet connection can't lose a fetched label.
 *
 * Zero dependencies — Node's stdlib only (http/https, net, zlib, fs).
 * The PNG decoder handles exactly what the server renders: 8-bit or 1-bit
 * greyscale, non-interlaced.
 *
 * Usage:
 *   node agent.js                  run (config.json next to this file)
 *   node agent.js --selftest x.png decode a PNG and print stats/preview
 *   node agent.js --once           one poll cycle then exit (for testing)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const net = require('net');
const http = require('http');
const https = require('https');
const zlib = require('zlib');
const { execFile } = require('child_process');

const HERE = __dirname;
const CONFIG_PATH = path.join(HERE, 'config.json');
const SPOOL_DIR = path.join(HERE, 'spool');
const LOG_PATH = path.join(HERE, 'agent.log');

// ---------------------------------------------------------------------------
// logging
// ---------------------------------------------------------------------------
function log(...args) {
  const line = `${new Date().toISOString()} ${args.join(' ')}`;
  console.log(line);
  try { fs.appendFileSync(LOG_PATH, line + '\n'); } catch (_) { /* best effort */ }
}

// ---------------------------------------------------------------------------
// config
// ---------------------------------------------------------------------------
function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    const example = path.join(HERE, 'config.example.json');
    log(`No config.json found. Copy ${example} to config.json and edit it.`);
    process.exit(1);
  }
  const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  cfg.pollIntervalMs = cfg.pollIntervalMs || 3000;
  cfg.port = cfg.port || 8631;
  cfg.printers = cfg.printers || [];
  for (const p of cfg.printers) {
    if (!['star-raster', 'escpos', 'cups'].includes(p.protocol)) {
      log(`Printer "${p.name}": unknown protocol "${p.protocol}" (use star-raster, escpos or cups)`);
      process.exit(1);
    }
    // "cups" hands off to the OS spooler, so it needs a queue name, not an
    // address. Catch the mix-up at startup rather than at the first label.
    if (p.protocol === 'cups') {
      if (!p.queue) {
        log(`Printer "${p.name}": protocol "cups" needs "queue" (see \`lpstat -p\`)`);
        process.exit(1);
      }
    } else if (!p.ip) {
      log(`Printer "${p.name}": protocol "${p.protocol}" needs "ip" (TCP 9100)`);
      process.exit(1);
    }
    p.port = p.port || 9100;
    p.state = { lastPollOk: null, lastPollAt: null, lastPrintAt: null, lastError: null };
  }
  return cfg;
}

// ---------------------------------------------------------------------------
// minimal PNG decoder (greyscale bit depth 1 or 8, non-interlaced — exactly
// what services/label_printer.py emits)
// ---------------------------------------------------------------------------
function decodePng(buf) {
  const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!buf.subarray(0, 8).equals(SIG)) throw new Error('not a PNG');
  let pos = 8;
  let ihdr = null;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      ihdr = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        interlace: data[12],
      };
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + len; // len + type + data + crc
  }
  if (!ihdr) throw new Error('PNG missing IHDR');
  if (ihdr.colorType !== 0) throw new Error(`unsupported PNG colorType ${ihdr.colorType} (need greyscale)`);
  if (![1, 8].includes(ihdr.bitDepth)) throw new Error(`unsupported PNG bitDepth ${ihdr.bitDepth}`);
  if (ihdr.interlace !== 0) throw new Error('interlaced PNG not supported');

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const rowBytes = Math.ceil(ihdr.width * ihdr.bitDepth / 8);
  const bpp = Math.max(1, ihdr.bitDepth / 8); // filter step is 1 byte for depth<=8 greyscale
  const out = Buffer.alloc(ihdr.height * rowBytes);

  let prev = Buffer.alloc(rowBytes); // zero row above the image
  for (let y = 0; y < ihdr.height; y++) {
    const filter = raw[y * (rowBytes + 1)];
    const row = Buffer.from(raw.subarray(y * (rowBytes + 1) + 1, (y + 1) * (rowBytes + 1)));
    for (let x = 0; x < rowBytes; x++) {
      const a = x >= bpp ? row[x - bpp] : 0;       // left (already reconstructed)
      const b = prev[x];                            // up
      const c = x >= bpp ? prev[x - bpp] : 0;       // up-left
      switch (filter) {
        case 0: break;                                            // None
        case 1: row[x] = (row[x] + a) & 0xff; break;              // Sub
        case 2: row[x] = (row[x] + b) & 0xff; break;              // Up
        case 3: row[x] = (row[x] + ((a + b) >> 1)) & 0xff; break; // Average
        case 4: {                                                 // Paeth
          const pp = a + b - c;
          const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
          const pred = (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
          row[x] = (row[x] + pred) & 0xff;
          break;
        }
        default: throw new Error(`unknown PNG filter ${filter}`);
      }
    }
    row.copy(out, y * rowBytes);
    prev = row;
  }
  return { ...ihdr, rowBytes, data: out };
}

/**
 * Convert a decoded greyscale PNG to printer raster rows:
 * Buffer of ceil(width/8) bytes per row, MSB-first, 1 = BLACK dot
 * (PNG greyscale is the opposite: 1/255 = white).
 */
function pngToRasterRows(png) {
  const outRowBytes = Math.ceil(png.width / 8);
  const rows = Buffer.alloc(png.height * outRowBytes);
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      let white;
      if (png.bitDepth === 1) {
        const byte = png.data[y * png.rowBytes + (x >> 3)];
        white = (byte >> (7 - (x & 7))) & 1;
      } else {
        white = png.data[y * png.rowBytes + x] >= 128 ? 1 : 0;
      }
      if (!white) {
        rows[y * outRowBytes + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
  }
  return { rows, rowBytes: outRowBytes, width: png.width, height: png.height };
}

// ---------------------------------------------------------------------------
// raster protocols
// ---------------------------------------------------------------------------

/**
 * Star raster mode (StarPRNT / Star line mode raster, as used by Star's own
 * raster drivers): ESC*rA enter, ESC*rP0 continuous page, one 'b' band per
 * dot line, ESC FF NUL print+cut, ESC*rB quit.
 * ⚠ HARDWARE-PENDING: validated against Star documentation, not yet against
 * the physical mC-Label3 — its native CloudPRNT path is the primary and is
 * fully verified. Test with a single label before an event.
 */
function buildStarRaster(raster) {
  const parts = [];
  parts.push(Buffer.from('\x1b*rA', 'binary'));        // enter raster mode
  parts.push(Buffer.from('\x1b*rP0\x00', 'binary'));   // continuous page length
  const n1 = raster.rowBytes & 0xff;
  const n2 = (raster.rowBytes >> 8) & 0xff;
  for (let y = 0; y < raster.height; y++) {
    parts.push(Buffer.from([0x62, n1, n2]));           // 'b' n1 n2
    parts.push(raster.rows.subarray(y * raster.rowBytes, (y + 1) * raster.rowBytes));
  }
  parts.push(Buffer.from('\x1b\x0c\x00', 'binary'));   // ESC FF NUL: print & cut
  parts.push(Buffer.from('\x1b*rB', 'binary'));        // quit raster mode
  return Buffer.concat(parts);
}

/**
 * ESC/POS raster bit image (GS v 0) — Epson TM series and compatibles.
 * Sent in bands of <=255 dot lines because yH counts 256s and some firmware
 * chokes on tall single blocks.
 */
function buildEscposRaster(raster) {
  const parts = [];
  parts.push(Buffer.from('\x1b@', 'binary')); // initialize
  const BAND = 255;
  for (let y0 = 0; y0 < raster.height; y0 += BAND) {
    const h = Math.min(BAND, raster.height - y0);
    parts.push(Buffer.from([0x1d, 0x76, 0x30, 0x00,
      raster.rowBytes & 0xff, (raster.rowBytes >> 8) & 0xff,
      h & 0xff, (h >> 8) & 0xff]));
    parts.push(raster.rows.subarray(y0 * raster.rowBytes, (y0 + h) * raster.rowBytes));
  }
  parts.push(Buffer.from('\x1dV\x42\x10', 'binary')); // partial cut with feed
  return Buffer.concat(parts);
}

function buildRasterFor(printer, png) {
  const raster = pngToRasterRows(png);
  return printer.protocol === 'star-raster'
    ? buildStarRaster(raster)
    : buildEscposRaster(raster);
}

// ---------------------------------------------------------------------------
// TCP 9100 dispatch
// ---------------------------------------------------------------------------
function sendToPrinter(printer, bytes) {
  return new Promise((resolve) => {
    const sock = net.createConnection({ host: printer.ip, port: printer.port, timeout: 8000 });
    let settled = false;
    const done = (ok, detail) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      resolve({ ok, detail });
    };
    sock.on('connect', () => {
      sock.write(bytes, () => {
        // Give the printer a moment to drain before closing.
        setTimeout(() => sock.end(), 400);
      });
    });
    sock.on('close', () => done(true, `sent ${bytes.length} bytes to ${printer.ip}:${printer.port}`));
    sock.on('timeout', () => done(false, `timeout connecting to ${printer.ip}:${printer.port}`));
    sock.on('error', (e) => done(false, `printer ${printer.ip}:${printer.port} unreachable: ${e.message}`));
  });
}

// ---------------------------------------------------------------------------
// tiny 1-bit PNG encoder (self-test pattern only)
// ---------------------------------------------------------------------------
// The CUPS path sends images, not raster, so the local test pattern has to be
// wrapped as a PNG. Mirrors what the server renders: greyscale, bit depth 1.
function encodeGreyPng(raster) {
  const { rows, rowBytes, width, height } = raster;
  // PNG rows are filter-byte prefixed; 1 = black in our raster, 0 in PNG.
  const raw = Buffer.alloc(height * (rowBytes + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (rowBytes + 1)] = 0; // filter: none
    for (let x = 0; x < rowBytes; x++) {
      raw[y * (rowBytes + 1) + 1 + x] = ~rows[y * rowBytes + x] & 0xff;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 1;  // bit depth
  ihdr[9] = 0;  // greyscale
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------------------
// CUPS dispatch (USB / any OS-installed printer)
// ---------------------------------------------------------------------------
// The vendor driver owns the rasterising here, so the PNG goes to `lp`
// exactly as the server rendered it. `lp` returns as soon as the spooler
// ACCEPTS the file, which is NOT proof it reached the printer — so we then
// wait for the job to leave the queue before reporting success, keeping the
// cloud's retry accounting honest (a job stuck on a paper-out printer must
// not be confirmed as printed).
function sendToCups(printer, pngPath) {
  return new Promise((resolve) => {
    const buf = fs.readFileSync(pngPath);
    const dots = { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };  // PNG IHDR
    const dpi = printer.dpi || 203;
    // Size the PAGE to the image and declare the image's true resolution, so
    // CUPS maps one dot to one dot. Do NOT use fit-to-page: it stretches the
    // label to whatever media the driver has selected (a Star mC-Label3
    // defaults to 72mm) and the design overflows narrower stock. Deriving the
    // page per job — rather than hardcoding a label size — is also what lets
    // grow-mode labels and the 30cm banners come out at their real length.
    const mm = (d) => (d / dpi * 25.4).toFixed(1);
    const args = [
      '-d', printer.queue,
      '-o', `PageSize=Custom.${mm(dots.w)}x${mm(dots.h)}mm`,
      '-o', `ppi=${dpi}`,
    ];
    for (const [k, v] of Object.entries(printer.cupsOptions || {})) {
      args.push('-o', `${k}=${v}`);
    }
    args.push(pngPath);
    execFile('lp', args, { timeout: 15000 }, (err, stdout, stderr) => {
      if (err) {
        return resolve({ ok: false, detail: `lp failed: ${(stderr || err.message).trim()}` });
      }
      const geom = `${dots.w}x${dots.h} dots -> ${mm(dots.w)}x${mm(dots.h)}mm @${dpi}dpi`;
      const m = String(stdout).match(/request id is (\S+)/);
      const jobId = m ? m[1] : null;
      if (!jobId) return resolve({ ok: true, detail: `queued on ${printer.queue} (${geom})` });
      waitForCupsJob(printer, jobId, resolve, 0, geom);
    });
  });
}

// Poll `lpstat` until the job drains out of the queue. Anything still sitting
// there after the grace period is treated as a failure — better a duplicate
// label after a genuine retry than a silently lost one.
function waitForCupsJob(printer, jobId, resolve, waitedMs = 0, geom = '') {
  const STEP = 500;
  const LIMIT = 20000;
  execFile('lpstat', ['-o', printer.queue], { timeout: 5000 }, (err, stdout) => {
    const stillQueued = !err && String(stdout).includes(jobId);
    if (!stillQueued) {
      return resolve({ ok: true, detail: `printed via CUPS queue ${printer.queue} (${jobId}; ${geom})` });
    }
    if (waitedMs >= LIMIT) {
      return resolve({ ok: false, detail: `${jobId} still queued on ${printer.queue} after ${LIMIT / 1000}s — printer offline, out of paper or paused?` });
    }
    setTimeout(() => waitForCupsJob(printer, jobId, resolve, waitedMs + STEP, geom), STEP);
  });
}

// ---------------------------------------------------------------------------
// cloud queue client (CloudPRNT on behalf of the printer)
// ---------------------------------------------------------------------------
function cloudRequest(cfg, method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(cfg.cloudBase + urlPath);
    const mod = url.protocol === 'https:' ? https : http;
    const payload = body ? JSON.stringify(body) : null;
    const req = mod.request(url, {
      method,
      headers: payload
        ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
        : {},
      timeout: 15000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    });
    req.on('timeout', () => { req.destroy(new Error('cloud request timeout')); });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function spoolPaths(token) {
  return {
    png: path.join(SPOOL_DIR, `${token}.png`),
    meta: path.join(SPOOL_DIR, `${token}.json`),
  };
}

async function printSpooledJob(cfg, printer, token) {
  const { png: pngPath, meta: metaPath } = spoolPaths(token);
  // CUPS takes the PNG as-is; only the TCP paths need raster conversion.
  let result;
  if (printer.protocol === 'cups') {
    result = await sendToCups(printer, pngPath);
  } else {
    const png = decodePng(fs.readFileSync(pngPath));
    result = await sendToPrinter(printer, buildRasterFor(printer, png));
  }
  const code = result.ok ? '200' : '500';
  // Honest confirm: 200 only when the transport really delivered.
  try {
    await cloudRequest(cfg, 'DELETE',
      `/cloudprnt?token=${encodeURIComponent(token)}&mac=${encodeURIComponent(printer.mac)}&code=${code}`);
    fs.unlinkSync(pngPath);
    fs.unlinkSync(metaPath);
  } catch (e) {
    // Cloud unreachable: keep the spool entry so the confirm retries on the
    // next cycle. If we DID print, remember that so we never print twice.
    if (result.ok) {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      if (!meta.printedAt) {
        meta.printedAt = new Date().toISOString();
        fs.writeFileSync(metaPath, JSON.stringify(meta));
      }
    }
    throw e;
  }
  if (result.ok) {
    printer.state.lastPrintAt = new Date().toISOString();
    printer.state.lastError = null;
    log(`[${printer.name}] printed job ${token} (${result.detail})`);
  } else {
    printer.state.lastError = result.detail;
    log(`[${printer.name}] print FAILED for job ${token}: ${result.detail} (reported code=500, cloud will retry)`);
  }
  return result.ok;
}

async function recoverSpool(cfg) {
  if (!fs.existsSync(SPOOL_DIR)) return;
  for (const f of fs.readdirSync(SPOOL_DIR)) {
    if (!f.endsWith('.json')) continue;
    const token = f.replace(/\.json$/, '');
    let meta;
    try { meta = JSON.parse(fs.readFileSync(path.join(SPOOL_DIR, f), 'utf8')); } catch (_) { continue; }
    const printer = (cfg.printers || []).find((p) => p.mac === meta.mac);
    if (!printer) continue;
    try {
      if (meta.printedAt) {
        // Printed but never confirmed — just confirm, don't print again.
        await cloudRequest(cfg, 'DELETE',
          `/cloudprnt?token=${encodeURIComponent(token)}&mac=${encodeURIComponent(printer.mac)}&code=200`);
        const sp = spoolPaths(token);
        fs.unlinkSync(sp.png);
        fs.unlinkSync(sp.meta);
        log(`[${printer.name}] confirmed previously-printed job ${token}`);
      } else {
        await printSpooledJob(cfg, printer, token);
      }
    } catch (e) {
      log(`[${printer.name}] spool recovery for ${token} deferred: ${e.message}`);
    }
  }
}

async function pollPrinter(cfg, printer) {
  const poll = await cloudRequest(cfg, 'POST', '/cloudprnt', {
    printerMAC: printer.mac,
    statusCode: '200 OK',
  });
  printer.state.lastPollAt = new Date().toISOString();
  if (poll.status !== 200) {
    printer.state.lastPollOk = false;
    throw new Error(`poll HTTP ${poll.status}`);
  }
  printer.state.lastPollOk = true;
  const body = JSON.parse(poll.body.toString('utf8'));
  if (!body.jobReady || !body.jobToken) return false;

  const token = body.jobToken;
  const fetchRes = await cloudRequest(cfg, 'GET',
    `/cloudprnt?token=${encodeURIComponent(token)}&mac=${encodeURIComponent(printer.mac)}&type=image%2Fpng`);
  if (fetchRes.status !== 200) throw new Error(`job fetch HTTP ${fetchRes.status}`);

  fs.mkdirSync(SPOOL_DIR, { recursive: true });
  const sp = spoolPaths(token);
  fs.writeFileSync(sp.png, fetchRes.body);
  fs.writeFileSync(sp.meta, JSON.stringify({
    mac: printer.mac, fetchedAt: new Date().toISOString(),
  }));
  await printSpooledJob(cfg, printer, token);
  return true; // there may be more jobs — caller loops
}

// ---------------------------------------------------------------------------
// local status server (port 8631)
// ---------------------------------------------------------------------------
function startStatusServer(cfg) {
  const server = http.createServer(async (req, res) => {
    const send = (code, obj) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(obj, null, 2));
    };
    try {
      if (req.method === 'GET' && req.url === '/health') {
        const spool = fs.existsSync(SPOOL_DIR)
          ? fs.readdirSync(SPOOL_DIR).filter((f) => f.endsWith('.json')).length : 0;
        send(200, {
          ok: true,
          cloudBase: cfg.cloudBase,
          spooledJobs: spool,
          printers: cfg.printers.map((p) => ({
            name: p.name, mac: p.mac, ip: p.ip, protocol: p.protocol, ...p.state,
          })),
        });
      } else if (req.method === 'POST' && req.url === '/test') {
        let raw = '';
        req.on('data', (c) => { raw += c; });
        req.on('end', async () => {
          try {
            const body = raw ? JSON.parse(raw) : {};
            const printer = cfg.printers.find(
              (p) => p.name === body.printer || p.mac === body.printer
            ) || cfg.printers[0];
            if (!printer) return send(404, { ok: false, message: 'no printers configured' });
            // Local test pattern: alternating rule lines + a solid bar,
            // generated directly (no PNG involved) to isolate transport.
            const rowBytes = 50; // 400 dots
            const height = 120;
            const rows = Buffer.alloc(height * rowBytes);
            for (let y = 0; y < height; y++) {
              for (let x = 0; x < rowBytes; x++) {
                rows[y * rowBytes + x] =
                  y < 20 ? 0xff : (y % 20 < 2 ? 0xff : (x % 8 === 0 ? 0x80 : 0));
              }
            }
            const raster = { rows, rowBytes, width: rowBytes * 8, height };
            let result;
            if (printer.protocol === 'cups') {
              // No raster for CUPS — the driver wants an image, so write the
              // pattern out as a PNG and spool it like any other label.
              const tmp = path.join(SPOOL_DIR, 'selftest.png');
              fs.mkdirSync(SPOOL_DIR, { recursive: true });
              fs.writeFileSync(tmp, encodeGreyPng(raster));
              result = await sendToCups(printer, tmp);
              try { fs.unlinkSync(tmp); } catch (_) { /* best effort */ }
            } else {
              const bytes = printer.protocol === 'star-raster'
                ? buildStarRaster(raster) : buildEscposRaster(raster);
              result = await sendToPrinter(printer, bytes);
            }
            send(result.ok ? 200 : 502, { ok: result.ok, detail: result.detail });
          } catch (e) {
            send(500, { ok: false, message: e.message });
          }
        });
      } else {
        send(404, { ok: false, message: 'GET /health or POST /test {"printer":"name-or-mac"}' });
      }
    } catch (e) {
      send(500, { ok: false, message: e.message });
    }
  });
  server.listen(cfg.port, '127.0.0.1', () => {
    log(`status server on http://127.0.0.1:${cfg.port}/health`);
  });
  return server;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
async function mainLoop(cfg, once) {
  await recoverSpool(cfg).catch((e) => log(`spool recovery: ${e.message}`));
  /* eslint-disable no-await-in-loop */
  do {
    for (const printer of cfg.printers) {
      try {
        // Drain: keep polling while jobs are ready (multiple orders queued).
        let more = true;
        let guard = 0;
        while (more && guard < 20) {
          more = await pollPrinter(cfg, printer);
          guard += 1;
        }
      } catch (e) {
        printer.state.lastError = e.message;
        log(`[${printer.name}] cycle error: ${e.message}`);
      }
    }
    if (!once) await new Promise((r) => setTimeout(r, cfg.pollIntervalMs));
  } while (!once);
  /* eslint-enable no-await-in-loop */
}

function selftest(file) {
  const png = decodePng(fs.readFileSync(file));
  const raster = pngToRasterRows(png);
  let black = 0;
  for (const b of raster.rows) { let v = b; while (v) { black += v & 1; v >>= 1; } }
  console.log(`decoded ${png.width}x${png.height} bitDepth=${png.bitDepth} black_dots=${black}`);
  // ASCII preview, downsampled to <=80 columns.
  const step = Math.max(1, Math.ceil(png.width / 80));
  for (let y = 0; y < png.height; y += step * 2) {
    let line = '';
    for (let x = 0; x < png.width; x += step) {
      const bit = raster.rows[y * raster.rowBytes + (x >> 3)] & (0x80 >> (x & 7));
      line += bit ? '#' : ' ';
    }
    console.log(line);
  }
  const star = buildStarRaster(raster);
  const escpos = buildEscposRaster(raster);
  console.log(`star-raster bytes=${star.length}  escpos bytes=${escpos.length}`);
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args[0] === '--selftest') {
    if (!args[1]) { console.error('usage: node agent.js --selftest label.png'); process.exit(1); }
    selftest(args[1]);
  } else {
    const cfg = loadConfig();
    const once = args.includes('--once');
    log(`Coffee Cue print agent starting — ${cfg.printers.length} printer(s), cloud ${cfg.cloudBase}`);
    // The status server holds the event loop open, so --once would drain the
    // queue and then hang forever instead of exiting. A one-shot run has
    // nothing to serve anyway.
    if (!once) startStatusServer(cfg);
    mainLoop(cfg, once).then(() => {
      if (once) { log('one-shot cycle complete'); process.exit(0); }
    }).catch((e) => {
      log(`fatal: ${e.message}`);
      process.exit(1);
    });
  }
}

module.exports = { decodePng, pngToRasterRows, buildStarRaster, buildEscposRaster };
