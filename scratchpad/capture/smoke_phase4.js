// Phase 4 smoke on the TEST COPY: the new barista queue screen.
const { chromium } = require('playwright-core');
const { eventCode } = require('./eventcode');
const BASE = 'http://localhost:5001';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const res = []; const check = (n, ok, d = '') => { res.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}  ${d}`); };
const errs = [];
(async () => {
  const login = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'coffeecue', password: 'adminpassword' }) }).then(r => r.json());
  const TOKEN = login.token || login.access_token;
  const api = (path, method = 'GET', body) => fetch(BASE + '/api' + path, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN }, body: body ? JSON.stringify(body) : undefined }).then(r => r.json());
  const EVENT_CODE = await eventCode(BASE);
  const order = (name, drink = 'Latte', milk = 'Full Cream') => fetch(BASE + '/api/display/order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, coffee_type: drink, milk, size: 'Medium', channel: 'web', surface: 'phone', sms_opt_in: false, e: EVENT_CODE }) }).then(r => r.json());

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const tablet = async (label, seed) => {
    const c = await browser.newContext({ viewport: { width: 1024, height: 768 }, deviceScaleFactor: 2, hasTouch: true, locale: 'en-AU', timezoneId: 'Australia/Adelaide' });
    await c.addInitScript(({ t, s }) => { if (!localStorage.getItem('coffee_system_token')) { localStorage.setItem('coffee_system_token', t); localStorage.setItem('coffee_system_user', JSON.stringify({ username: 'coffeecue', role: 'admin', id: 1 })); if (s) { localStorage.setItem('coffee_cue_selected_station', String(s)); localStorage.setItem('last_used_station_id', String(s)); } } }, { t: TOKEN, s: seed || null });
    const p = await c.newPage(); p.on('pageerror', e => errs.push(label + ': ' + e.message.slice(0, 140))); return { c, p };
  };
  const body = (p) => p.evaluate(() => document.body.innerText);
  // Read a lane by its own element. Splitting the page text on 'Ready'
  // also matched the Ready BUTTON on a Making card.
  const lane = (p, name) => p.locator('section').filter({ hasText: new RegExp('^' + name) }).last().innerText().catch(() => '');
  const header = (p) => p.evaluate(() => (document.querySelector('header') || {}).innerText || '');

  // ---- fresh tablet: chooser -> station 1 -> the new screen
  const A = await tablet('A');
  await A.p.goto(BASE + '/barista', { waitUntil: 'load' }); await sleep(4500);
  check('chooser on a fresh tablet', /Which station is this tablet at\?/.test(await body(A.p)));
  await A.p.getByRole('button', { name: /Coffee Station 1/ }).first().click(); await sleep(4500);
  let h = await header(A.p); let t = await body(A.p);
  check('header: station name + Online + queue', /Coffee Station 1/.test(h) && /Online/.test(h) && /in queue/.test(h), h.replace(/\n/g, ' | ').slice(0, 120));
  check('tabs: Queue / Stock / Tools, no manager tabs', /Queue/.test(t) && /Stock/.test(t) && /Tools/.test(t) && !/Capabilities|Inventory|Schedule/.test(t.split('Making')[0] || ''));
  check('the board: Making, Up next, Ready', /Making/.test(t) && /Up next/.test(t) && /\bReady\b/.test(t));
  check('font is Manrope on the barista screen', (await A.p.evaluate(() => getComputedStyle(document.querySelector('.cq')).fontFamily)).startsWith('Manrope'));

  // ---- an order comes in
  const made = await order('P4 drill one'); const n1 = made.order_number; const sid = made.station_id;
  check('drill order created', !!n1, `#${n1} routed to station ${sid}`);
  if (sid !== 1) { // move the tablet to where the router put it, via the picker
    await A.p.getByTitle(/Change station or choose/).first().click(); await sleep(800);
    const st = await api('/stations'); const list = st.stations || st.data || st; const target = list.find(s => (s.station_id || s.id) === sid);
    await A.p.getByRole('button', { name: new RegExp(target.name) }).first().click(); await sleep(3500);
    check('picker: switched tablet to ' + target.name, new RegExp(target.name).test(await header(A.p)));
  }
  await A.p.getByRole('button', { name: 'Station actions' }).first().click(); await sleep(400); await A.p.getByRole('button', { name: /^Refresh/ }).first().click().catch(() => {}); await sleep(3000);
  t = await body(A.p);
  const upNext = await lane(A.p, 'Up next');
  check(`#${n1} shows under Up next`, new RegExp('#' + n1).test(upNext));
  const card = A.p.locator('article', { hasText: '#' + n1 }).first();
  await card.getByRole('button', { name: /^Start$/ }).click(); await sleep(3000);
  const making = await lane(A.p, 'Making');
  check(`#${n1} moved to Making after Start`, new RegExp('#' + n1).test(making));
  await A.p.locator('article', { hasText: '#' + n1 }).first().getByRole('button', { name: /Ready/ }).first().click(); await sleep(3000);
  const readySec = await lane(A.p, 'Ready');
  check(`#${n1} in Ready to hand over after Ready`, new RegExp('#' + n1).test(readySec));
  // a second order so the screenshot shows all three states
  const made2 = await order('P4 drill two', 'Flat White', 'Oat'); const n2 = made2.order_number;
  await A.p.getByRole('button', { name: 'Station actions' }).first().click(); await sleep(400); await A.p.getByRole('button', { name: /^Refresh/ }).first().click().catch(() => {}); await sleep(3000);
  const made3 = await order('P4 drill three', 'Cappuccino', 'Skim'); const n3 = made3.order_number;
  await A.p.getByRole('button', { name: 'Station actions' }).first().click(); await sleep(400); await A.p.getByRole('button', { name: /^Refresh/ }).first().click().catch(() => {}); await sleep(3000);
  const c2 = A.p.locator('article', { hasText: '#' + n2 }).first(); if (await c2.count()) { await c2.getByRole('button', { name: /^Start$/ }).click(); await sleep(2500); }
  await A.p.screenshot({ path: 'p4_tablet_queue.png', fullPage: true });
  // "..." menu on a card
  const more = A.p.locator('article', { hasText: '#' + n3 }).first().getByRole('button', { name: 'More' });
  if (await more.count()) { await more.click(); await sleep(500); const mt = await body(A.p); check('… menu lists the secondary actions', /Delay/.test(mt) && /Move to another station/.test(mt) && /Edit order/.test(mt)); await A.p.keyboard.press('Escape'); await A.p.mouse.click(5, 400); await sleep(300); }
  // collected
  // The Collected button ON n1's OWN ROW. `.first()` picked whichever order
  // happened to be top of the Ready lane, so the drill passed only when the
  // lane was empty of everything else -- a green tick that depends on the
  // database being freshly wiped is not a test. Ready rows are plain divs,
  // not <article>, so walk the buttons and take the one whose row carries
  // this order number.
  const buttons = A.p.getByRole('button', { name: 'Collected' });
  let collected = null;
  for (let i = 0; i < await buttons.count(); i++) {
    const b = buttons.nth(i);
    const row = await b.evaluate((el) => (el.closest('div[class*="rounded"]') || el.parentElement).innerText);
    if (new RegExp('#' + n1).test(row)) { collected = b; break; }
  }
  if (!collected) throw new Error(`no Collected button on the row for #${n1}`);
  await collected.evaluate((el) => el.scrollIntoView({ block: 'center' })); await sleep(400);
  await collected.click(); await sleep(2500);
  check(`#${n1} gone after Collected`, !new RegExp('#' + n1).test(await lane(A.p, 'Ready')));

  // ---- the lock: PIN -> admin sheet
  await A.p.getByRole('button', { name: 'Station admin' }).click(); await sleep(600);
  check('lock opens the PIN panel', /Enter the event PIN/.test(await body(A.p)));
  for (const d of ['9', '9', '9', '9']) { await A.p.getByRole('button', { name: d, exact: true }).click(); await sleep(120); }
  await A.p.getByRole('button', { name: 'Unlock' }).click();
  await sleep(1200); check('wrong PIN is refused', /isn’t right|isn't right/.test(await body(A.p)));
  await sleep(1300);
  const PIN = String(process.env.PIN || '1234');
  for (const d of PIN.split('')) { await A.p.getByRole('button', { name: d, exact: true }).click(); await sleep(120); }
  if (PIN.length < 6) await A.p.getByRole('button', { name: 'Unlock' }).click();
  await sleep(1500); t = await body(A.p);
  check('admin sheet: mode, station, sound, zoom, refresh, sign out', /Rush mode/.test(t) && /Team mode/.test(t) && /Sound/.test(t) && /Screen size/.test(t) && /Refresh the queue/.test(t) && /Sign out/.test(t));
  await A.p.screenshot({ path: 'p4_admin_sheet.png' });
  await A.p.getByRole('button', { name: /Back to the queue/ }).click(); await sleep(500);

  // ---- watch another station
  await A.p.getByTitle(/Change station or choose/).first().click(); await sleep(800);
  const watchBtn = A.p.getByRole('dialog', { name: 'Stations' }).getByRole('button', { name: /^Watch$/ }).first();
  if (await watchBtn.count()) { await watchBtn.click(); await sleep(400); }
  await A.p.getByRole('dialog', { name: 'Stations' }).getByRole('button', { name: /^Done$/ }).click(); await sleep(800);
  h = await header(A.p); check('header shows a watched station chip', /Coffee Station 2|Coffee Station 1/.test(h.split('\n').slice(1).join(' ')) , h.replace(/\n/g, ' | ').slice(0, 140));

  // ---- phone
  const P = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await P.addInitScript((t) => { if (!localStorage.getItem('coffee_system_token')) { localStorage.setItem('coffee_system_token', t); localStorage.setItem('coffee_system_user', JSON.stringify({ username: 'coffeecue', role: 'admin', id: 1 })); localStorage.setItem('coffee_cue_selected_station', '1'); } }, TOKEN);
  const pp = await P.newPage(); pp.on('pageerror', e => errs.push('phone: ' + e.message.slice(0, 140)));
  await pp.goto(BASE + '/barista', { waitUntil: 'load' }); await sleep(4500);
  check('phone: queue screen renders', /Making/.test(await body(pp)) && /Queue/.test(await body(pp)));
  check('phone: no sideways scroll', await pp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await pp.screenshot({ path: 'p4_phone_queue.png' });
  await P.close(); await A.c.close(); await browser.close();
  console.log('page errors:', errs.length ? errs : 'none'); console.log(`==== ${res.length} checks, ${res.filter(x => !x).length} FAIL ====`);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
