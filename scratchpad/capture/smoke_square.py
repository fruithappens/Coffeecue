"""Payments level 2 end to end, with Square replaced by a fake HTTP layer.

Runs the real Flask app in-process (so the real routes, the real DB on the
copy, the real signature code), and swaps only SquareClient.post/get so no
request leaves this machine. Proves: a priced order gets a link; the beacon
carries it; pay-to-order holds the order off the queue; the signed webhook
places it and marks it paid; a bad signature is refused; disconnect stops
new links.
"""
import base64, hashlib, hmac, json, os, sys, logging
sys.path.insert(0, '.')
os.environ.setdefault('DATABASE_URL', 'postgresql://localhost/cupq_next?gssencmode=disable&sslmode=disable')
os.environ['TESTING_MODE'] = 'True'
os.environ['SQUARE_APPLICATION_ID'] = 'sq0idp-test'
os.environ['SQUARE_APPLICATION_SECRET'] = 'sq0csp-test'
os.environ['SQUARE_ENV'] = 'sandbox'
os.environ['SQUARE_WEBHOOK_SIGNATURE_KEY'] = 'whsec-test-key'
os.environ['PUBLIC_BASE_URL'] = 'https://cupq.app'
logging.disable(logging.CRITICAL)

from app import create_app
from services import payments as P
from routes.consolidated_api_routes import _kv_put, _kv_get

results = []
def ok(name, cond, detail=''):
    results.append(bool(cond)); print(('  ok   ' if cond else '  FAIL ') + name + (f' — {detail}' if detail else ''))

# --- the fake Square
calls = []
def fake_post(self, path, body):
    calls.append((path, body))
    if path == '/v2/online-checkout/payment-links':
        return 200, {'payment_link': {'id': 'PL-' + body['order_reference_id'], 'url': 'https://square.link/u/' + body['order_reference_id']}}
    return 404, {'errors': [{'detail': 'unexpected ' + path}]}
def fake_get(self, path):
    if path == '/v2/locations':
        return 200, {'locations': [{'id': 'LOC-1', 'name': 'The Cart', 'currency': 'AUD', 'status': 'ACTIVE'}]}
    return 404, {}
P.SquareClient.post = fake_post
P.SquareClient.get = fake_get

