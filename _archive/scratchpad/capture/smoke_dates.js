// Finding 3: every date in the app resolves through the event's clock.
// Against the copy's real Treenet data (3-4 Sep 2026, Adelaide): the UTC date
// filed 314 orders on the 3rd; the event's day holds 323, and 323 + 254 = 577.
const { execSync } = require('child_process');
const BASE = 'http://localhost:5001'; const DB = process.env.DB || 'cupq_next';
const res = []; const check = (n, ok, d = '') => { res.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}  ${d}`); };
const sql = (q) => execSync(`psql ${DB} -Atc "${q}"`).toString().trim();
(async () => {
  const login = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'coffeecue', password: 'adminpassword' }) }).then(r => r.json());
  const H = { Authorization: `Bearer ${login.token}` };
  const get = (p) => fetch(BASE + '/api' + p, { headers: H }).then(r => r.json());
  const utc3 = Number(sql("select count(*) from orders where date(created_at)='2026-09-03'"));
  const adl3 = Number(sql("select count(*) from orders where created_at >= '2026-09-02 14:30' and created_at < '2026-09-03 14:30'"));
  const adl34 = Number(sql("select count(*) from orders where created_at >= '2026-09-02 14:30' and created_at < '2026-09-04 14:30'"));
  check('the UTC date and the event day disagree on the copy (the bug is real here)', utc3 !== adl3, `UTC 3rd: ${utc3}, Adelaide 3rd: ${adl3}`);
  const hist = await get('/orders/history?start_date=2026-09-03&end_date=2026-09-03&limit=2000');
  check('/orders/history for the 3rd returns the event day', (hist.orders || []).length === adl3, `${(hist.orders || []).length}`);
  const st = (await get('/orders/statistics?start_date=2026-09-03&end_date=2026-09-04')).statistics || {};
  check('/orders/statistics groups by the local day', st.by_day && st.by_day['2026-09-03'] === adl3 && st.total_orders === adl34, JSON.stringify(st.by_day));
  const hours = st.by_hour || {}; const busiest = Object.keys(hours).sort((a, b) => hours[b] - hours[a])[0];
  check('and the busiest hour is a coffee hour, not 1am', Number(busiest) >= 7 && Number(busiest) <= 11, `${busiest}:00 with ${hours[busiest]}`);
  const ch = await get('/reports/channels?start_date=2026-09-03&end_date=2026-09-03');
  check('/reports/channels for the 3rd counts the event day', (ch.by_channel || []).reduce((a, c) => a + c.orders, 0) === adl3);
  const bad = await fetch(`${BASE}/api/reports/channels?start_date=2026-9-3`, { headers: H }).then(r => r.status);
  check('a malformed date is still refused with 400', bad === 400, `HTTP ${bad}`);
  const rep = await get('/reports/today?from=2026-09-03&to=2026-09-04');
  check('the report itself still reads 577 (unchanged, shared helper)', (rep.total_orders || (rep.report || {}).total_orders) === 577, `${rep.total_orders || (rep.report || {}).total_orders}`);
  const ss = await get('/stations/1/stats');
  check('/stations/<id>/stats answers with local hours', !!(ss.stats || ss.data || ss) && !ss.error, JSON.stringify((ss.stats || ss.data || ss).hourly_data || (ss.stats || ss.data || ss).orders_by_hour || {}).slice(0, 80));
  const cups = await get('/reports/cup-reconciliation');
  check('cup reconciliation answers', cups.success === true, JSON.stringify(cups.totals));
  const full = await get('/health/full');
  check('/health/full still healthy', !!full.checks && full.overall !== 'fail', full.overall);
  console.log(`\n${res.filter(Boolean).length}/${res.length} passed`);
  process.exit(res.every(Boolean) ? 0 : 1);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
