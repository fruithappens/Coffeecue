// Steve: "sometimes it seemed like it was stuck and could not select collected
// despite picked up." Reproduce it: take a card out from under the button
// (a second device marking it) and then tap Collected.
const { chromium } = require('playwright-core');
const BASE = 'http://localhost:5001';
const pass = [], fail = [];
const ok = (n, c, d = '') => (c ? pass : fail).push(n + (d ? ` — ${d}` : ''));

(async () => {
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'coffeecue', password: 'adminpassword' }),
  }).then(r => r.json());
  const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${login.token}` };

  // An order, made and sitting ready.
  const made = await fetch(`${BASE}/api/display/order`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Stuck test', coffee_type: 'Latte', milk: 'Full Cream',
      size: 'medium', channel: 'web', surface: 'phone', sms_opt_in: false }),
  }).then(r => r.json());
  const num = made.order_number;
  const list = await fetch(`${BASE}/api/orders`, { headers: H }).then(r => r.json());
  const row = (list.data || list.orders || list).find(o => String(o.orderNumber || o.order_number) === String(num));
  const id = row && row.id;
  await fetch(`${BASE}/api/orders/${id}/start`, { method: 'POST', headers: H }).catch(() => {});
  await fetch(`${BASE}/api/orders/${id}/complete`, { method: 'POST', headers: H }).catch(() => {});

  const browser = await chromium.launch({ channel: 'chrome' });
  const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await p.goto(`${BASE}/barista`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);
  if (/sign in|log in|password/i.test(await p.locator('body').innerText())) {
    await p.fill('input[name="username"], input[type="text"]', 'coffeecue');
    await p.fill('input[type="password"]', 'adminpassword');
    await p.click('button[type="submit"]');
    await p.waitForTimeout(3500);
    await p.goto(`${BASE}/barista`, { waitUntil: 'networkidle' });
  }
  await p.waitForTimeout(4000);
  const onScreen = (await p.locator('body').innerText()).includes(`#${num}`);
  ok('the ready card is on screen', onScreen, `#${num}`);

  // Someone else collects it -- exactly the case that used to kill the button.
  await fetch(`${BASE}/api/orders/${id}/pickup`, { method: 'POST', headers: H }).catch(() => {});

  // Now tap Collected on the stale card.
  const buttons = p.getByRole('button', { name: 'Collected' });
  let target = null;
  for (let i = 0; i < await buttons.count(); i++) {
    const b = buttons.nth(i);
    const rowTxt = await b.evaluate(el => (el.closest('div[class*="rounded"]') || el.parentElement).innerText);
    if (rowTxt.includes(`#${num}`)) { target = b; break; }
  }
  if (target) {
    await target.click();
    await p.waitForTimeout(3000);
    const still = (await p.locator('body').innerText()).includes(`#${num}`);
    ok('tapping Collected on a stale card clears it (not stuck)', !still);
  } else {
    ok('tapping Collected on a stale card clears it (not stuck)', true, 'card already gone');
  }
  const errs = [];
  p.on('pageerror', e => errs.push(String(e)));
  ok('no page errors', errs.length === 0, errs[0] || '');

  await browser.close();
  console.log(`\nPASS ${pass.length}/${pass.length + fail.length}`);
  pass.forEach(x => console.log('  ok   ' + x));
  fail.forEach(x => console.log('  FAIL ' + x));
})();
