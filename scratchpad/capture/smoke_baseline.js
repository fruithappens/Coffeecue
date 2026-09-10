// The slice-agnostic smoke: what must be true of ANY server on :5001, whether
// it was built from production's main or from a cutover slice branch.
//
// The feature harnesses (runner, phase4 queue, notices, report) each need
// their feature present, so a slice that carries none of them would have no
// harness output at all. This one runs against everything: the server is up,
// sign-in works, the public display config answers, an order can be placed
// the way a customer places it (carrying the event code if the event has
// one), a barista can start and complete it, the orders list agrees, and no
// screen throws on load.
const { chromium } = require('playwright-core');
const { eventCode } = require('./eventcode');
const BASE = process.env.BASE || 'http://localhost:5001';
const results = [];
const ok = (name, pass, detail = '') => { results.push({ name, pass: !!pass, detail }); console.log(`${pass ? '  ok  ' : '  FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };

(async () => {
  // 1. Server + auth
  const health = await fetch(`${BASE}/api/health`).then(r => r.status).catch(() => 0);
  ok('server answers /api/health', health === 200, `status ${health}`);
  const login = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'coffeecue', password: 'adminpassword' }) }).then(r => r.json()).catch(() => ({}));
  ok('sign-in returns a token', !!login.token);
  const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${login.token}` };

  // 2. Public surfaces
  const cfg = await fetch(`${BASE}/api/display/config`).then(r => r.json()).catch(() => null);
  ok('public display config answers', !!cfg && (cfg.success !== false));
  const menu = await fetch(`${BASE}/api/display/menu`).then(r => r.json()).catch(() => null);
  const drinks = (menu && (menu.menu || menu).coffee_types) || [];
  ok('public menu lists drinks', drinks.length > 0, `${drinks.length} drinks`);

  // 3. An order, placed like a customer, made like a barista
  const code = await eventCode(BASE);
  const made = await fetch(`${BASE}/api/display/order`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Baseline smoke', coffee_type: 'Latte', milk: 'Full Cream', size: 'medium',
      channel: 'web', surface: 'phone', sms_opt_in: false, e: code }) }).then(r => r.json()).catch(() => ({}));
  ok('order placed via /display/order', made && made.success !== false && !!made.order_number, made.message || `#${made.order_number}`);
  const num = made.order_number;
  const list = await fetch(`${BASE}/api/orders`, { headers: H }).then(r => r.json()).catch(() => ({}));
  const rows = list.data || list.orders || (Array.isArray(list) ? list : []);
  const row = rows.find(o => String(o.orderNumber || o.order_number) === String(num));
  ok('order appears in /api/orders', !!row, row ? `id ${row.id} at station ${row.stationId || row.station_id}` : 'not found');
  if (row) {
    const s = await fetch(`${BASE}/api/orders/${row.id}/start`, { method: 'POST', headers: H }).then(r => r.status).catch(() => 0);
    const c = await fetch(`${BASE}/api/orders/${row.id}/complete`, { method: 'POST', headers: H }).then(r => r.status).catch(() => 0);
    ok('barista can start then complete it', s < 400 && c < 400, `start ${s}, complete ${c}`);
    const after = await fetch(`${BASE}/api/orders`, { headers: H }).then(r => r.json()).catch(() => ({}));
    const arow = (after.data || after.orders || []).find(o => String(o.id) === String(row.id));
    ok('status is completed afterwards', !!arow && /complet/i.test(String(arow.status)), arow ? String(arow.status) : 'gone');
  }

  // 4. Every screen a person can land on loads without a page error
  const b = await chromium.launch({ channel: 'chrome' });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push(e.message));
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' }).catch(() => {});
  await p.waitForTimeout(800);
  if (/sign in|log in|password/i.test(await p.locator('body').innerText().catch(() => ''))) {
    await p.fill('input[name="username"], input[type="text"]', 'coffeecue').catch(() => {});
    await p.fill('input[type="password"]', 'adminpassword').catch(() => {});
    await p.click('button[type="submit"]').catch(() => {}); await p.waitForTimeout(3000);
  }
  const screens = ['/barista', '/organiser', '/support', '/display', `/my${code ? `?e=${encodeURIComponent(code)}` : ''}`, '/order', '/how'];
  for (const s of screens) {
    const before = errors.length;
    await p.goto(`${BASE}${s}`, { waitUntil: 'networkidle', timeout: 30000 }).catch(e => errors.push(`${s}: ${e.message}`));
    await p.waitForTimeout(1500);
    const text = await p.locator('body').innerText().catch(() => '');
    const blank = text.replace(/\s+/g, '').length < 40;
    ok(`screen ${s} renders`, !blank && errors.length === before, blank ? 'blank page' : (errors.slice(before).join('; ') || `${text.length} chars`));
  }
  await b.close();

  const fails = results.filter(r => !r.pass).length;
  console.log(`\n==== baseline: ${results.length} checks, ${fails} FAIL ====`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('HARNESS ERROR', e); process.exit(2); });
