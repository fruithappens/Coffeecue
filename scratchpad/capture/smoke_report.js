const { chromium } = require('playwright-core');
const BASE = 'http://localhost:5001';
const pass = [], fail = [];
const ok = (n, c, d = '') => (c ? pass : fail).push(n + (d ? ` — ${d}` : ''));
(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const p = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto(`${BASE}/run#report`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);
  if (/sign in|log in|password/i.test(await p.locator('body').innerText())) {
    await p.fill('input[name="username"], input[type="text"]', 'coffeecue');
    await p.fill('input[type="password"]', 'adminpassword');
    await p.click('button[type="submit"]');
    await p.waitForTimeout(3000);
    await p.goto(`${BASE}/run#report`, { waitUntil: 'networkidle' });
  }
  await p.waitForTimeout(3000);
  let t = await p.locator('body').innerText();
  ok('report screen replaces the placeholder',
     /the event report/i.test(t) && !/arrives in its own phase/i.test(t));
  ok('opens on a real day, not an empty today', /577|323|254/.test(t));
  ok('headline numbers', /Coffees/i.test(t) && /Average wait/i.test(t) && /Busiest hour/i.test(t));
  ok('busiest hour is a trading hour, not 1am', !/\b1:00\b/.test(t) && /\d+:00/.test(t));
  ok('drinks breakdown', /what they drank/i.test(t) && /latte/i.test(t));
  ok('milk breakdown', /milk/i.test(t) && /non-dairy/i.test(t));
  ok('per-station table', /how each station went/i.test(t) && /Station 1/i.test(t));
  ok('issues surfaced', /worth knowing/i.test(t));
  ok('says whose clock it uses', /Adelaide/i.test(t));
  ok('print and email offered', /print or save as pdf/i.test(t) && /email it/i.test(t));
  await p.screenshot({ path: `${__dirname}/report_screen.png`, fullPage: true });

  // pick a different day and the numbers must change
  const before = (t.match(/Coffees[\s\S]{0,60}/) || [''])[0];
  const chips = p.locator('button', { hasText: /^\w{3} \d+ \w{3}\s*\d+$/ });
  if (await chips.count() > 1) {
    await chips.nth(1).click(); await p.waitForTimeout(2500);
    const after = ((await p.locator('body').innerText()).match(/Coffees[\s\S]{0,60}/) || [''])[0];
    ok('picking another day re-reads the orders', before !== after);
  }
  ok('no page errors', errs.length === 0, errs[0] || '');
  await browser.close();
  console.log(`\nPASS ${pass.length}/${pass.length + fail.length}`);
  pass.forEach(x => console.log('  ok   ' + x));
  fail.forEach(x => console.log('  FAIL ' + x));
})();
