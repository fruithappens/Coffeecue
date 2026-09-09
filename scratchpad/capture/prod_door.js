const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ channel: 'chrome' });
  const ctx = await b.newContext({ viewport: { width: 430, height: 900 } });
  for (const [name, url] of [
    ['cold', 'https://cupq.app/'],
    ['poster', 'https://cupq.app/treenet26'],
    ['qr', 'https://cupq.app/my?e=treenet26'],
  ]) {
    const p = await ctx.newPage();
    await p.goto(url, { waitUntil: 'networkidle', timeout: 45000 }).catch(e => console.log(name, 'nav:', e.message));
    await p.waitForTimeout(2500);
    const txt = (await p.locator('body').innerText().catch(() => '')).replace(/\n+/g, ' | ').slice(0, 260);
    console.log(`\n--- ${name} (${p.url()})\n${txt}`);
    await p.screenshot({ path: `prod_door_${name}.png` });
    await p.close();
  }
  await b.close();
})();
