// One order's whole life on the LIVE site, the way a customer and a barista
// would do it. No phone number on the order, so nothing is texted.
const { chromium } = require('playwright-core'); const BASE='https://cupq.app'; const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const H0={ 'User-Agent': UA, 'Content-Type': 'application/json' };
const results=[]; const ok=(n,c,d='')=>{ results.push(!!c); console.log((c?'  ok   ':'  FAIL ')+n+(d?' — '+d:'')); };
const NAME='Live test '+String(Math.floor(Math.random()*900)+100);
(async () => {
  const login = await fetch(`${BASE}/api/auth/login`,{method:'POST',headers:H0,body:JSON.stringify({username:'coffeecue',password:'adminpassword'})}).then(r=>r.json());
  const H={...H0, Authorization:`Bearer ${login.token}`};
  const cfg = await fetch(`${BASE}/api/display/config`,{headers:H0}).then(r=>r.json()); const code=String((cfg.config||cfg).event_code||'');
  ok('event code published for the QR', !!code, code);

  const b = await chromium.launch({ channel: 'chrome' }); const ctx = await b.newContext({ userAgent: UA });
  // 1. The customer, on a phone, via the QR link
  const phone = await ctx.newPage({ viewport: { width: 390, height: 844 } }); const perr=[]; phone.on('pageerror', e=>perr.push(e.message));
  await phone.goto(`${BASE}/my?e=${code}`, { waitUntil: 'networkidle', timeout: 60000 }); await sleep(2000);
  ok('phone: menu opens straight from the QR link (no code prompt)', /Order here/i.test(await phone.locator('body').innerText()));
  const m = phone.locator('body');
  let body=null; phone.on('request', r => { if (r.method()==='POST' && r.url().includes('/api/display/order')) { try { body=r.postDataJSON(); } catch(e){} } });
  const respP = phone.waitForResponse(r => r.url().includes('/api/display/order') && r.request().method()==='POST', { timeout: 90000 }).then(r=>r.json()).catch(()=>null);
  for (let i=0;i<16;i++) {
    if (process.env.DEBUG) console.log(`step ${i}:`, (await m.innerText().catch(()=>'')).replace(/\s+/g,' ').slice(0,110));
    const place = m.getByRole('button', { name: /^Place (order|\d+ coffees)$/ }).first(); if (await place.isVisible().catch(()=>false)) { await place.click(); break; }
    const nameBox = m.locator('input[placeholder*="name" i], input[name="name"]').first(); if (await nameBox.isVisible().catch(()=>false) && !(await nameBox.inputValue())) await nameBox.fill(NAME);
    const next = m.getByRole('button', { name: /^(Next|Continue)/ }).first(); if (await next.isVisible().catch(()=>false) && await next.isEnabled().catch(()=>false)) { await next.click(); await sleep(700); continue; }
    const tile = m.locator('button:not([disabled])').filter({ hasText: /(Flat White|Full Cream|Regular|Medium|No sugar|None|Normal|No number|Skip|Fastest|Here|Counter)/i }).first(); if (await tile.isVisible().catch(()=>false)) { await tile.click(); await sleep(700); continue; }
    await sleep(500);
  }
  // The phone navigates to the live beacon the moment the POST lands, so the
  // response body is gone; the order number is on the screen instead.
  await respP; await sleep(2500); const doneText = await phone.locator('body').innerText();
  const mm = doneText.match(/YOUR ORDER\s*#\s*(\d+)/i); const num = mm && mm[1];
  ok('phone: order placed, beacon shows the number and the queue position', !!num && /in line|in the queue/i.test(doneText), num?`#${num} — ${(doneText.match(/You're #\d+ in line[^.]*/)||[''])[0]}`:'no order number on screen');
  await phone.screenshot({ path: `${__dirname}/e2e_phone_done.png` });

  // 2. Find it by name (public)
  const found = await fetch(`${BASE}/api/orders/find?name=${encodeURIComponent(NAME.slice(0,6))}`,{headers:H0}).then(r=>r.json());
  ok('find my order by name sees it, no phone key', (found.orders||[]).some(o=>String(o.order_number)===String(num)) && !JSON.stringify(found).includes('phone'));

  // 3. The board
  const board = await ctx.newPage({ viewport: { width: 1440, height: 900 } }); await board.goto(`${BASE}/display?station=all`, { waitUntil: 'networkidle', timeout: 60000 }); await sleep(3000);
  let bt = await board.locator('body').innerText();
  ok('board: a placed-but-not-started order is NOT shown as brewing (by design)', !new RegExp(String(num)).test(bt));

  // 4. The barista, via the API the tablet uses
  const list = await fetch(`${BASE}/api/orders`,{headers:H}).then(r=>r.json()); const row=(list.data||list.orders||[]).find(o=>String(o.orderNumber||o.order_number)===String(num));
  ok('barista sees it in /api/orders', !!row, row?`id ${row.id} station ${row.stationId||row.station_id}`:'');
  const st = await fetch(`${BASE}/api/orders/${row.id}/start`,{method:'POST',headers:H}).then(r=>r.status); ok('barista: Start', st<400, `${st}`);
  await board.reload({ waitUntil: 'networkidle' }); await sleep(3000); bt = await board.locator('body').innerText();
  const brewPart = (bt.split(/BREWING/i)[1]||'').split(/READY FOR PICKUP/i)[0]; ok('board: order is in BREWING once started', new RegExp(String(num)).test(brewPart));
  const cp = await fetch(`${BASE}/api/orders/${row.id}/complete`,{method:'POST',headers:H}).then(r=>r.status); ok('barista: Ready', cp<400, `${cp}`);
  await board.reload({ waitUntil: 'networkidle' }); await sleep(3000); bt = await board.locator('body').innerText();
  const readyPart = bt.split(/READY FOR PICKUP/i)[1]||''; ok('board: order moved to READY FOR PICKUP', new RegExp(String(num)).test(readyPart));
  await board.screenshot({ path: `${__dirname}/e2e_board_ready.png` });
  const pu = await fetch(`${BASE}/api/orders/${row.id}/pickup`,{method:'POST',headers:H}).then(r=>r.status).catch(()=>0);
  const pu2 = pu>=400 ? await fetch(`${BASE}/api/orders/${row.id}/picked-up`,{method:'POST',headers:H}).then(r=>r.status).catch(()=>0) : pu;
  ok('barista: Collected', pu2<400, `${pu2}`);
  const after = await fetch(`${BASE}/api/orders`,{headers:H}).then(r=>r.json()); const arow=(after.data||after.orders||[]).find(o=>String(o.id)===String(row.id));
  ok('order status is picked up', !!arow && /pick/i.test(String(arow.status)), arow?String(arow.status):'gone from list');
  const rep = await fetch(`${BASE}/api/reports/today`,{headers:H}).then(r=>r.json()); const rd=rep.data||rep;
  ok("today's report counts it", (rd.total_orders||0)>=1, `${rd.total_orders} today, window ${rd.window}`);

  // 5. A notice reaches an OPEN barista tablet without a reload (the socket, production-only path)
  const tab = await ctx.newPage({ viewport: { width: 1180, height: 900 } }); await tab.goto(`${BASE}/login`, { waitUntil: 'networkidle' }); await sleep(1000);
  await tab.fill('input[name="username"], input[type="text"]','coffeecue'); await tab.fill('input[type="password"]','adminpassword'); await tab.click('button[type="submit"]'); await sleep(3500);
  await tab.goto(`${BASE}/barista`, { waitUntil: 'networkidle' }); await sleep(3000);
  if (/Which station is this tablet at/i.test(await tab.locator('body').innerText())) { await tab.getByRole('button', { name: /Coffee Station 1/ }).first().click(); await sleep(2000); }
  const nt = await fetch(`${BASE}/api/notices`,{method:'POST',headers:H,body:JSON.stringify({message:'Live test notice - ignore',level:'info',on_screens:true,on_phones:false,by_sms:false})}).then(r=>r.json());
  let seen=-1; for (let i=1;i<=10;i++){ await sleep(500); if (/Live test notice/i.test(await tab.locator('body').innerText())) { seen=i*0.5; break; } }
  ok('notice reaches the open barista tablet live (no reload)', seen>0, seen>0?`${seen}s`:'not within 5 s');
  await fetch(`${BASE}/api/notices/${(nt.notice||nt).id}/clear`,{method:'POST',headers:H});
  await b.close();
  ok('no page errors on the phone', perr.length===0, perr.join('; '));
  console.log(`\n==== live e2e: ${results.length} checks, ${results.filter(x=>!x).length} FAIL ====  test order #${num} id ${row&&row.id}`);
  require('fs').writeFileSync(`${__dirname}/e2e_last.json`, JSON.stringify({ num, id: row&&row.id, name: NAME }));
})().catch(e=>{ console.log('HARNESS ERROR', e.message); process.exit(2); });
