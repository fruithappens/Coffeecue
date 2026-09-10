const { chromium } = require('playwright-core'); const BASE='http://localhost:5001'; const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
(async () => {
  const b = await chromium.launch({ channel: 'chrome' }); const p = await b.newPage({ viewport: { width: 1280, height: 900 } }); const errs=[]; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`${BASE}/organiser`, { waitUntil: 'networkidle' }); await sleep(1200);
  if (/sign in|log in|password/i.test(await p.locator('body').innerText())) { await p.fill('input[name="username"], input[type="text"]','coffeecue'); await p.fill('input[type="password"]','adminpassword'); await p.click('button[type="submit"]'); await sleep(3500); }
  await p.goto(`${BASE}/organiser`, { waitUntil: 'networkidle' }); await sleep(2000);
  for (const name of ['Operations', 'Messages']) { const el = p.getByRole('button', { name: new RegExp('^'+name) }).first(); if (await el.isVisible().catch(()=>false)) { await el.click(); await sleep(1200); } else { const t = p.getByText(name, { exact: true }).first(); if (await t.isVisible().catch(()=>false)) { await t.click(); await sleep(1200); } else console.log('could not find tab', name); } }
  const text = await p.locator('body').innerText();
  const ok=(n,c)=>console.log((c?'  ok   ':'  FAIL ')+n);
  ok('composer opens (Tell everyone)', /tell everyone/i.test(text)); ok('presets offered', /out of a milk/i.test(text) && /cart down/i.test(text));
  ok('all three channels offered', /screens/i.test(text) && /phones/i.test(text) && /text/i.test(text)); ok('text costs are spelled out', /costs money/i.test(text));
  console.log('page errors:', errs.length ? errs : 'none'); await p.screenshot({ path: `${__dirname}/composer_on_main.png` }); await b.close();
})();
