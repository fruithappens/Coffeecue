// The live site after a deploy: the screens a person lands on render, with no page error.
const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ channel: 'chrome' }); const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  for (const s of ['/', '/my?e=treenet26', '/display', '/design', '/login']) {
    const before = errs.length; await p.goto('https://cupq.app' + s, { waitUntil: 'networkidle', timeout: 45000 }).catch(e => errs.push(s + ': ' + e.message));
    await p.waitForTimeout(1500); const t = (await p.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
    console.log(`${errs.length === before ? '  ok  ' : '  FAIL'} ${s.padEnd(18)} ${t.slice(0, 80)}`);
  }
  console.log('page errors:', errs.length ? errs : 'none'); await b.close();
})();
