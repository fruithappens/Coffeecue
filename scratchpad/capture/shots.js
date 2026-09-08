const { chromium } = require('playwright-core');
const WANT = [['messages/blocked','blocked'],['settings','settings'],['emergency','emergency']];
(async () => {
  const b = await chromium.launch({ channel: 'chrome' });
  const p = await b.newPage({ viewport: { width: 1280, height: 1000 } });
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto('http://localhost:5001/run', { waitUntil: 'networkidle' });
  await p.waitForTimeout(900);
  if (/sign in|password/i.test(await p.locator('body').innerText())) {
    await p.fill('input[type="text"]','coffeecue'); await p.fill('input[type="password"]','adminpassword');
    await p.click('button[type="submit"]'); await p.waitForTimeout(3200);
  }
  for (const [hash, name] of WANT) {
    await p.goto(`http://localhost:5001/run#${hash}`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(2200);
    await p.screenshot({ path: `batch_${name}.png`, fullPage: true });
  }
  console.log('  page errors:', errs.length ? errs.slice(0,2).join(' | ').slice(0,200) : 'none');
  await b.close();
})();
