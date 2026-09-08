// Phase 5: the runner app. Every destination must render -- no blank pages,
// no error boundaries -- and the old organiser/support doors must still land
// in the right place.
const { chromium } = require('playwright-core');
const BASE = 'http://localhost:5001';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const res = []; const check = (n, ok, d = '') => { res.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}  ${d}`); };
const DEST = [ // every destination in the merged map

  ['#quickSetup', /Quick Setup/i], ['#menu/inventory', /Inventory/i], ['#menu/stock', /Stock/i],
  ['#menu/stationInventory', /Station/i], ['#stations', /Station/i], ['#branding/logo', /Brand|Logo/i],
  ['#branding/sponsors', /Sponsor/i], ['#branding/labels', /Label|Sticker/i], ['#branding/milk', /Milk/i],
  ['#schedule', /Schedule|Session/i], ['#users/people', /User|People|Add/i], ['#users/access', /Role|Access|User/i],
  ['#live/readiness', /Readiness|ready/i], ['#live/board', /Live|Station|Order/i], ['#live/metrics', /Dashboard|Orders|Station/i],
  ['#orders/all', /Order/i], ['#orders/groups', /Group/i],
  ['#messages/broadcast', /Message|Broadcast|Comm/i], ['#messages/test', /Test|SMS/i], ['#messages/blocked', /Block/i],
  ['#printers', /Printer/i], ['#report', /report/i],
  ['#system/health', /Health|System/i], ['#system/diagnostics', /crash|Diagnos|check/i],
  ['#eventsair', /EventsAir/i], ['#settings', /Event Data|Export|Settings/i], ['#emergency', /Emergency/i], ['#help', /SMS|Help/i],
];
(async () => {
  const login = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'coffeecue', password: 'adminpassword' }) }).then(r => r.json());
  const TOKEN = login.token || login.access_token;
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const c = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await c.addInitScript((t) => { localStorage.setItem('coffee_system_token', t); localStorage.setItem('coffee_system_user', JSON.stringify({ username: 'coffeecue', role: 'admin', id: 1 })); }, TOKEN);
  const p = await c.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message.slice(0, 120)));
  await p.goto(BASE + '/run', { waitUntil: 'load' }); await sleep(6000);
  let t = await p.evaluate(() => document.body.innerText);
  check('runner opens on Live, with all three groups in the rail', /Set up/i.test(t) && /Run the day/i.test(t) && /Review & system/i.test(t) && /Live/.test(t), t.split('\n').slice(0, 4).join(' / ').slice(0, 90));
  check('font is Manrope (the shell is on the design system)', /Manrope/.test(await p.evaluate(() => getComputedStyle(document.querySelector('.cq')).fontFamily)));

  const broken = [];
  for (const [hash, expect] of DEST) {
    await p.evaluate((h) => { window.location.hash = h; }, hash); await sleep(2200);
    const body = await p.evaluate(() => document.body.innerText);
    const main = (await p.evaluate(() => (document.querySelector('main') || {}).innerText || '')).trim();
    const bad = /Component Error|Something went wrong/i.test(body);
    const blank = main.length < 20;
    if (bad || blank || !expect.test(main)) broken.push(`${hash}${bad ? ' ERROR' : blank ? ' BLANK' : ' no-match'}`);
  }
  check(`all ${DEST.length} destinations render`, broken.length === 0, broken.join(' | '));

  // old doors
  await p.goto(BASE + '/organiser#branding/labels', { waitUntil: 'load' }); await sleep(4000);
  check('/organiser#branding/labels lands on the runner, same place', p.url().includes('/run') && p.url().includes('branding/labels'), p.url());
  await p.goto(BASE + '/support#dashboard', { waitUntil: 'load' }); await sleep(4000);
  check('/support#dashboard lands on the runner Live section', p.url().includes('/run') && /live/.test(p.url()), p.url());

  // mobile
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await m.addInitScript((t) => { localStorage.setItem('coffee_system_token', t); localStorage.setItem('coffee_system_user', JSON.stringify({ username: 'coffeecue', role: 'admin', id: 1 })); }, TOKEN);
  const mp = await m.newPage(); mp.on('pageerror', e => errs.push('phone: ' + e.message.slice(0, 120)));
  await mp.goto(BASE + '/run', { waitUntil: 'load' }); await sleep(5000);
  await mp.getByRole('button', { name: 'Open the menu' }).click(); await sleep(800);
  check('phone: the menu opens as a drawer', /Set up/i.test(await mp.evaluate(() => document.body.innerText)));
  check('phone: no sideways scroll', await mp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await mp.screenshot({ path: 'runner_phone.png' }); await m.close();

  await p.evaluate(() => { window.location.hash = '#quickSetup'; }); await sleep(2500);
  await p.screenshot({ path: 'runner_quicksetup.png' });
  await p.evaluate(() => { window.location.hash = '#live/board'; }); await sleep(2500);
  await p.screenshot({ path: 'runner_live.png' });
  check('no page errors anywhere', errs.length === 0, errs.slice(0, 3).join(' | '));
  await browser.close();
  console.log(`==== ${res.length} checks, ${res.filter(x => !x).length} FAIL ====`);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
