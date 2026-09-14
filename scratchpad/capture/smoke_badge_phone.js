// The badge scan on the PHONE step -- the first identity step, where Steve
// looked for it. Ada's registration carries a mobile, so the step turns into
// "Is this right? -- Yes, text that number" and nothing is typed. The fake
// camera shows her badge.
const { chromium } = require('playwright-core'); const { execSync } = require('child_process'); const { eventCode } = require('./eventcode');
const BASE = process.env.BASE || 'http://localhost:5001'; const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const sql=(q)=>execSync(`psql cupq_next -tAc ${JSON.stringify(q)}`,{encoding:'utf8'}).trim();
const results=[]; const ok=(n,c,d='')=>{ results.push(!!c); console.log((c?'  ok   ':'  FAIL ')+n+(d?' — '+d:'')); };
(async () => {
  sql(`insert into settings(key,value) values('attendee_lookup_enabled','true') on conflict(key) do update set value='true'`);
  sql(`delete from ea_attendees where ea_contact_id in ('badge-test-1','badge-test-2')`);
  sql(`insert into ea_attendees (ea_contact_id, internal_number, first_name, last_name, mobile_e164, synced_at) values ('badge-test-1', 77001, 'Ada','Lovelace','+61400000777', now())`);
  const code = await eventCode(BASE);
  const b = await chromium.launch({ channel: 'chrome', args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--use-file-for-fake-video-capture=/tmp/badge.y4m'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, permissions: ['camera'] }); const p = await ctx.newPage(); const errs=[]; p.on('pageerror', e=>errs.push(e.message));
  const body = () => p.locator('body').innerText();
  const click = async (re) => { await p.locator('button:not([disabled])').filter({ hasText: re }).first().click(); await sleep(900); };
  await p.goto(`${BASE}/my?e=${code}`, { waitUntil: 'networkidle' }); await sleep(1500);
  await click(/Flat White/); await click(/Full Cream/); await click(/Normal/); await p.getByRole('button',{name:/Next/}).first().click(); await sleep(800);
  ok('the phone step comes first and offers "Scan your badge instead"', /mobile/i.test(await body()) && await p.getByRole('button', { name: /Scan your badge/ }).isVisible());
  await p.screenshot({ path: `${__dirname}/badge_phone_step.png` });
  await p.getByRole('button', { name: /Scan your badge/ }).click();
  let right = false; for (let i = 0; i < 40; i++) { await sleep(500); if (/Is this you\?/.test(await body())) { right = true; break; } }
  const t1 = await body();
  ok('Ada\'s badge (mobile on file): "Is this you? Ada -- with a mobile ending in …777 on file -- Yes, text that number"', right && /Ada/.test(t1) && /mobile ending in …777 on file/.test(t1) && /Yes — text that number/.test(t1) && /Text a different number/.test(t1) && /Not me/.test(t1), t1.replace(/\s+/g,' ').slice(0, 160));
  ok('only the last three digits are on the page', !/0400 ?000|400000777/.test(t1));
  await p.screenshot({ path: `${__dirname}/badge_phone_right.png` });
  await click(/Yes — text that number/); await sleep(1200);
  let t2 = await body(); if (/Collect from/i.test(t2)) { await click(/Fastest/); t2 = await body(); }
  ok('no name step: straight on to review as Ada', /Ada/.test(t2) && /Place order/.test(t2) && !/Type your name/.test(t2), t2.replace(/\s+/g,' ').slice(0, 100));
  await p.locator('button:visible').filter({ hasText: /Place order/ }).first().click(); await sleep(4000);
  const num = ((await body()).match(/YOUR ORDER\s*#\s*(\d+)/i) || [])[1];
  const row = num ? sql(`select coalesce(order_details->>'name','')||'|'||coalesce(phone,'')||'|'||coalesce(order_details->>'ea_contact_id','') from orders where order_number='${num}'`) : '';
  ok('the order is Ada\'s, with her registered mobile, tied to her contact id', /^Ada( L)?\|\+61400000777\|badge-test-1$/.test(row), row || 'no order');
  // --- Second pass: the same badge, but the registration has NO mobile.
  sql(`update ea_attendees set mobile_e164 = NULL where ea_contact_id='badge-test-1'`);
  // A fresh context: the first page remembers Ada's order and opens on it.
  const ctx2 = await b.newContext({ viewport: { width: 390, height: 844 }, permissions: ['camera'] });
  const p2 = await ctx2.newPage(); p2.on('pageerror', e=>errs.push(e.message));
  const body2 = () => p2.locator('body').innerText();
  const click2 = async (re) => { await p2.locator('button:not([disabled])').filter({ hasText: re }).first().click(); await sleep(900); };
  await p2.goto(`${BASE}/my?e=${code}`, { waitUntil: 'networkidle' }); await sleep(1500);
  await click2(/Flat White/); await click2(/Full Cream/); await click2(/Normal/); await p2.getByRole('button',{name:/Next/}).first().click(); await sleep(800);
  await p2.getByRole('button', { name: /Scan your badge/ }).click();
  let you = false; for (let i = 0; i < 40; i++) { await sleep(500); if (/Is this you\?/.test(await body2())) { you = true; break; } }
  const t3 = await body2();
  ok('no mobile on file: still "Is this you? Ada -- no mobile number on file", with add-a-mobile / no-texts / not-me', you && /No mobile number on file/.test(t3) && /add a mobile/.test(t3) && /no texts/i.test(t3) && /Not me/.test(t3), t3.replace(/\s+/g,' ').slice(0, 140));
  await p2.screenshot({ path: `${__dirname}/badge_phone_nomobile.png` });
  await click2(/add a mobile/); await sleep(600);
  const t4 = await body2();
  ok('"add a mobile" shows the number box with the name already known', /mobile/i.test(t4) && (await p2.locator('input[placeholder="04XX XXX XXX"]').count()) === 1, t4.replace(/\s+/g,' ').slice(0, 100));
  await click2(/No number/); await sleep(1000);
  let t5 = await body2(); if (/Collect from/i.test(t5)) { await click2(/Fastest/); t5 = await body2(); }
  ok('skipping the number goes straight to review as Ada (no name step)', /Ada/.test(t5) && /Place order/.test(t5) && !/Type your name/.test(t5));
  // --- Third pass: mobile on file, but "Text a different number".
  sql(`update ea_attendees set mobile_e164 = '+61400000777' where ea_contact_id='badge-test-1'`);
  const ctx3 = await b.newContext({ viewport: { width: 390, height: 844 }, permissions: ['camera'] });
  const p3 = await ctx3.newPage(); p3.on('pageerror', e=>errs.push(e.message));
  const body3 = () => p3.locator('body').innerText();
  const click3 = async (re) => { await p3.locator('button:not([disabled])').filter({ hasText: re }).first().click(); await sleep(900); };
  await p3.goto(`${BASE}/my?e=${code}`, { waitUntil: 'networkidle' }); await sleep(1500);
  await click3(/Flat White/); await click3(/Full Cream/); await click3(/Normal/); await p3.getByRole('button',{name:/Next/}).first().click(); await sleep(800);
  await p3.getByRole('button', { name: /Scan your badge/ }).click();
  for (let i = 0; i < 40; i++) { await sleep(500); if (/Is this you\?/.test(await body3())) break; }
  await click3(/Text a different number/); await sleep(600);
  const t6 = await body3();
  ok('"Text a different number" keeps the name and shows the number box', (await p3.locator('input[placeholder="04XX XXX XXX"]').count()) === 1 && !/Is this you/.test(t6));
  await p3.locator('input[placeholder="04XX XXX XXX"]').fill('0400000999'); await sleep(300); await click3(/Continue/); await sleep(1500);
  let t7 = await body3(); if (/Collect from/i.test(t7)) { await click3(/Fastest/); t7 = await body3(); }
  ok('a typed number goes to review still as Ada (not re-looked-up, no name step)', /Ada/.test(t7) && /Place order/.test(t7) && !/Type your name/.test(t7), t7.replace(/\s+/g,' ').slice(0, 90));
  console.log('page errors:', errs.length ? errs : 'none'); await b.close();
  if (num) sql(`delete from orders where order_number='${num}'`); sql(`delete from ea_attendees where ea_contact_id in ('badge-test-1','badge-test-2')`);
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`); process.exit(results.every(Boolean) ? 0 : 1);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
