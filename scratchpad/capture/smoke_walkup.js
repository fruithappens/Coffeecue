// The barista's walk-up form, with the event code switched ON.
//
// The tablet mounts the customer's own form with no ?e= and no eventCode
// prop, so once an event REQUIRES a code every walk-up was refused as
// "from a different event" -- a barista standing at the machine, told the
// customer in front of them is at the wrong event. KioskOrder now falls back
// to the code the public display config publishes. This proves it:
//   1. the form opens from the queue
//   2. the order it places is accepted (200) and carries the code
//   3. the same POST with no code is still refused (403) -- the gate is on
const { chromium } = require('playwright-core');
const BASE = process.env.BASE || 'http://localhost:5001';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const results = [];
const ok = (name, pass, detail = '') => { results.push({ name, pass: !!pass }); console.log(`${pass ? '  ok  ' : '  FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };

(async () => {
  // 3 first: does the gate refuse a code-less order at all? Otherwise 2 proves nothing.
  const naked = await fetch(`${BASE}/api/display/order`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'x', coffee_type: 'Latte', milk: 'Full Cream', size: 'medium', channel: 'walkin' }) });
  ok('a walk-up POST with no code is refused (gate is on)', naked.status === 403, `status ${naked.status}`);

  const b = await chromium.launch({ channel: 'chrome' });
  const p = await b.newPage({ viewport: { width: 1180, height: 900 } });
  await p.goto(`${BASE}/barista`, { waitUntil: 'networkidle' }); await sleep(1200);
  if (/sign in|log in|password/i.test(await p.locator('body').innerText())) {
    await p.fill('input[name="username"], input[type="text"]', 'coffeecue');
    await p.fill('input[type="password"]', 'adminpassword');
    await p.click('button[type="submit"]'); await sleep(3500);
  }
  await p.goto(`${BASE}/barista`, { waitUntil: 'networkidle' }); await sleep(2500);
  const walk = p.getByRole('button', { name: /Walk-up order/ }).first();
  await walk.click().catch(() => {}); await sleep(1500);
  // Everything from here is scoped to the form's modal: the queue behind it
  // has buttons of its own ("Start all 4 together") that a page-wide
  // locator happily resolves to.
  const m = p.locator('div.fixed.inset-0.z-50').last();
  const opened = await m.getByText(/pick a drink|Order here/i).first().isVisible().catch(() => false);
  ok('the walk-up form opens from the queue', opened);

  // Walk the form: pick the first option wherever a choice is offered, press
  // Next/Continue when offered, type a name when asked, until Place.
  let placed = null, body = null;
  p.on('request', r => { if (r.method() === 'POST' && r.url().includes('/api/display/order')) { try { body = r.postDataJSON(); } catch (e) { body = null; } } });
  const respP = p.waitForResponse(r => r.url().includes('/api/display/order') && r.request().method() === 'POST', { timeout: 60000 }).then(r => r.status()).catch(() => null);
  for (let i = 0; i < 14; i++) {
    if (process.env.DEBUG) console.log(`step ${i}:`, (await m.innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 220));
    const place = m.getByRole('button', { name: /^Place (order|\d+ coffees)$/ }).first();
    if (await place.isVisible().catch(() => false)) { await place.click(); break; }
    const nameBox = m.locator('input[placeholder*="name" i], input[name="name"]').first();
    if (await nameBox.isVisible().catch(() => false) && !(await nameBox.inputValue())) { await nameBox.fill('Walk-up smoke'); }
    const next = m.getByRole('button', { name: /^(Next|Continue)/ }).first();
    if (await next.isVisible().catch(() => false) && await next.isEnabled().catch(() => false)) { await next.click(); await sleep(700); continue; }
    // a tile step: click the first tile that is not a nav button
    const tile = m.locator('button:not([disabled])').filter({ hasText: /(Flat White|Latte|Full Cream|Regular|Medium|No sugar|None|Standard|Normal|No number|Skip|Here|Counter)/i }).first();
    if (await tile.isVisible().catch(() => false)) { await tile.click(); await sleep(700); continue; }
    // fall back: any Next-looking button
    const any = m.getByRole('button', { name: /Next|Continue|Skip/ }).first();
    if (await any.isVisible().catch(() => false)) { await any.click(); await sleep(700); continue; }
    await sleep(500);
  }
  placed = await respP;
  const carried = body && String(body.e || body.event_code || '');
  ok('the walk-up is accepted and carries the event code', placed === 200 && !!carried, `status ${placed}, e=${carried || '(none)'}`);
  await b.close();
  const fails = results.filter(r => !r.pass).length;
  console.log(`\nPASS ${results.length - fails}/${results.length}`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('HARNESS ERROR', e); process.exit(2); });
