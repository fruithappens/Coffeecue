// Finding 1: elapsed time is the screen's job, so /orders can revalidate.
//
// Proves four things on the copy: (1) two polls with nothing changed carry
// the SAME ETag and the second is a 304 with no body; (2) a real Chrome
// tablet polling the queue gets 304s from the server -- counted in the
// server's own access log, not inferred; (3) the ages on the cards are right
// (a fresh order reads 0 min, an order backdated 12 minutes reads 12 and is
// promoted by the rush strip); (4) a tablet whose clock is five minutes FAST
// still reads a fresh order as 0 min, because ages are measured on the
// server's clock via the Date header.
const { chromium } = require('playwright-core');
const { execSync } = require('child_process');
const fs = require('fs');
const { eventCode } = require('./eventcode');
const BASE = 'http://localhost:5001';
const LOG = process.env.LOG || '/Users/stevewf/cupq-next/logs/backend.log';
const DB = process.env.DB || 'cupq_next';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const res = []; const check = (n, ok, d = '') => { res.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}  ${d}`); };
const errs = [];
const count304 = () => { try { return (fs.readFileSync(LOG, 'utf8').match(/"status_code": 304[^\n]*"path": "\/api\/orders"/g) || []).length; } catch (e) { return 0; } };
const count200 = () => { try { return (fs.readFileSync(LOG, 'utf8').match(/"status_code": 200[^\n]*"path": "\/api\/orders"/g) || []).length; } catch (e) { return 0; } };

(async () => {
  const login = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'coffeecue', password: 'adminpassword' }) }).then(r => r.json());
  const TOKEN = login.token || login.access_token;
  const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN };
  const api = (path, method = 'GET', body) => fetch(BASE + '/api' + path, { method, headers: H, body: body ? JSON.stringify(body) : undefined }).then(r => r.json());
  const EVENT_CODE = await eventCode(BASE);
  const order = (name, drink = 'Latte', milk = 'Full Cream', station) => fetch(BASE + '/api/display/order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, coffee_type: drink, milk, size: 'Medium', channel: 'web', surface: 'phone', sms_opt_in: false, e: EVENT_CODE, station_id: station }) }).then(r => r.json());

  // ---- 1. The tag holds still, and a matching tag is a 304 with no body.
  const r1 = await fetch(BASE + '/api/orders', { headers: H });
  const et1 = r1.headers.get('etag'); const b1 = (await r1.text()).length;
  check('list has no per-order waitTime', !/"waitTime"/.test(await fetch(BASE + '/api/orders', { headers: H }).then(r => r.text())));
  await sleep(6500);
  const r2 = await fetch(BASE + '/api/orders', { headers: H });
  check('ETag identical 6.5 s later with nothing changed', et1 && r2.headers.get('etag') === et1, `${et1}`);
  const r3 = await fetch(BASE + '/api/orders', { headers: { ...H, 'If-None-Match': et1 } });
  const b3 = (await r3.text()).length;
  check('If-None-Match -> 304, no body', r3.status === 304 && b3 === 0, `${b1} bytes -> ${b3} bytes, HTTP ${r3.status}`);
  const made = await order('Age drill'); const num = made.order_number;
  const r4 = await fetch(BASE + '/api/orders', { headers: { ...H, 'If-None-Match': et1 } });
  check('a new order changes the tag -> 200 with data', r4.status === 200 && r4.headers.get('etag') !== et1, `#${num}`);
  const list = await r4.json(); const row = (list.data || []).find(o => String(o.orderNumber) === String(num));
  check('new order in the list, createdAt present, no waitTime', !!row && !!row.createdAt && !('waitTime' in row), row ? row.createdAt : 'missing');
  const sid = made.station_id;

  // Backdate a second drill order 12 minutes so the rush strip has something
  // to promote. A long black with no milk: a SINGLE, so it cannot ride a
  // batch (the strip only promotes singles), on the same station as the first.
  const old = await order('Age drill twelve', 'Long Black', 'No Milk', sid); const oldNum = old.order_number;
  execSync(`psql ${DB} -Atc "UPDATE orders SET created_at = created_at - interval '12 minutes' WHERE order_number = '${oldNum}'"`);

  // ---- 2 + 3. A real tablet on the station the drills landed on.
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const tablet = async (label, fastMs = 0) => {
    const c = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true, locale: 'en-AU', timezoneId: 'Australia/Adelaide' });
    await c.addInitScript(({ t, s, f }) => {
      localStorage.setItem('coffee_system_token', t); localStorage.setItem('coffee_system_user', JSON.stringify({ username: 'coffeecue', role: 'admin', id: 1 }));
      localStorage.setItem('coffee_cue_selected_station', String(s)); localStorage.setItem('last_used_station_id', String(s));
      if (f) { const real = Date.now.bind(Date); Date.now = () => real() + f; }
    }, { t: TOKEN, s: sid, f: fastMs });
    const p = await c.newPage(); p.on('pageerror', e => errs.push(label + ': ' + e.message.slice(0, 140)));
    const statuses = []; p.on('response', r => { if (/\/api\/orders(\?|$)/.test(r.url())) statuses.push(r.status()); });
    return { c, p, statuses };
  };
  const body = (p) => p.evaluate(() => document.body.innerText);

  const A = await tablet('tablet');
  const log304Before = count304(), log200Before = count200();
  await A.p.goto(BASE + '/barista', { waitUntil: 'load' }); await sleep(4000);
  const t0 = await body(A.p);
  check('tablet shows the queue', /Up next|in queue/.test(t0));
  const cardNew = A.p.locator('article', { hasText: '#' + num }).first();
  const cardOld = A.p.locator('article', { hasText: '#' + oldNum }).first();
  const newTxt = (await cardNew.count()) ? await cardNew.innerText() : '';
  const oldTxt = (await cardOld.count()) ? await cardOld.innerText() : '';
  check('fresh order reads "Waiting 0 min"', /Waiting 0 min/.test(newTxt), newTxt.replace(/\n/g, ' | ').slice(0, 90));
  check('backdated order reads "Waiting 12 min"', /Waiting 1[23] min/.test(oldTxt), oldTxt.replace(/\n/g, ' | ').slice(0, 90));
  check('rush strip promotes the 12-minute single', new RegExp('#' + oldNum + '[^\\n]*\\(1[23]m\\)').test(t0), (t0.match(/Rush mix[\s\S]{0,200}/) || [''])[0].replace(/\n/g, ' | ').slice(0, 120));
  // Let it poll. Default interval is 5 s; 22 s is four polls.
  await sleep(22000);
  const s304 = A.statuses.filter(s => s === 304).length, s200 = A.statuses.filter(s => s === 200).length;
  const log304 = count304() - log304Before, log200 = count200() - log200Before;
  check('server answered the tablet\'s polls with 304s (access log)', log304 >= 2, `log: ${log304} x 304, ${log200} x 200 (browser saw ${s304} x 304, ${s200} x 200)`);
  // Change something: the barista starts the fresh one. The next poll must be a 200 with it Making.
  await cardNew.getByRole('button', { name: /^Start$/ }).click().catch(() => {}); await sleep(6500);
  const t1 = await body(A.p);
  check('after Start the board shows it Making (a real change still gets through)', new RegExp('Making[\\s\\S]*#' + num).test(t1) || /min since ordered/.test(t1));

  // ---- 4. A tablet five minutes FAST.
  const F = await tablet('fast tablet', 5 * 60000);
  await F.p.goto(BASE + '/barista', { waitUntil: 'load' }); await sleep(4000);
  const skew = await F.p.evaluate(() => Date.now() - new Date().getTime());
  const fresh = await order('Age drill fast', 'Latte', 'Full Cream', sid); await sleep(6500);
  const cardF = F.p.locator('article', { hasText: '#' + fresh.order_number }).first();
  const fTxt = (await cardF.count()) ? await cardF.innerText() : '';
  check('a tablet 5 min fast still reads a fresh order as 0 min', /Waiting 0 min/.test(fTxt), `Date.now() skewed by ${Math.round(skew / 1000)} s; card: ${fTxt.replace(/\n/g, ' | ').slice(0, 60)}`);

  // ---- tidy: complete/delete the drills
  for (const n of [num, oldNum, fresh.order_number]) { await api(`/orders/${n}/cancel`, 'POST', {}).catch(() => {}); }
  execSync(`psql ${DB} -Atc "DELETE FROM orders WHERE order_number IN ('${num}','${oldNum}','${fresh.order_number}')"`);
  await browser.close();
  check('no page errors', errs.length === 0, errs.join(' || ').slice(0, 200));
  console.log(`\n${res.filter(Boolean).length}/${res.length} passed`);
  process.exit(res.every(Boolean) ? 0 : 1);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
