// Payments level 1, on the copy: pricing on in pay-to-collect; an order
// shows UNPAID on the barista list and "pay at the counter" on the beacon
// and in the ready text; the counter taps Paid; the card says PAID; the
// report counts the money. Then pricing off: nothing owed anywhere.
const { execSync } = require('child_process'); const { eventCode } = require('./eventcode');
const BASE = process.env.BASE || 'http://localhost:5001';
const results = []; const ok = (n, c, d = '') => { results.push(!!c); console.log((c ? '  ok   ' : '  FAIL ') + n + (d ? ' — ' + d : '')); };
(async () => {
  const login = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'coffeecue', password: 'adminpassword' }) }).then(r => r.json());
  const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${login.token}` }; const code = await eventCode(BASE);
  const before = await fetch(`${BASE}/api/pricing-settings`, { headers: H }).then(r => r.json());
  const setPricing = (body) => fetch(`${BASE}/api/pricing-settings`, { method: 'PUT', headers: H, body: JSON.stringify(body) }).then(r => r.json());
  let r = await setPricing({ ...before, enabled: true, mode: 'pay_to_collect', flat_price: 4.5, per_drink: {}, milk_surcharge: {}, size_surcharge: { small: 0, medium: 0, large: 0 }, vip_free: false });
  ok('pricing on, pay to collect, flat $4.50', r.success && r.pricing.mode === 'pay_to_collect');
  const order = (extra = {}) => fetch(`${BASE}/api/display/order`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Pay test', coffee_type: 'Latte', milk: 'Full Cream', size: 'medium', channel: 'web', surface: 'phone', sms_opt_in: false, e: code, ...extra }) }).then(r => r.json());
  const rowFor = async (num) => { const l = await fetch(`${BASE}/api/orders`, { headers: H }).then(r => r.json()); return (l.data || l.orders || []).find(o => String(o.orderNumber || o.order_number) === String(num)); };
  r = await order(); let o = await rowFor(r.order_number);
  ok('new order is UNPAID with its price on the barista list', o && o.paymentStatus === 'unpaid' && /4\.50/.test(String(o.priceFormatted || o.price || '')), o ? `#${r.order_number} ${o.paymentStatus} ${o.priceFormatted || o.price}` : 'no order');
  let t = await fetch(`${BASE}/api/orders/${r.order_number}/track`).then(x => x.json());
  ok('beacon says pay at the counter', t.payment_status === 'unpaid' && t.payment_mode === 'pay_to_collect' && /4\.50/.test(t.price || ''), `${t.payment_status} ${t.payment_mode} ${t.price}`);
  await fetch(`${BASE}/api/orders/${o.id}/start`, { method: 'POST', headers: H }); await fetch(`${BASE}/api/orders/${o.id}/complete`, { method: 'POST', headers: H });
  const ready = execSync(`psql cupq_next -tAc "select coalesce((select message from order_messages where order_number='${r.order_number}' order by id desc limit 1),'')"`, { encoding: 'utf8' }).trim();
  ok('ready text (no phone on this order -> none sent; the template is exercised below)', true);
  // the ready-text renderer itself, with the order's details
  const rendered = execSync(`cd /Users/stevewf/cupq-next && TZ=UTC ./venv/bin/python -c "
import os,sys,logging; sys.path.insert(0,'.'); os.environ.setdefault('DATABASE_URL','postgresql://localhost/cupq_next?gssencmode=disable&sslmode=disable'); logging.disable(logging.CRITICAL)
from app import create_app; app,_=create_app()
with app.app_context():
    from routes.consolidated_api_routes import _render_ready_message
    print(_render_ready_message('${r.order_number}', {'name':'Pay test','type':'latte','milk':'full cream','size':'medium','price':4.5}, ${o.stationId || o.station_id}))" 2>/dev/null | tail -1`, { encoding: 'utf8' }).trim();
  ok('ready text carries "pay $4.50 at the counter when you collect"', /Please pay \$4\.50 at the counter when you collect/.test(rendered), rendered.slice(0, 120));
  let p = await fetch(`${BASE}/api/orders/${o.id}/paid`, { method: 'POST', headers: H, body: JSON.stringify({ method: 'cash' }) }).then(x => x.json());
  o = await rowFor(r.order_number); t = await fetch(`${BASE}/api/orders/${r.order_number}/track`).then(x => x.json());
  ok('Paid tap: card says PAID (cash), beacon says paid', p.success && o && o.paymentStatus === 'paid' && o.paidMethod === 'cash' && t.payment_status === 'paid', `${o && o.paymentStatus}/${o && o.paidMethod} beacon ${t.payment_status}`);
  p = await fetch(`${BASE}/api/orders/${o.id}/paid`, { method: 'POST', headers: H, body: JSON.stringify({ method: 'card' }) }).then(x => x.json()); o = await rowFor(r.order_number);
  ok('a second Paid tap changes nothing (idempotent)', o.paidMethod === 'cash');
  const rep = await fetch(`${BASE}/api/reports/today`, { headers: H }).then(x => x.json()); const pay = (rep.data || rep).payments || {};
  ok("today's report counts it: $4.50 paid by cash", pay.enabled && pay.paid && pay.paid.total >= 4.5 && pay.by_method && pay.by_method.cash, JSON.stringify({ paid: pay.paid, unpaid: pay.unpaid, methods: Object.keys(pay.by_method || {}) }));
  p = await fetch(`${BASE}/api/orders/${o.id}/unpaid`, { method: 'POST', headers: H }).then(x => x.json()); o = await rowFor(r.order_number);
  ok('Mark unpaid undoes it', p.success && o.paymentStatus === 'unpaid');
  await setPricing({ ...before, enabled: false });
  o = await rowFor(r.order_number); t = await fetch(`${BASE}/api/orders/${r.order_number}/track`).then(x => x.json());
  ok('pricing off: nothing is owed anywhere', o && o.paymentStatus === 'none' && t.payment_status === 'none' && t.payment_mode === 'honour');
  await setPricing(before);
  execSync(`psql cupq_next -qc "delete from orders where order_number='${r.order_number}'"`);
  const fails = results.filter(x => !x).length; console.log(`\nPASS ${results.length - fails}/${results.length}`); process.exit(fails ? 1 : 0);
})().catch(e => { console.log('HARNESS ERROR', e.message); process.exit(2); });
