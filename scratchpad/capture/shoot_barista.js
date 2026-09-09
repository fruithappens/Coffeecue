// Shots of what the runner sweep cannot reach: the barista tabs and the
// manager tools behind the PIN.
const { chromium } = require('playwright-core');
const BASE='http://localhost:5001'; const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
(async () => {
  const b = await chromium.launch({ channel: 'chrome' });
  const p = await b.newPage({ viewport: { width: 1180, height: 900 } });
  var shot = async (n) => { await p.screenshot({ path: `${__dirname}/btab_${n}.png`, fullPage: true }); console.log('shot', n); };
  await p.goto(`${BASE}/barista`, { waitUntil: 'networkidle' }); await sleep(1200);
  if (/sign in|password/i.test(await p.locator('body').innerText())) {
    await p.fill('input[name="username"], input[type="text"]', 'coffeecue');
    await p.fill('input[type="password"]', 'adminpassword');
    await p.click('button[type="submit"]'); await sleep(3500);
  }
  // admin sign-in lands on the runner; go back to the barista screen
  await p.goto(`${BASE}/barista`, { waitUntil: 'networkidle' }); await sleep(2500);
  await shot('queue');
  for (const tab of ['Stock','Tools']) { await p.locator('[role=tab]', { hasText: tab }).first().click(); await sleep(1800); await shot(tab.toLowerCase()); }
  // the lock
  await p.getByRole('button', { name: 'Station admin' }).click(); await sleep(600);
  for (const d of '1234') { await p.getByRole('button', { name: d, exact: true }).click(); await sleep(120); }
  await p.getByRole('button', { name: 'Unlock' }).click().catch(()=>{}); await sleep(1500);
  await shot('admin_sheet');
  for (const [label, n] of [['Queue rules','queue_rules'],['Balance','balance']]) {
    await p.getByRole('button', { name: label }).click(); await sleep(1800); await shot(n);
    await p.getByRole('button', { name: 'Station admin' }).click().catch(()=>{}); await sleep(800);
  }
  await b.close();
})();
