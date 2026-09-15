// The event code typed at the door must reach the order even after the URL
// is rewritten -- and in a frame with no ?e= at all (the old EventsAir embed)
// the order must still go through once the code has been typed. Plus: inside
// a frame the sponsor strip is in the flow under the card, not under the
// host's nav.
const { chromium } = require('playwright-core'); const { execSync } = require('child_process'); const fs = require('fs');
const { eventCode } = require('./eventcode');
const BASE = process.env.BASE || 'http://localhost:5001'; const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const sql=(q)=>execSync(`psql cupq_next -tAc ${JSON.stringify(q)}`,{encoding:'utf8'}).trim();
const res=[]; const check=(n,ok,d='')=>{ res.push(!!ok); console.log((ok?'PASS  ':'FAIL  ')+n+(d?'  '+d:'')); };
(async () => {
  const code = await eventCode(BASE);
  const access = await fetch(`${BASE}/api/event-access/public`).then(r => r.json());
  check('the copy requires the code (the drill needs a door)', !!access.require && !!code, `require=${access.require} code=${code}`);
  // The OLD embed: /my with no ?e= inside another page's frame.
  fs.writeFileSync('/tmp/ea_host3.html', `<div style="height:100vh"><iframe src="${BASE}/my" style="width:100%;height:100vh;border:0"></iframe></div>`);
  const b = await chromium.launch({ channel: 'chrome' }); const errs = [];
  const ctx = await b.newContext({ viewport: { width: 390, height: 700 }, hasTouch: true }); const p = await ctx.newPage(); p.on('pageerror', e=>errs.push(e.message));
  await p.goto('file:///tmp/ea_host3.html'); await sleep(2500);
  const f = p.frameLocator('iframe');
  const body = () => f.locator('body').innerText();
  check('the door asks for the code', /Event code/.test(await body()));
  await f.locator('input').first().fill(code); await f.getByRole('button', { name: 'Continue' }).click(); await sleep(1500);
  check('typed code opens the menu', /Flat White/.test(await body()));
  // Rewrite the frame's URL the way a "start again" or the host might: drop the query.
  await p.frames()[1].evaluate(() => window.history.replaceState({}, '', window.location.pathname));
  const click = async (re) => { await f.locator('button:not([disabled])').filter({ hasText: re }).first().click(); await sleep(900); };
  await click(/Flat White/); await click(/Full Cream/); await click(/Normal/); await f.getByRole('button',{name:/Next/}).first().click(); await sleep(800);
  await f.locator('input[placeholder="04XX XXX XXX"]').fill(''); await click(/No number/); await sleep(600);
  await f.locator('input[placeholder="Type your name"]').fill('Door drill'); await f.getByRole('button',{name:/Next/}).first().click(); await sleep(1200);
  let t = await body(); if (/Collect from/i.test(t)) { await click(/Fastest/); t = await body(); }
  check('review reached with the URL stripped of ?e=', /Place order/.test(t));
  check('inside the frame the sponsor strip is in the flow, not pinned', (await f.locator('.fixed.left-0.right-0.z-\\[55\\]').count()) === 0);
  await f.locator('button:visible').filter({ hasText: /Place order/ }).first().click(); await sleep(4000);
  t = await body();
  const num = (t.match(/YOUR ORDER\s*#\s*(\d+)/i) || [])[1];
  check('the order is accepted -- the typed code travelled with it', !!num && !/different event/.test(t), num ? `#${num}` : (t.match(/[^\n]*different event[^\n]*/) || ['no order number'])[0]);
  await p.screenshot({ path: `${__dirname}/door_carry.png` });
  await b.close();
  if (num) sql(`delete from orders where order_number='${num}'`);
  check('no page errors', errs.length === 0, errs.join(' | ').slice(0, 120));
  console.log(`\n${res.filter(Boolean).length}/${res.length} passed`); process.exit(res.every(Boolean) ? 0 : 1);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
