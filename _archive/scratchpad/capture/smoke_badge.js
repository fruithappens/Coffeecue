// The badge scan, on a phone, end to end: Chrome's fake camera shows a QR
// carrying the badge number; the customer taps "Scan your badge instead";
// the name fills from the mirror; the order goes through as that person --
// and, because the mirror says Speaker and the VIP rule names Speaker, as a
// VIP at the rule's station.
const { chromium } = require('playwright-core'); const { execSync } = require('child_process'); const { eventCode } = require('./eventcode');
const BASE = process.env.BASE || 'http://localhost:5001'; const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const sql=(q)=>execSync(`psql cupq_next -tAc ${JSON.stringify(q)}`,{encoding:'utf8'}).trim();
const results=[]; const ok=(n,c,d='')=>{ results.push(!!c); console.log((c?'  ok   ':'  FAIL ')+n+(d?' — '+d:'')); };
(async () => {
  sql(`insert into settings(key,value) values('attendee_lookup_enabled','true') on conflict(key) do update set value='true'`);
  sql(`delete from ea_attendees where ea_contact_id='badge-test-1'`);
  sql(`insert into ea_attendees (ea_contact_id, internal_number, first_name, last_name, mobile_e164, registration_category, synced_at) values ('badge-test-1', 77001, 'Ada','Lovelace','+61400000777','Speaker', now())`);
  sql(`insert into settings(key,value) values('vip_rule','{"markers":["Speaker"],"jump_queue":true,"station_id":2,"vip_only_stations":[]}') on conflict(key) do update set value=excluded.value`);
  const code = await eventCode(BASE);
  const b = await chromium.launch({ channel: 'chrome', args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--use-file-for-fake-video-capture=/tmp/badge.y4m'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, permissions: ['camera'] }); const p = await ctx.newPage(); const errs=[]; p.on('pageerror', e=>errs.push(e.message));
  await p.goto(`${BASE}/my?e=${code}`, { waitUntil: 'networkidle' }); await sleep(1500);
  const click = async (re) => { await p.locator('button:not([disabled])').filter({ hasText: re }).first().click(); await sleep(900); };
  await click(/Flat White/); await click(/Full Cream/); await click(/Normal/); await p.getByRole('button',{name:/Next/}).first().click(); await sleep(800);
  await click(/No number/); await sleep(600);
  ok('name step offers "Scan your badge instead"', await p.getByRole('button', { name: /Scan your badge/ }).isVisible());
  await p.getByRole('button', { name: /Scan your badge/ }).click(); await sleep(800);
  // Chrome's native decoder can read the fake feed before this line runs, in
  // which case the scanner has already closed with the name filled.
  const earlyName = await p.locator('input[placeholder="Type your name"]').inputValue().catch(() => '');
  ok('scanner opens with the camera (or has already read the badge)', earlyName === 'Ada' || /Point it at the QR|Opening the camera|Checking/.test(await p.locator('body').innerText()));
  await p.screenshot({ path: `${__dirname}/badge_scanner.png` });
  let named = false; for (let i = 0; i < 40; i++) { await sleep(500); if ((await p.locator('input[placeholder="Type your name"]').inputValue().catch(() => '')) === 'Ada') { named = true; break; } }
  ok('the badge is read and the name fills from the mirror', named, named ? `after ~${(await p.locator('input').first().inputValue())}` : (await p.locator('body').innerText()).replace(/\s+/g,' ').slice(0,140));
  await p.screenshot({ path: `${__dirname}/badge_named.png` });
  await p.getByRole('button',{name:/Next/}).first().click(); await sleep(1200);
  const t = await p.locator('body').innerText(); if (/Collect from/i.test(t)) await click(/Fastest/);
  await p.locator('button:visible').filter({ hasText: /Place order/ }).first().click(); await sleep(4000);
  const num = ((await p.locator('body').innerText()).match(/YOUR ORDER\s*#\s*(\d+)/i) || [])[1];
  ok('order placed', !!num, `#${num}`);
  const row = sql(`select coalesce(order_details->>'name','')||'|'||queue_priority||'|'||station_id||'|'||coalesce(order_details->>'vip_reason','')||'|'||coalesce(order_details->>'ea_contact_id','') from orders where order_number='${num}'`);
  ok('the order is Ada\'s, a VIP (Speaker), at the rule\'s station, tied to her contact id', /^Ada( L)?\|1\|2\|Speaker\|badge-test-1$/.test(row), row);
  console.log('page errors:', errs.length ? errs : 'none'); await b.close();
  sql(`delete from orders where order_number='${num}'`); sql(`delete from ea_attendees where ea_contact_id='badge-test-1'`);
  sql(`update settings set value='{"markers":[],"jump_queue":true,"station_id":null,"vip_only_stations":[]}' where key='vip_rule'`);
  const fails=results.filter(x=>!x).length; console.log(`\nPASS ${results.length-fails}/${results.length}`); process.exit(fails?1:0);
})().catch(e=>{ console.log('HARNESS ERROR', e.message); process.exit(2); });
