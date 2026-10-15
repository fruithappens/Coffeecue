// A USB / Bluetooth badge scanner on the station touchscreen: it types the
// QR's text in milliseconds and presses Enter. On the phone step that must
// become "Is this you?" with the typed characters taken back out of the box;
// a person typing at human speed must NOT trigger it. And inside another
// app's frame the camera button is hidden (it cannot work there) while the
// wired scanner still does.
const { chromium } = require('playwright-core'); const { execSync } = require('child_process'); const { eventCode } = require('./eventcode'); const fs = require('fs');
const BASE = process.env.BASE || 'http://localhost:5001'; const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const sql=(q)=>execSync(`psql cupq_next -tAc ${JSON.stringify(q)}`,{encoding:'utf8'}).trim();
const res=[]; const check=(n,ok,d='')=>{ res.push(!!ok); console.log((ok?'PASS  ':'FAIL  ')+n+(d?'  '+d:'')); };
(async () => {
  sql(`insert into settings(key,value) values('attendee_lookup_enabled','true') on conflict(key) do update set value='true'`);
  sql(`delete from ea_attendees where ea_contact_id='badge-test-1'`);
  sql(`insert into ea_attendees (ea_contact_id, internal_number, first_name, last_name, mobile_e164, synced_at) values ('badge-test-1', 77001, 'Ada','Lovelace','+61400000777', now())`);
  const code = await eventCode(BASE);
  const b = await chromium.launch({ channel: 'chrome' });
  const ctx = await b.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true }); const p = await ctx.newPage(); const errs=[]; p.on('pageerror', e=>errs.push(e.message));
  const body = () => p.locator('body').innerText();
  const click = async (re) => { await p.locator('button:not([disabled])').filter({ hasText: re }).first().click(); await sleep(900); };
  // 1. the kiosk (top level, as on the station's touchscreen)
  await p.goto(`${BASE}/my?e=${code}`, { waitUntil: 'networkidle' }); await sleep(1500);
  await click(/Flat White/); await click(/Full Cream/); await click(/Normal/); await p.getByRole('button',{name:/Next/}).first().click(); await sleep(800);
  await p.locator('input[placeholder="04XX XXX XXX"]').focus();
  // a person typing at human speed: nothing happens
  await p.keyboard.type('badge-test-1', { delay: 120 }); await p.keyboard.press('Enter'); await sleep(1500);
  check('typing a badge id slowly, like a person, does NOT scan', !/Is this you\?/.test(await body()));
  await p.locator('input[placeholder="04XX XXX XXX"]').fill('');
  // the scanner: the same text in a burst, then Enter
  await p.keyboard.type('badge-test-1', { delay: 4 }); await p.keyboard.press('Enter'); await sleep(2500);
  const t1 = await body();
  check('a scanner-speed burst + Enter on the phone step -> "Is this you? Ada -- mobile ending in …777"', /Is this you\?/.test(t1) && /Ada/.test(t1) && /…777/.test(t1), t1.replace(/\s+/g,' ').slice(0, 120));
  await click(/Yes — text that number/); await sleep(1200);
  let t2 = await body(); if (/Collect from/i.test(t2)) { await click(/Fastest/); t2 = await body(); }
  check('and on to review as Ada with nothing typed', /Ada/.test(t2) && /Place order/.test(t2) && !/badge-test-1/.test(t2));
  // 2. inside another app's frame: camera button hidden, wedge still works
  fs.writeFileSync('/tmp/ea_host2.html', `<div style="height:100vh"><iframe src="${BASE}/my?e=${code}" style="width:100%;height:100vh;border:0"></iframe></div>`);
  const p2 = await ctx.newPage(); p2.on('pageerror', e=>errs.push(e.message));
  await p2.goto('file:///tmp/ea_host2.html'); await sleep(2500);
  const f = p2.frameLocator('iframe');
  const click2 = async (re) => { await f.locator('button:not([disabled])').filter({ hasText: re }).first().click(); await sleep(900); };
  await click2(/Flat White/); await click2(/Full Cream/); await click2(/Normal/); await f.getByRole('button',{name:/Next/}).first().click(); await sleep(800);
  check('inside another app\'s frame the camera button is not offered', (await f.getByRole('button', { name: /Scan your badge/ }).count()) === 0);
  await f.locator('input[placeholder="04XX XXX XXX"]').focus();
  await p2.keyboard.type('badge-test-1', { delay: 4 }); await p2.keyboard.press('Enter'); await sleep(2500);
  const t3 = await f.locator('body').innerText();
  check('but a wired scanner still identifies them there', /Is this you\?/.test(t3) && /Ada/.test(t3));
  await b.close();
  sql(`delete from ea_attendees where ea_contact_id='badge-test-1'`);
  check('no page errors', errs.length === 0, errs.join(' | ').slice(0, 120));
  console.log(`\n${res.filter(Boolean).length}/${res.length} passed`); process.exit(res.every(Boolean) ? 0 : 1);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
