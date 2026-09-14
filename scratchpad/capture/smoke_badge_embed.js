// The badge scanner inside another page's iframe with NO camera permission
// (how the EventsAir app shows /my): it must say so at the TOP, offer "Open
// in Safari", and never sit on a blank box. Plus: a top-level page where the
// camera is refused still explains itself.
const { chromium } = require('playwright-core'); const { eventCode } = require('./eventcode'); const fs = require('fs');
const BASE = process.env.BASE || 'http://localhost:5001'; const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const res=[]; const check=(n,ok,d='')=>{ res.push(!!ok); console.log((ok?'PASS  ':'FAIL  ')+n+(d?'  '+d:'')); };
(async () => {
  const code = await eventCode(BASE);
  // The EA app's own page: our /my in an iframe with NO allow="camera" (the old embed).
  fs.writeFileSync('/tmp/ea_host.html', `<div style="height:100vh"><iframe src="${BASE}/my?e=${code}" style="width:100%;height:100vh;border:0"></iframe></div>`);
  const b = await chromium.launch({ channel: 'chrome', args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 700 } }); const p = await ctx.newPage(); const errs=[]; p.on('pageerror', e=>errs.push(e.message));
  await p.goto('file:///tmp/ea_host.html'); await sleep(2500);
  const f = p.frameLocator('iframe');
  const click = async (re) => { await f.locator('button:not([disabled])').filter({ hasText: re }).first().click(); await sleep(900); };
  await click(/Flat White/); await click(/Full Cream/); await click(/Normal/); await f.getByRole('button',{name:/Next/}).first().click(); await sleep(800);
  await f.getByRole('button', { name: /Scan your badge/ }).click(); await sleep(7500);
  const dlg = f.getByRole('dialog', { name: 'Scan your badge' });
  const t = await dlg.innerText();
  check('inside a frame with no camera: the scanner says the event app cannot open the camera', /event app can’t open the camera/.test(t), t.replace(/\n/g,' | ').slice(0, 110));
  const openBtn = dlg.getByRole('link', { name: 'Open in Safari' });
  check('and offers "Open in Safari" (a new tab, so the camera is ours)', await openBtn.count() === 1 && (await openBtn.getAttribute('target')) === '_blank' && /\/my\?e=/.test(await openBtn.getAttribute('href') || ''), await openBtn.getAttribute('href'));
  const box = await openBtn.boundingBox();
  check('the words and the way out are on screen, not below the box', !!box && box.y < 400, box ? `y=${Math.round(box.y)}` : 'no box');
  await p.screenshot({ path: `${__dirname}/badge_embedded.png` });
  check('"Type it instead" still there', await dlg.getByRole('button', { name: 'Type it instead' }).count() === 1);
  await b.close();
  check('no page errors', errs.length === 0, errs.join(' | ').slice(0, 120));
  console.log(`\n${res.filter(Boolean).length}/${res.length} passed`); process.exit(res.every(Boolean) ? 0 : 1);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
