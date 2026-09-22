// The report says who they were and how they wanted to be told. Place four
// orders four ways on the copy -- typed name + no texts, mobile lookup +
// texts, a badge scan (wedge) + registered number, an app-link arrival --
// then read the report's 'people' block and the card.
const { chromium } = require('playwright-core'); const { execSync } = require('child_process'); const { eventCode } = require('./eventcode');
const BASE = process.env.BASE || 'http://localhost:5001'; const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const sql=(q)=>execSync(`psql cupq_next -tAc ${JSON.stringify(q)}`,{encoding:'utf8'}).trim();
const res=[]; const check=(n,ok,d='')=>{ res.push(!!ok); console.log((ok?'PASS  ':'FAIL  ')+n+(d?'  '+d:'')); };
(async () => {
  sql(`insert into settings(key,value) values('attendee_lookup_enabled','true') on conflict(key) do update set value='true'`);
  sql(`delete from ea_attendees where ea_contact_id in ('badge-test-1','badge-test-2')`);
  sql(`insert into ea_attendees (ea_contact_id, internal_number, first_name, last_name, mobile_e164, synced_at) values ('badge-test-1', 77001, 'Ada','Lovelace','+61400000777', now()), ('badge-test-2', 77002, 'Bob','Byrne','+61400000778', now())`);
  const code = await eventCode(BASE); const nums = [];
  const b = await chromium.launch({ channel: 'chrome' }); const errs = [];
  const order = async (label, fn) => {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 } }); const p = await ctx.newPage(); p.on('pageerror', e=>errs.push(label+': '+e.message));
    const click = async (re) => { await p.locator('button:not([disabled])').filter({ hasText: re }).first().click(); await sleep(900); };
    const body = () => p.locator('body').innerText();
    const before = sql(`select coalesce(max(id),0) from orders`);
    await fn(p, click, body);
    const num = sql(`select order_number from orders where id > ${before} order by id desc limit 1`); nums.push(num); check(`${label}: order placed`, !!num, num ? `#${num}` : (await body()).replace(/\s+/g,' ').slice(0, 100));
    await ctx.close();
  };
  const drink = async (p, click) => { await click(/Flat White/); await click(/Full Cream/); await click(/Normal/); await p.getByRole('button',{name:/Next/}).first().click(); await sleep(800); };
  const place = async (p, click, body) => { let t = await body(); if (/Collect from/i.test(t)) await click(/Fastest/); await p.locator('button:visible').filter({ hasText: /Place order/ }).first().click(); await sleep(3500); };
  // 1. typed a name, no texts
  await order('typed name, no texts', async (p, click, body) => {
    await p.goto(`${BASE}/my?e=${code}`, { waitUntil: 'networkidle' }); await sleep(1200); await drink(p, click);
    await click(/No number/); await p.locator('input[placeholder="Type your name"]').fill('People drill'); await p.getByRole('button',{name:/Next/}).first().click(); await sleep(1000); await place(p, click, body);
  });
  // 2. mobile found the name, texts on
  await order('mobile lookup, texts', async (p, click, body) => {
    await p.goto(`${BASE}/my?e=${code}`, { waitUntil: 'networkidle' }); await sleep(1200); await drink(p, click);
    await p.locator('input[placeholder="04XX XXX XXX"]').fill('0400000778'); await sleep(400); await click(/Continue/); await sleep(1500);
    await click(/Yes, I’m Bob|I'm Bob|Yes/); await sleep(1000); await place(p, click, body);
  });
  // 3. badge (wedge) + registered number
  await order('badge scan, registered number', async (p, click, body) => {
    await p.goto(`${BASE}/my?e=${code}`, { waitUntil: 'networkidle' }); await sleep(1200); await drink(p, click);
    await p.locator('input[placeholder="04XX XXX XXX"]').focus(); await p.keyboard.type('badge-test-1', { delay: 4 }); await p.keyboard.press('Enter'); await sleep(2500);
    await click(/Yes — text that number/); await sleep(1000); await place(p, click, body);
  });
  // 4. arrived from the app link
  await order('app link, texts', async (p, click, body) => {
    await p.goto(`${BASE}/my?e=${code}&cid=badge-test-2`, { waitUntil: 'networkidle' }); await sleep(2000);
    await click(/Order something else/); await drink(p, click);
    await click(/Yes — text that number/); await sleep(1000); await place(p, click, body);
  });
  // the report
  const login = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'coffeecue', password: 'adminpassword' }) }).then(r => r.json());
  const H = { Authorization: `Bearer ${login.token}` };
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Adelaide' });
  const rep = await fetch(`${BASE}/api/reports/today?date=${today}`, { headers: H }).then(r => r.json());
  const pp = rep.people || {};
  console.log('  people:', JSON.stringify(pp));
  // Identified people (badge, app, or the number that found them) get the
  // ready text to their registered number; only the typed name watches.
  check('the report counts who chose texts and who watched', pp.orders >= 4 && pp.chose_texts >= 3 && pp.watched_screen >= 1 && pp.gave_mobile >= 3);
  check('and how they identified themselves', (pp.identified?.badge || 0) >= 1 && (pp.identified?.number || 0) >= 1 && (pp.identified?.app || 0) >= 1 && (pp.identified?.name || 0) >= 1, JSON.stringify(pp.identified));
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript((t) => { localStorage.setItem('coffee_system_token', t); localStorage.setItem('coffee_system_user', JSON.stringify({ username: 'coffeecue', role: 'admin', id: 1 })); }, login.token);
  const p = await ctx.newPage(); await p.goto(`${BASE}/run#report`, { waitUntil: 'load' }); await sleep(5000);
  await p.getByRole('button', { name: /^(Sat|Sun|Mon|Tue|Wed|Thu|Fri) \d+ \w+\s*\d+$/ }).first().click().catch(() => {}); await sleep(4000);
  const t = await p.evaluate(() => document.body.innerText);
  check('the Report card shows the split in words', /Who they were, and how they wanted to be told/.test(t) && /Badge scan/i.test(t) && /Mobile lookup/i.test(t) && /chose texts/.test(t), (t.match(/Who they were[\s\S]{0,200}/) || [''])[0].replace(/\n/g, ' | ').slice(0, 160));
  await p.screenshot({ path: `${__dirname}/report_people.png`, fullPage: true });
  await b.close();
  for (const n of nums) if (n) sql(`delete from orders where order_number='${n}'`);
  sql(`delete from ea_attendees where ea_contact_id in ('badge-test-1','badge-test-2')`);
  check('no page errors', errs.length === 0, errs.join(' | ').slice(0, 160));
  console.log(`\n${res.filter(Boolean).length}/${res.length} passed`); process.exit(res.every(Boolean) ? 0 : 1);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
