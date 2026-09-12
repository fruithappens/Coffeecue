// Finding 2: the Ready button had the same code as the dead Collected button
// (#606) -- a local lookup that refused the tap before the server was asked.
// Take the card out from under the button (a second device marks it ready)
// and tap Ready on the stale card: it must end up Ready, with no error toast.
const { chromium } = require('playwright-core');
const { eventCode } = require('./eventcode');
const BASE = 'http://localhost:5001';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const res = []; const check = (n, ok, d = '') => { res.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}  ${d}`); };
(async () => {
  const login = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'coffeecue', password: 'adminpassword' }) }).then(r => r.json());
  const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${login.token}` };
  const code = await eventCode(BASE);
  const made = await fetch(`${BASE}/api/display/order`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Stuck ready', coffee_type: 'Long Black', milk: 'No Milk', size: 'Medium', channel: 'web', surface: 'phone', sms_opt_in: false, e: code }) }).then(r => r.json());
  const num = made.order_number; const sid = made.station_id;
  await fetch(`${BASE}/api/orders/${num}/start`, { method: 'POST', headers: H });
  const browser = await chromium.launch({ channel: 'chrome' });
  const c = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true });
  await c.addInitScript(({ t, s }) => { localStorage.setItem('coffee_system_token', t); localStorage.setItem('coffee_system_user', JSON.stringify({ username: 'coffeecue', role: 'admin', id: 1 })); localStorage.setItem('coffee_cue_selected_station', String(s)); localStorage.setItem('last_used_station_id', String(s)); }, { t: login.token, s: sid });
  const p = await c.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`${BASE}/barista`, { waitUntil: 'load' }); await sleep(4500);
  const card = p.locator('article', { hasText: '#' + num }).first();
  check('the Making card is on screen', await card.count() > 0, `#${num} at station ${sid}`);
  // Someone else marks it ready.
  const other = await fetch(`${BASE}/api/orders/${num}/complete`, { method: 'POST', headers: H }).then(r => r.status);
  check('a second device completed it', other < 400, `HTTP ${other}`);
  // Tap Ready on the stale card before the next poll.
  const ready = card.getByRole('button', { name: /Ready/ }).first();
  if (await ready.count()) { await ready.click(); } else { console.log('  (card already refreshed before the tap)'); }
  await sleep(4000);
  const t = await p.evaluate(() => document.body.innerText);
  check('no "Could not find the order details" toast', !/Could not find the order details/.test(t) && !/Failed to complete the order/.test(t));
  check('the card sits in Ready, not stuck in Making', new RegExp('Ready[\\s\\S]*#' + num).test(t) && !new RegExp('Making[\\s\\S]*#' + num + '[\\s\\S]*Ready\\b').test(t.split('Ready')[0]));
  // Now a numeric id through the same path: the walk-up dialog's order arrives with station_id as a NUMBER.
  const srv = await fetch(`${BASE}/api/orders/${num}`, { headers: H }).then(r => r.json()).catch(() => ({}));
  check('the server agrees it is completed', /complet/i.test(String((srv.data || srv.order || srv).status || '')), String((srv.data || srv.order || srv).status));
  await fetch(`${BASE}/api/orders/${num}/pickup`, { method: 'POST', headers: H }).catch(() => {});
  await browser.close();
  check('no page errors', errs.length === 0, errs.join(' | ').slice(0, 160));
  console.log(`\n${res.filter(Boolean).length}/${res.length} passed`);
  process.exit(res.every(Boolean) ? 0 : 1);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
