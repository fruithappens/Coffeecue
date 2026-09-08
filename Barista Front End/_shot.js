const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ channel: 'chrome' });
  const p = await b.newPage({ viewport: { width: 900, height: 1200 } });
  await p.goto('file://' + process.argv[2], { waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);
  await p.screenshot({ path: process.argv[3], fullPage: true });
  await b.close();
})();