app, _ = create_app()
client = app.test_client()
with app.app_context():
    cs = app.config['coffee_system']; db = cs.db
    # a connected operator (as the OAuth callback would have stored it)
    _kv_put(db, P.SQUARE_KEY, {'access_token': 'tok', 'refresh_token': 'ref', 'expires_at': '2099-01-01T00:00:00Z',
                               'merchant_id': 'M1', 'env': 'sandbox', 'location_id': 'LOC-1', 'location_name': 'The Cart', 'currency': 'AUD'})
    before = _kv_get(db, 'pricing_settings', default=None) or {}
    login = client.post('/api/auth/login', json={'username': 'coffeecue', 'password': 'adminpassword'}).get_json()
    H = {'Authorization': f"Bearer {login['token']}"}
    code = (_kv_get(db, 'event_access', default={}) or {}).get('code', '')

    st = client.get('/api/square/status', headers=H).get_json()
    ok('status: configured + connected at The Cart', st['configured'] and st['connected'] and st['location_name'] == 'The Cart')

    def place(mode, name):
        client.put('/api/pricing-settings', headers=H, json={**before, 'enabled': True, 'mode': mode, 'flat_price': 4.5, 'per_drink': {}, 'milk_surcharge': {}, 'size_surcharge': {'small': 0, 'medium': 0, 'large': 0}, 'vip_free': False})
        cs._invalidate_pricing_cache() if hasattr(cs, '_invalidate_pricing_cache') else None
        r = client.post('/api/display/order', json={'name': name, 'coffee_type': 'Latte', 'milk': 'Full Cream', 'size': 'medium', 'channel': 'web', 'surface': 'phone', 'sms_opt_in': False, 'e': code}).get_json()
        return r

    # 1. pay to collect: placed AND a link
    r = place('pay_to_collect', 'Sq collect')
    ok('pay-to-collect: order placed with a Square link', r.get('success') and r.get('payment_link', '').startswith('https://square.link/') and not r.get('awaiting_payment'), f"#{r.get('order_number')} {r.get('payment_link')}")
    n1 = r['order_number']
    t = client.get(f'/api/orders/{n1}/track').get_json()
    ok('beacon: unpaid, pay_to_collect, link present', t['payment_status'] == 'unpaid' and t['payment_mode'] == 'pay_to_collect' and t['payment_link'].endswith(n1))
    req = calls[-1][1]
    ok('the link asked Square for $4.50 AUD at The Cart, referenced by order number', req['quick_pay']['price_money'] == {'amount': 450, 'currency': 'AUD'} and req['quick_pay']['location_id'] == 'LOC-1' and req['order_reference_id'] == n1 and req['checkout_options']['redirect_url'] == f'https://cupq.app/order?order={n1}')
    lst = client.get('/api/orders', headers=H).get_json(); row = next((o for o in (lst.get('data') or []) if str(o.get('orderNumber')) == n1), None)
    ok('it IS on the barista queue (pay-to-collect never holds a coffee)', row is not None and row.get('status') == 'pending')

    # 2. the signed webhook marks it paid
    url = 'https://cupq.app/api/square/webhook'
    def signed(body_obj, key='whsec-test-key'):
        body = json.dumps(body_obj).encode()
        sig = base64.b64encode(hmac.new(key.encode(), url.encode() + body, hashlib.sha256).digest()).decode()
        return body, sig
    ev = {'type': 'payment.completed', 'data': {'object': {'payment': {'id': 'PAY-1', 'status': 'COMPLETED', 'reference_id': n1}}}}
    body, sig = signed(ev)
    w = client.post('/api/square/webhook', data=body, headers={'Content-Type': 'application/json', 'x-square-hmacsha256-signature': sig})
    t = client.get(f'/api/orders/{n1}/track').get_json()
    ok('webhook (signed): order marked paid by square', w.status_code == 200 and t['payment_status'] == 'paid', f"{w.status_code} {w.get_json()}")
    body2, _ = signed(ev); w2 = client.post('/api/square/webhook', data=body2, headers={'Content-Type': 'application/json', 'x-square-hmacsha256-signature': 'bogus'})
    ok('webhook with a bad signature is refused (401), nothing changes', w2.status_code == 401)
    w3 = client.post('/api/square/webhook', data=body, headers={'Content-Type': 'application/json', 'x-square-hmacsha256-signature': sig})
    ok('webhook retry is idempotent', w3.status_code == 200)

    # 3. pay to order: held off the queue until paid
    r = place('pay_to_order', 'Sq order')
    n2 = r['order_number']
    ok('pay-to-order: awaiting payment, with a link', r.get('awaiting_payment') is True and r.get('payment_link'))
    lst = client.get('/api/orders', headers=H).get_json(); row = next((o for o in (lst.get('data') or []) if str(o.get('orderNumber')) == n2), None)
    pend = client.get('/api/orders/pending', headers=H).get_json()
    ok('it is NOT on the barista queue yet', (row is None or row.get('status') == 'awaiting_payment') and not any(str(o.get('orderNumber')) == n2 for o in (pend.get('data') or pend.get('orders') or [])))
    t = client.get(f'/api/orders/{n2}/track').get_json()
    ok('beacon says awaiting_payment with the link', t['status'] == 'awaiting_payment' and t['payment_link'])
    ev2 = {'type': 'payment.updated', 'data': {'object': {'payment': {'id': 'PAY-2', 'status': 'COMPLETED', 'reference_id': n2}}}}
    body, sig = signed(ev2); client.post('/api/square/webhook', data=body, headers={'Content-Type': 'application/json', 'x-square-hmacsha256-signature': sig})
    lst = client.get('/api/orders', headers=H).get_json(); row = next((o for o in (lst.get('data') or []) if str(o.get('orderNumber')) == n2), None)
    ok('payment lands: the order is placed (pending) and paid', row is not None and row.get('status') == 'pending' and row.get('paymentStatus') == 'paid' and row.get('paidMethod') == 'square', f"{row and row.get('status')} {row and row.get('paymentStatus')}")

    # 4. report sees both
    rep = client.get('/api/reports/today', headers=H).get_json(); pay = (rep.get('data') or rep)['payments']
    ok('report: two paid by square', pay['enabled'] and pay['by_method'].get('square', {}).get('count', 0) >= 2, json.dumps(pay['by_method']))

    # 5. disconnected: orders still go through, just without a link
    client.delete('/api/square/disconnect', headers=H)
    r = place('pay_to_order', 'Sq after')
    n3 = r['order_number']
    ok('disconnected + pay-to-order: order still placed (no link, not held)', r.get('success') and not r.get('payment_link') and not r.get('awaiting_payment'))

    # tidy
    client.put('/api/pricing-settings', headers=H, json=before)
    cur = db.cursor(); cur.execute("DELETE FROM orders WHERE order_number IN (%s, %s, %s)", (n1, n2, n3)); db.commit()
    _kv_put(db, P.SQUARE_KEY, {})

fails = results.count(False)
print(f"\nPASS {len(results) - fails}/{len(results)}")
sys.exit(1 if fails else 0)
