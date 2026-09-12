// Finding 4: an order we turn away is a row, and the report says so.
const { chromium } = require('playwright-core');
const { execSync } = require('child_process');
const BASE = 'http://localhost:5001'; const DB = process.env.DB || 'cupq_next'; const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const res = []; const check = (n, ok, d = '') => { res.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}  ${d}`); };
// A fresh number each run: conversation state is cached in the server's memory, so a
// deleted row does not reset it.
const PHONE = '+6140000' + String(1000 + Math.floor(Math.random() * 8999));
(async () => {
  const login = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'coffeecue', password: 'adminpassword' }) }).then(r => r.json());
  const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${login.token}` };
  const sim = (body) => fetch(`${BASE}/api/sms/simulate`, { method: 'POST', headers: H, body: JSON.stringify({ from: PHONE, body }) }).then(r => r.json()).then(d => d.reply || d.response || d.message || '');
  const rows = () => Number(execSync(`psql ${DB} -Atc "select count(*) from client_events where code='ORDER_REFUSED'"`).toString().trim());
  execSync(`psql ${DB} -Atqc "DELETE FROM conversation_states WHERE phone='${PHONE}'"`);
  const before = rows();
  const r1 = await sim('large coconut latte');
  check('SMS: coconut is refused with the same words as before', /coconut/i.test(r1) && /Sorry/.test(r1), r1.slice(0, 70));
  check('and it became one row', rows() === before + 1);
  const r2 = await sim('a pumpkin spice thing');
  check('SMS: an unknown drink is refused or queried', /Sorry|not sure|What would you like|MENU/i.test(r2), r2.slice(0, 70));
  const after = rows();
  const last = execSync(`psql ${DB} -Atc "select payload from client_events where code='ORDER_REFUSED' order by id desc limit 1"`).toString().trim();
  check('the row names channel, reason, item -- and no phone number', /"channel": "sms"/.test(last) && /"reason": "no_milk"|"reason": "no_drink"/.test(last) && !last.includes(PHONE) && !/"phone"/.test(last), last.slice(0, 120));
  const rep = await fetch(`${BASE}/api/reports/today`, { headers: H }).then(r => r.json());
  check('the report counts them', (rep.unmet?.refused_total || 0) >= after - before && (rep.unmet?.refused || []).some(i => i.item === 'coconut'), JSON.stringify(rep.unmet?.refused || []).slice(0, 120));
  // the screen
  const browser = await chromium.launch({ channel: 'chrome' }); const c = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await c.addInitScript((t) => { localStorage.setItem('coffee_system_token', t); localStorage.setItem('coffee_system_user', JSON.stringify({ username: 'coffeecue', role: 'admin', id: 1 })); }, login.token);
  const p = await c.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message.slice(0, 100)));
  await p.goto(`${BASE}/run#report`, { waitUntil: 'load' }); await sleep(5000);
  // The report opens on the busiest day; the refusals are today's.
  await p.getByRole('button', { name: /^(Sat|Sun|Mon|Tue|Wed|Thu|Fri) \d+ \w+\s*\d+$/ }).first().click().catch(() => {}); await sleep(4000);
  const t = await p.evaluate(() => document.body.innerText);
  check('Report > Couldn’t be served shows "turned away" with coconut', /turned\s+away/.test(t) && /coconut — milk not offered/i.test(t), (t.match(/[^\n]*turned\s+away[^\n]*/) || [''])[0].slice(0, 90));
  await p.screenshot({ path: 'report_refused.png', fullPage: true });
  await browser.close();
  execSync(`psql ${DB} -Atqc "DELETE FROM conversation_states WHERE phone='${PHONE}'; DELETE FROM orders WHERE phone='${PHONE}'"`);
  check('no page errors', errs.length === 0, errs.join(' | '));
  console.log(`\n${res.filter(Boolean).length}/${res.length} passed`);
  process.exit(res.every(Boolean) ? 0 : 1);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
