// The EventsAir Thank You page hands the person to us: its Link Button with
// "Append contact ID to URL" on. We do not know the key EA uses, so every
// spelling must open the page already knowing them -- "Is this you? Ada,
// mobile ending in …777" -- with nothing typed and no camera.
const { chromium } = require('playwright-core'); const { execSync } = require('child_process'); const { eventCode } = require('./eventcode');
const BASE = process.env.BASE || 'http://localhost:5001'; const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const sql=(q)=>execSync(`psql cupq_next -tAc ${JSON.stringify(q)}`,{encoding:'utf8'}).trim();
const res=[]; const check=(n,ok,d='')=>{ res.push(!!ok); console.log((ok?'PASS  ':'FAIL  ')+n+(d?'  '+d:'')); };
(async () => {
  sql(`insert into settings(key,value) values('attendee_lookup_enabled','true') on conflict(key) do update set value='true'`);
  const G = 'A1B2C3D4-0000-4000-8000-000000000777';
  sql(`delete from ea_attendees where ea_contact_id='${G}'`);
  sql(`insert into ea_attendees (ea_contact_id, internal_number, first_name, last_name, mobile_e164, synced_at) values ('${G}', 77777, 'Ada','Lovelace','+61400000777', now())`);
  const code = await eventCode(BASE);
  const b = await chromium.launch({ channel: 'chrome' }); const errs = [];
  for (const q of [`cid=${G}`, `ContactID=${G}`, `contactId=${G}`, `contact_id=${G}`, G]) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 } }); const p = await ctx.newPage(); p.on('pageerror', e=>errs.push(e.message));
    await p.goto(`${BASE}/my?e=${code}&${q}`, { waitUntil: 'networkidle' }); await sleep(2000);
    const t0 = (await p.locator('body').innerText()).replace(/\s+/g,' ');
    const click = async (re) => { await p.locator('button:not([disabled])').filter({ hasText: re }).first().click(); await sleep(900); };
    await click(/Order something else/); await click(/Flat White/); await click(/Full Cream/); await click(/Normal/); await p.getByRole('button',{name:/Next/}).first().click(); await sleep(900);
    const t = (await p.locator('body').innerText()).replace(/\s+/g,' ');
    check(`?${q.slice(0, 14)}… opens knowing Ada -> "Is this you? …777" with no typing`, /Hi Ada/.test(t0) && /Is this you\?/.test(t) && /…777/.test(t), t.slice(60, 150));
    await ctx.close();
  }
  // an unexpanded merge token is ignored, not an error
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } }); const p = await ctx.newPage(); p.on('pageerror', e=>errs.push(e.message));
  await p.goto(`${BASE}/my?e=${code}&cid={ContactID}`, { waitUntil: 'networkidle' }); await sleep(2000);
  const t = (await p.locator('body').innerText()).replace(/\s+/g,' ');
  check('a literal {ContactID} token is ignored and the ordinary flow shows', /Order here|Flat White/.test(t) && !/Hi \{/.test(t));
  await b.close();
  sql(`delete from ea_attendees where ea_contact_id='${G}'`);
  check('no page errors', errs.length === 0, errs.join(' | ').slice(0, 120));
  console.log(`\n${res.filter(Boolean).length}/${res.length} passed`); process.exit(res.every(Boolean) ? 0 : 1);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
