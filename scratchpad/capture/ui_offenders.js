// Name the exact elements still holding a screen back. The score says how far
// off a screen is; this says what to change.
const { chromium } = require('playwright-core');
const BASE = 'http://localhost:5001';
const WANT = process.argv.slice(2);
(async () => {
  const b = await chromium.launch({ channel: 'chrome' });
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  await p.goto(`${BASE}/run`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(900);
  if (/sign in|password/i.test(await p.locator('body').innerText())) {
    await p.fill('input[type="text"]', 'coffeecue'); await p.fill('input[type="password"]', 'adminpassword');
    await p.click('button[type="submit"]'); await p.waitForTimeout(3200);
  }
  for (const hash of WANT) {
    await p.goto(`${BASE}/run#${hash}`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(1800);
    const out = await p.evaluate(() => {
      const legacy = [...document.querySelectorAll('*')]
        .map(e => (e.className || '').toString())
        .flatMap(c => c.split(/\s+/))
        .filter(c => /^(bg|text|border|divide|ring)-(gray|blue|green|amber|red|yellow|indigo|purple|orange|slate|teal|pink)-\d{2,3}$/.test(c));
      const raw = [...document.querySelectorAll('input,select,textarea')]
        .filter(e => !/\bcq-/.test(e.className || '') && e.type !== 'file' && e.type !== 'hidden'
                     && !/\bhidden\b/.test(e.className || ''))
        .map(e => `${e.tagName.toLowerCase()}[${e.type || ''}] .${(e.className || '').trim().split(/\s+/).slice(0,3).join('.')}`);
      const tally = {}; legacy.forEach(c => { tally[c] = (tally[c] || 0) + 1; });
      return { classes: tally, raw: [...new Set(raw)] };
    });
    const cls = Object.entries(out.classes).map(([k, v]) => `${k}x${v}`).join(' ');
    console.log(`\n${hash}`);
    if (cls) console.log('  classes:', cls);
    out.raw.forEach(r => console.log('  raw    :', r));
    if (!cls && !out.raw.length) console.log('  clean');
  }
  await b.close();
})();
