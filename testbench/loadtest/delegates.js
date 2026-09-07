#!/usr/bin/env node
/*
 delegates.js -- a conference BREAK at N delegates, thrown at a LOCAL copy.

 Model (state every assumption so the number means something):
   - 35% of delegates order during a 30-minute break  -> orders/s = N*0.35/1800
   - one cart per 250 delegates; each cart's barista takes the oldest order,
     makes it in 20 s, hands it over 40 s later (start -> complete -> pickup)
   - every order opens a phone beacon polling /track every 8 s for 10 min
   - every cart has a board polling /display/orders every 5 s and /display/
     config + /sponsors every 30 s (with ETags, like the real screen), and a
     barista tablet polling the queue every 5 s
   - every order loads the menu once (the kiosk/phone page)
   --surge K multiplies the arrival rate (everyone at once).

 SAFETY: refuses any base that is not localhost / 192.168.x. Never production.
 Usage: node delegates.js --base http://localhost:5001 --token <admin jwt>
        --delegates 5000 --minutes 8 [--surge 1] [--tag LT5k]
        node delegates.js --cleanup --tag LT5k   (removes the carts it created)
*/
const fs = require('fs');
const A = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), (arr[i + 1] && !arr[i + 1].startsWith('--')) ? arr[i + 1] : true] : []).filter(Boolean));
const BASE = (A.base || 'http://localhost:5001').replace(/\/$/, '');
const host = new URL(BASE).hostname;
if (!(host === 'localhost' || host === '127.0.0.1' || host.startsWith('192.168.'))) { console.error('REFUSED: load tests run against the local copy only'); process.exit(2); }
const TOKEN = A.token || process.env.TOKEN || '';
const D = parseInt(A.delegates || '5000', 10), MIN = parseFloat(A.minutes || '8'), SURGE = parseFloat(A.surge || '1'), TAG = A.tag || `LT${D}`;
const ORDER_FRACTION = 0.35, BREAK_MIN = 30, PER_CART = 250;
const carts = Math.max(2, Math.round(D / PER_CART));
const ordersPerSec = (D * ORDER_FRACTION) / (BREAK_MIN * 60) * SURGE;
const BEACON_MS = 8000, BEACON_MIN = 10, BOARD_MS = 5000, CONFIG_MS = 30000, TABLET_MS = 5000, MAKE_S = 20, PICKUP_S = 40;
const auth = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };
const stats = {}; const rec = (cls, ms, ok, status) => { const s = stats[cls] || (stats[cls] = { n: 0, err: 0, ms: [], codes: {} }); s.n++; if (!ok) s.err++; s.ms.push(ms); s.codes[status] = (s.codes[status] || 0) + 1; };
const pct = (xs, p) => { if (!xs.length) return 0; const a = [...xs].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(p / 100 * a.length))]; };
async function call(cls, path, opts = {}) {
  const t = Date.now();
  try { const r = await fetch(BASE + path, { ...opts, signal: AbortSignal.timeout(20000) }); const body = opts.raw ? null : await r.text(); rec(cls, Date.now() - t, r.ok || r.status === 304, r.status); return { status: r.status, ok: r.ok, body, headers: r.headers }; }
  catch (e) { rec(cls, Date.now() - t, false, 'ERR'); return { status: 'ERR', ok: false, body: '' }; }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (ms) => ms * (0.8 + Math.random() * 0.4);
let running = true, ordersCreated = 0, ordersDone = 0, beaconsOpen = 0; const created = [];
const memSamples = [];

async function listStations() { const r = await call('setup', '/api/stations', { headers: auth }); try { return JSON.parse(r.body).stations || []; } catch (e) { return []; } }
async function ensureCarts() {
  let st = await listStations(); const mine = [];
  for (let i = st.length; i < carts; i++) {
    const r = await call('setup', '/api/stations', { method: 'POST', headers: auth, body: JSON.stringify({ name: `LT Station ${i + 1}`, location: `Hall ${Math.ceil((i + 1) / 10)}`, status: 'active', capacity: 10 }) });
    if (!r.ok) { console.error('could not create station', r.status, (r.body || '').slice(0, 120)); break; }
  }
  st = await listStations();
  // New carts must be able to make the menu, or the router sends every
  // order to the two real stations (stage 1 did exactly that).
  const ref = st.find((s) => s.capabilities && Object.keys(s.capabilities).length);
  if (ref) for (const s of st) if (/^LT Station /.test(s.name || '') && !(s.capabilities && Object.keys(s.capabilities).length)) {
    let r = await call('setup', `/api/stations/${s.id}/capabilities`, { method: 'POST', headers: auth, body: JSON.stringify({ capabilities: ref.capabilities }) });
    if (!r.ok) r = await call('setup', `/api/stations/${s.id}/capabilities`, { method: 'POST', headers: auth, body: JSON.stringify(ref.capabilities) });
  }
  // Only the carts THIS event size needs (real stations first, then the
  // generated ones) -- a 10k run must not drive 200 boards left over from
  // a 50k run.
  return st.filter((s) => (s.status || 'active') === 'active').sort((a, b) => a.id - b.id).slice(0, carts).map((s) => s.id);
}
async function cleanup() {
  const st = await listStations();
  let n = 0; for (const s of st) if (/^LT Station /.test(s.name || '')) { const r = await call('setup', `/api/stations/${s.id}`, { method: 'DELETE', headers: auth }); if (r.ok) n++; }
  console.log(`removed ${n} load-test carts`); process.exit(0);
}
if (A.cleanup) { cleanup(); } else main();

async function main() {
  console.log(`== ${TAG}: ${D} delegates -> ${carts} carts, ${ordersPerSec.toFixed(2)} orders/s for ${MIN} min (surge x${SURGE}) against ${BASE}`);
  const menu = await call('menu', '/api/display/menu'); let drinks = ['Latte', 'Flat White', 'Cappuccino', 'Long Black'], milks = ['Full Cream', 'Skim', 'Oat'];
  try { const m = JSON.parse(menu.body).menu; drinks = m.coffee_types.map((x) => x.name || x); milks = m.milks.map((x) => x.name || x); } catch (e) {}
  const stationIds = await ensureCarts(); console.log(`carts ready: ${stationIds.length}`);
  const t0 = Date.now(); const endAt = t0 + MIN * 60000;
  // memory sampler
  (async () => { while (running) { const r = await call('health', '/api/health/full', { headers: auth }); try { const p = JSON.parse(r.body).checks.process; memSamples.push({ t: Math.round((Date.now() - t0) / 1000), rss: p.rss_mb, threads: p.threads }); } catch (e) {} await sleep(30000); } })();
  // boards + tablets per cart
  for (const sid of stationIds) {
    const stagger = Math.random() * 30000; // boards and tablets come online over ~30 s, not in one second
    (async () => { await sleep(stagger); let etagC = null, etagS = null; let lastCfg = 0; while (running) { await call('board', `/api/display/orders?station=${sid}`); if (Date.now() - lastCfg > CONFIG_MS) { lastCfg = Date.now(); const c = await call('board-config', '/api/display/config', { headers: etagC ? { 'If-None-Match': etagC } : {} }); etagC = c.headers && c.headers.get ? c.headers.get('etag') : etagC; const s = await call('board-config', '/api/sponsors', { headers: etagS ? { 'If-None-Match': etagS } : {} }); etagS = s.headers && s.headers.get ? s.headers.get('etag') : etagS; } await sleep(jitter(BOARD_MS)); } })();
    (async () => { await sleep(stagger + 2000); let busy = false; while (running) { const r = await call('tablet', `/api/orders?status=pending&station_id=${sid}`, { headers: auth }); if (!busy) { let rows = []; try { rows = JSON.parse(r.body).data || []; } catch (e) {} const mine = rows.filter((o) => String(o.customerName || '').startsWith('LT ')); if (mine.length) { const o = mine[mine.length - 1]; busy = true; (async () => { const n = o.orderNumber; const s1 = await call('barista', `/api/orders/${n}/start`, { method: 'POST', headers: auth, body: JSON.stringify({ station_id: sid }) }); await sleep(jitter(MAKE_S * 1000)); if (s1.ok) { await call('barista', `/api/orders/${n}/complete`, { method: 'POST', headers: auth, body: '{}' }); ordersDone++; setTimeout(() => call('barista', `/api/orders/${n}/pickup`, { method: 'POST', headers: auth, body: '{}' }), jitter(PICKUP_S * 1000)); } busy = false; })(); } } await sleep(jitter(TABLET_MS)); } })();
  }
  // arrivals
  let i = 0; const gapMs = 1000 / ordersPerSec;
  (async () => { while (running && Date.now() < endAt) { i++; const idx = i; (async () => { await call('menu', '/api/display/menu'); const r = await call('order', '/api/display/order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: `LT ${TAG} ${idx}`, coffee_type: drinks[idx % drinks.length], milk: milks[idx % milks.length], size: 'Medium', channel: 'web', surface: 'phone', sms_opt_in: false }) }); let n = null; try { n = JSON.parse(r.body).order_number; } catch (e) {} if (n) { ordersCreated++; created.push(n); beaconsOpen++; const until = Date.now() + BEACON_MIN * 60000; (async () => { while (running && Date.now() < until) { const t = await call('beacon', `/api/orders/${n}/track`); let st = ''; try { st = JSON.parse(t.body).status; } catch (e) {} if (st === 'picked_up' || st === 'cancelled') break; await sleep(jitter(BEACON_MS)); } beaconsOpen--; })(); } })(); await sleep(gapMs); } })();
  // progress
  while (Date.now() < endAt) { await sleep(30000); const el = (Date.now() - t0) / 1000; const total = Object.values(stats).reduce((a, s) => a + s.n, 0); const errs = Object.values(stats).reduce((a, s) => a + s.err, 0); const mem = memSamples[memSamples.length - 1]; console.log(`[${Math.round(el)}s] req/s ${(total / el).toFixed(0)}  errors ${errs}  orders ${ordersCreated} (done ${ordersDone}) beacons ${beaconsOpen}  p95 beacon ${pct(stats.beacon ? stats.beacon.ms : [], 95)}ms order ${pct(stats.order ? stats.order.ms : [], 95)}ms board ${pct(stats.board ? stats.board.ms : [], 95)}ms  rss ${mem ? mem.rss + 'MB' : '?'}`); }
  running = false; await sleep(2500);
  const el = (Date.now() - t0) / 1000; const out = { tag: TAG, delegates: D, carts, target_orders_per_s: +ordersPerSec.toFixed(2), minutes: MIN, surge: SURGE, seconds: Math.round(el), orders_created: ordersCreated, orders_completed: ordersDone, classes: {}, mem: memSamples };
  console.log(`\n== ${TAG} result (${Math.round(el)} s) ==`); console.log('class          n     err%   p50    p95    p99    max   codes');
  for (const [cls, s] of Object.entries(stats)) { const row = { n: s.n, err_pct: +((100 * s.err) / s.n).toFixed(2), p50: pct(s.ms, 50), p95: pct(s.ms, 95), p99: pct(s.ms, 99), max: Math.max(...s.ms), codes: s.codes }; out.classes[cls] = row; console.log(`${cls.padEnd(13)} ${String(s.n).padStart(6)} ${String(row.err_pct).padStart(6)}% ${String(row.p50).padStart(5)} ${String(row.p95).padStart(6)} ${String(row.p99).padStart(6)} ${String(row.max).padStart(6)}   ${JSON.stringify(s.codes)}`); }
  const total = Object.values(stats).reduce((a, s) => a + s.n, 0); out.achieved_req_per_s = +(total / el).toFixed(1);
  console.log(`total ${total} requests, ${out.achieved_req_per_s} req/s, orders ${ordersCreated} created / ${ordersDone} completed; rss ${memSamples[0] ? memSamples[0].rss : '?'} -> ${memSamples.length ? memSamples[memSamples.length - 1].rss : '?'} MB`);
  fs.mkdirSync('testbench/loadtest/results', { recursive: true }); fs.writeFileSync(`testbench/loadtest/results/${TAG}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, JSON.stringify(out, null, 2));
  process.exit(0);
}
