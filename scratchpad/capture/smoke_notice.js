// Does one notice actually reach every surface?
const { chromium } = require('playwright-core');
const BASE = 'http://localhost:5001';
const pass = [], fail = [];
const ok = (n, c, d = '') => (c ? pass : fail).push(n + (d ? ` — ${d}` : ''));

async function api(path, opts = {}) {
  const res = await fetch(BASE + path, opts);
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

(async () => {
  const login = await api('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'coffeecue', password: 'adminpassword' }),
  });
  const token = login.body.token;
  const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  // Clear anything left over so the assertions mean something.
  const existing = await api('/api/notices', { headers: H });
  for (const n of (existing.body.notices || []).filter(x => x.live)) {
    await api(`/api/notices/${n.id}/clear`, { method: 'POST', headers: H });
  }

  const MSG = 'We have run out of skim milk - come and talk to us about the options.';
  const made = await api('/api/notices', {
    method: 'POST', headers: H,
    body: JSON.stringify({ message: MSG, level: 'warning', minutes: 30,
                           onScreens: true, onPhones: true, bySms: false }),
  });
  ok('notice created', made.body.status === 'success');
  const id = made.body.notice && made.body.notice.id;
  ok('no text sent when bySms is false', (made.body.smsSent || 0) === 0);

  const browser = await chromium.launch({ channel: 'chrome' });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();

  // 1. The public board.
  await p.goto(`${BASE}/display?station=all`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(2500);
  let text = await p.locator('body').innerText();
  ok('board shows the notice', /run out of skim milk/i.test(text));
  await p.screenshot({ path: `${__dirname}/notice_board.png` });

  // 2. The beacon in a customer's hand.
  const phone = await ctx.newPage();
  await phone.setViewportSize({ width: 390, height: 844 });
  await phone.goto(`${BASE}/my`, { waitUntil: 'networkidle' });
  await phone.waitForTimeout(2500);
  text = await phone.locator('body').innerText();
  ok('beacon shows the notice', /run out of skim milk/i.test(text));
  await phone.screenshot({ path: `${__dirname}/notice_beacon.png` });

  // 3. Take it down -- and it must go from both.
  await api(`/api/notices/${id}/clear`, { method: 'POST', headers: H });
  await p.reload({ waitUntil: 'networkidle' });
  await phone.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(2000);
  ok('board clears', !/run out of skim milk/i.test(await p.locator('body').innerText()));
  ok('beacon clears', !/run out of skim milk/i.test(await phone.locator('body').innerText()));

  // 4. A screens-only notice must never reach a customer's phone.
  const only = await api('/api/notices', {
    method: 'POST', headers: H,
    body: JSON.stringify({ message: 'Cart 2 closed for a clean', minutes: 10,
                           onScreens: true, onPhones: false }),
  });
  await phone.reload({ waitUntil: 'networkidle' });
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(2000);
  ok('screens-only reaches the board', /Cart 2 closed/i.test(await p.locator('body').innerText()));
  ok('screens-only stays off phones', !/Cart 2 closed/i.test(await phone.locator('body').innerText()));
  await api(`/api/notices/${only.body.notice.id}/clear`, { method: 'POST', headers: H });

  // 5. The composer, where a person actually does this.
  await p.goto(`${BASE}/run#messages/notice`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);
  if (/sign in|log in|password/i.test(await p.locator('body').innerText())) {
    await p.fill('input[name="username"], input[type="text"]', 'coffeecue');
    await p.fill('input[type="password"]', 'adminpassword');
    await p.click('button[type="submit"]');
    await p.waitForTimeout(3000);
    await p.goto(`${BASE}/run#messages/notice`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(1800);
  }
  text = await p.locator('body').innerText();
  ok('composer opens', /tell everyone/i.test(text));
  ok('presets offered', /out of a milk/i.test(text) && /cart down/i.test(text));
  ok('all three channels offered',
     /the screens/i.test(text) && /people's phones/i.test(text) && /as a text/i.test(text));
  ok('text costs are spelled out', /costs money/i.test(text));
  await p.screenshot({ path: `${__dirname}/notice_composer.png`, fullPage: true });

  await browser.close();
  console.log(`\nPASS ${pass.length}/${pass.length + fail.length}`);
  pass.forEach(x => console.log('  ok   ' + x));
  fail.forEach(x => console.log('  FAIL ' + x));
  process.exit(fail.length ? 1 : 0);
})();
