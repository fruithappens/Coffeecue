// Old (production, cupq.app) vs new (the copy) -- the same journey on both,
// starting where a person actually starts.
const { chromium } = require('playwright-core');
const fs = require('fs');
const OUT = `${process.env.HOME}/cupq-next/docs/compare`;
fs.mkdirSync(OUT, { recursive: true });
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const OLD = 'https://cupq.app';
const NEW = 'http://localhost:5001';

// Same destination, different address in each system.
const PAIRS = [
  ['welcome',      '/',                    '/',                    'Where you land'],
  ['barista',      '/barista',             '/barista',             'The barista screen'],
  ['organiser',    '/organiser',           '/run#quickSetup',      'Setting the event up'],
  ['menu',         '/organiser#inventory', '/run#menu/inventory',  'The menu'],
  ['stock',        '/organiser#stock',     '/run#menu/stock',      'Stock'],
  ['branding',     '/organiser#branding',  '/run#branding/logo',   'Branding'],
  ['stations',     '/organiser#stations',  '/run#stations',        'Stations'],
  ['support',      '/support',             '/run#live/readiness',  'Watching the day'],
  ['messages',     '/support#messages',    '/run#messages/notice', 'Telling people things'],
  ['printers',     '/support#printers',    '/run#printers',        'Printers'],
  ['screens',      '/displays',            '/displays',            'The screens'],
  ['order',        '/order',               '/order',               'What a customer sees'],
];

async function shoot(ctx, base, path, file, needsLogin) {
  const p = await ctx.newPage();
  try {
    await p.goto(base + path, { waitUntil: 'networkidle', timeout: 45000 });
    await p.waitForTimeout(2000);
    const txt = await p.locator('body').innerText().catch(() => '');
    if (needsLogin && /sign in|log in|password/i.test(txt)) {
      await p.fill('input[name="username"], input[type="text"]', 'coffeecue').catch(() => {});
      await p.fill('input[type="password"]', 'adminpassword').catch(() => {});
      await p.click('button[type="submit"]').catch(() => {});
      await p.waitForTimeout(4000);
      await p.goto(base + path, { waitUntil: 'networkidle', timeout: 45000 });
      await p.waitForTimeout(2500);
    }
    await p.screenshot({ path: `${OUT}/${file}.png`, fullPage: true });
    console.log(`   ${file}`);
  } catch (e) {
    console.log(`   ${file}  FAILED ${String(e).slice(0, 60)}`);
  } finally { await p.close(); }
}

(async () => {
  const b = await chromium.launch({ channel: 'chrome' });
  for (const [side, base] of [['old', OLD], ['new', NEW]]) {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, userAgent: UA });
    console.log(`\n${side.toUpperCase()} — ${base}`);
    // sign in once per side
    await shoot(ctx, base, '/barista', `${side}-warmup`, true);
    for (const [key, oldPath, newPath] of PAIRS) {
      await shoot(ctx, base, side === 'old' ? oldPath : newPath, `${side}-${key}`, true);
    }
    await ctx.close();
  }
  await b.close();
})();
