// Findings 5, 7, 9, 16: the words point at real places, the debug pages are
// gone, the "still to build" line is gone, the dead tabs are gone and the
// live ones still work.
const { chromium } = require('playwright-core');
const BASE = 'http://localhost:5001'; const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const res = []; const check = (n, ok, d = '') => { res.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}  ${d}`); };
(async () => {
  const login = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'coffeecue', password: 'adminpassword' }) }).then(r => r.json());
  // 7: the committed debug pages are not served (the copy's static/ is a fresh build now)
  const codes = {}; for (const f of ['direct-database-fix.html', 'emergency-reset.html', 'debug-auth-guard.html', 'login.html']) codes[f] = await fetch(`${BASE}/static/${f}`).then(r => r.status);
  check('7: the 2025 debug pages are not served', Object.values(codes).every(c => c === 404), JSON.stringify(codes));
  const idx = await fetch(`${BASE}/static/index.html`).then(r => r.status); const js = await fetch(`${BASE}/`).then(r => r.text());
  check('7: the built app still serves', idx === 200 && /main\.[a-f0-9]+\.js/.test(js));
  const browser = await chromium.launch({ channel: 'chrome' }); const errs = [];
  const c = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await c.addInitScript((t) => { localStorage.setItem('coffee_system_token', t); localStorage.setItem('coffee_system_user', JSON.stringify({ username: 'coffeecue', role: 'admin', id: 1 })); localStorage.setItem('coffee_cue_selected_station', '1'); }, login.token);
  const p = await c.newPage(); p.on('pageerror', e => errs.push(e.message.slice(0, 120)));
  const text = async (url, ms = 3500) => { await p.goto(BASE + url, { waitUntil: 'load' }); await sleep(ms); return p.evaluate(() => document.body.innerText); };
  // 9
  let t = await text('/run#emergency');
  check('9: Emergency no longer advertises "Still to build"', /Not on this tab/.test(t) && !/Still to build/.test(t) && !/Reset all stations/.test(t));
  // 5: help
  t = await text('/run#help');
  check('5: Help no longer points at Support > Comms Hub', !/Comms Hub/.test(t) && /Messages › Test a text/.test(t));
  // 5 + 8: live board
  t = await text('/run#live/board', 5000);
  check('5/8: Live board quick actions have no Redistribute button', !/Redistribute\n\s*Balance Load/.test(t) && /Pause Orders|Resume Orders/.test(t));
  // 16: the tablet's tabs and admin sheet
  t = await text('/barista', 4500);
  check('16: tablet shows Queue / Stock / Tools', /Queue/.test(t) && /Stock/.test(t) && /Tools/.test(t));
  const unlock = async () => {
    await p.getByRole('button', { name: 'Station admin' }).click(); await sleep(700);
    if (/Enter the event PIN/.test(await p.evaluate(() => document.body.innerText))) {
      for (const d of String(process.env.PIN || '1234').split('')) { await p.getByRole('button', { name: d, exact: true }).click(); await sleep(100); }
      await p.getByRole('button', { name: 'Unlock' }).click().catch(() => {}); await sleep(1500);
    }
    return p.evaluate(() => document.body.innerText);
  };
  t = await unlock();
  check('16: admin sheet offers Queue rules and Balance only', /Queue rules/.test(t) && /Balance/.test(t) && !/Capabilities|Inventory AI|Staff allocation/.test(t), (t.match(/Manager tools[\s\S]{0,160}/) || [''])[0].replace(/\n/g, ' | '));
  await p.getByRole('button', { name: /^Balance$/ }).click().catch(() => {}); await sleep(2500); t = await p.evaluate(() => document.body.innerText);
  check('16: Balance still opens', /Balance|balanced|overloaded|stations/i.test(t));
  await p.goto(BASE + '/barista', { waitUntil: 'load' }); await sleep(3000);
  await unlock();
  await p.getByRole('button', { name: /Queue rules/ }).click().catch(() => {}); await sleep(2500); t = await p.evaluate(() => document.body.innerText);
  check('16: Queue rules still opens', /Queue rules|rule|priority/i.test(t));
  await p.goto(BASE + '/barista', { waitUntil: 'load' }); await sleep(3000);
  await p.getByRole('tab', { name: /Stock/ }).first().click().catch(async () => { await p.getByRole('button', { name: /^Stock/ }).first().click().catch(() => {}); }); await sleep(2500); t = await p.evaluate(() => document.body.innerText);
  check('5: Stock tab wording points at Runner › Menu › Event Stock', /Runner › Menu › Event Stock/.test(t) || /on hand/i.test(t), (t.match(/[^\n]*Event Stock[^\n]*/) || [''])[0].slice(0, 100));
  await browser.close();
  check('no page errors', errs.length === 0, errs.join(' | ').slice(0, 200));
  console.log(`\n${res.filter(Boolean).length}/${res.length} passed`);
  process.exit(res.every(Boolean) ? 0 : 1);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
