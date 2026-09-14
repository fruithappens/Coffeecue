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
  let right = false; for (let i = 0; i < 40; i++) { await sleep(500); if (/Is this right\?/.test(await body())) { right = true; break; } }
  const t1 = await body();
  ok('Ada\'s badge (mobile on file): the step becomes "Is this right? -- Yes, text that number"', right && /We have Ada and a mobile number/.test(t1.replace(/\s+/g,' ')) && /Yes — text that number/.test(t1), t1.replace(/\s+/g,' ').slice(0, 120));
  ok('the number itself is not on the page', !/0400 ?000 ?777|\+61400000777/.test(t1));
  await p.screenshot({ path: `${__dirname}/badge_phone_right.png` });
  await click(/Yes — text that number/); await sleep(1200);
  let t2 = await body(); if (/Collect from/i.test(t2)) { await click(/Fastest/); t2 = await body(); }
  ok('no name step: straight on to review as Ada', /Ada/.test(t2) && /Place order/.test(t2) && !/Type your name/.test(t2), t2.replace(/\s+/g,' ').slice(0, 100));
  await p.locator('button:visible').filter({ hasText: /Place order/ }).first().click(); await sleep(4000);
  const num = ((await body()).match(/YOUR ORDER\s*#\s*(\d+)/i) || [])[1];
  const row = num ? sql(`select coalesce(order_details->>'name','')||'|'||coalesce(phone,'')||'|'||coalesce(order_details->>'ea_contact_id','') from orders where order_number='${num}'`) : '';
  ok('the order is Ada\'s, with her registered mobile, tied to her contact id', /^Ada( L)?\|\+61400000777\|badge-test-1$/.test(row), row || 'no order');
  console.log('page errors:', errs.length ? errs : 'none'); await b.close();
  if (num) sql(`delete from orders where order_number='${num}'`); sql(`delete from ea_attendees where ea_contact_id in ('badge-test-1','badge-test-2')`);
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`); process.exit(results.every(Boolean) ? 0 : 1);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
