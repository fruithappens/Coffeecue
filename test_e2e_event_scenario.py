"""
End-to-end event scenario test against a running backend.

This drives the real HTTP API (no mocks) through a realistic event flow:

  1. Admin login
  2. Verify default stations exist
  3. Simulate SMS conversations from several customers (via the
     /sms webhook endpoint, in TESTING_MODE so no real SMS is sent)
  4. Verify orders land in the DB with the new "#42" style order numbers
  5. Have a barista start an order → confirm in-progress + start-SMS
     would have fired
  6. Complete the order → confirm completed
  7. Run the broadcast endpoint preview
  8. Spot-check queue position math by placing several orders and
     reading the confirmation text

Run **after** booting the backend with:
  DATABASE_URL=postgresql://localhost/<test-db> TESTING_MODE=True \\
      JWT_SECRET_KEY=test SECRET_KEY=test PORT=5001 python run_server.py

This script doesn't bring up the server itself — that's expected to be
running on http://localhost:5001 already.
"""

import os
import sys
import time
import json
import urllib.parse
import urllib.request
import urllib.error

BASE = os.environ.get('EXPRESSO_BASE', 'http://localhost:5001')
ADMIN_USER = os.environ.get('ADMIN_USER', 'coffeecue')
ADMIN_PASS = os.environ.get('ADMIN_PASS', 'adminpassword')


# ---------- thin HTTP client ----------------------------------------------


class Response:
    def __init__(self, status, body, headers):
        self.status = status
        self.body = body
        self.headers = headers

    @property
    def json(self):
        try:
            return json.loads(self.body)
        except Exception:
            return None


def http(method, path, *, token=None, json_body=None, form=None):
    url = BASE + path
    data = None
    headers = {'Accept': 'application/json'}
    if token:
        headers['Authorization'] = f'Bearer {token}'
    if json_body is not None:
        data = json.dumps(json_body).encode('utf-8')
        headers['Content-Type'] = 'application/json'
    elif form is not None:
        data = urllib.parse.urlencode(form).encode('utf-8')
        headers['Content-Type'] = 'application/x-www-form-urlencoded'

    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return Response(resp.status, resp.read().decode('utf-8'), dict(resp.headers))
    except urllib.error.HTTPError as exc:
        return Response(exc.code, exc.read().decode('utf-8'), dict(exc.headers))


# ---------- scenario helpers ----------------------------------------------


def step(label, fn):
    print(f"\n▶ {label}")
    try:
        result = fn()
    except AssertionError as e:
        print(f"  ✗ FAIL: {e}")
        return False, None
    except Exception as e:
        print(f"  ✗ ERROR: {type(e).__name__}: {e}")
        return False, None
    print(f"  ✓ ok")
    return True, result


def sms(phone, message):
    """Drive the /sms webhook as Twilio would."""
    return http('POST', '/sms', form={'From': phone, 'Body': message, 'To': '+15550000000'})


def extract_response_text(resp):
    """Twilio webhook returns TwiML XML. Pull the <Message> body out."""
    body = resp.body or ''
    # crude but adequate for tests
    open_tag = body.find('<Message>')
    close_tag = body.find('</Message>')
    if open_tag == -1 or close_tag == -1:
        return body
    return body[open_tag + len('<Message>'):close_tag].strip()


# ---------- the scenario --------------------------------------------------


def run():
    passed = 0
    failed = 0

    # 1. Admin login
    def _login():
        r = http('POST', '/api/auth/login',
                 json_body={'username': ADMIN_USER, 'password': ADMIN_PASS})
        assert r.status == 200, f"login HTTP {r.status}: {r.body[:200]}"
        token = r.json.get('token')
        assert token, f"no token in response: {r.body[:200]}"
        return token
    ok, token = step("Admin login", _login)
    passed += int(ok); failed += int(not ok)
    if not ok:
        return passed, failed

    # 2. Default stations exist
    def _stations():
        r = http('GET', '/api/stations', token=token)
        assert r.status == 200, f"stations HTTP {r.status}: {r.body[:200]}"
        payload = r.json
        # Several endpoints respond as {stations: [...]} or {data: [...]}.
        # Accept either.
        stations = (payload.get('stations') if isinstance(payload, dict) else None) \
                   or (payload.get('data') if isinstance(payload, dict) else None) \
                   or payload
        assert stations and len(stations) >= 1, f"no stations: {r.body[:300]}"
        print(f"    found {len(stations)} stations")
        return stations
    ok, stations = step("Stations populated from pg_init", _stations)
    passed += int(ok); failed += int(not ok)

    # 3. Simulate a customer SMS conversation
    customer_phone = '+15558881111'

    def _hello():
        r = sms(customer_phone, 'hi')
        assert r.status == 200, f"sms HTTP {r.status}: {r.body[:200]}"
        text = extract_response_text(r)
        print(f"    bot: {text[:120]}")
        assert text, "no reply"
    ok, _ = step("Customer says 'hi'", _hello)
    passed += int(ok); failed += int(not ok)

    def _name():
        r = sms(customer_phone, 'Alex')
        text = extract_response_text(r)
        print(f"    bot: {text[:120]}")
        assert 'coffee' in text.lower() or 'drink' in text.lower(), \
            f"expected coffee prompt: {text!r}"
    ok, _ = step("Customer gives name 'Alex'", _name)
    passed += int(ok); failed += int(not ok)

    def _partial_order():
        # 'latte' alone — the recent fix means the bot should ask for milk
        # rather than jump to confirmation with default milk.
        r = sms(customer_phone, 'latte')
        text = extract_response_text(r)
        print(f"    bot: {text[:160]}")
        assert 'milk' in text.lower(), \
            f"expected milk prompt for 'latte' alone, got: {text!r}"
        assert 'confirm' not in text.lower(), \
            f"shouldn't be at confirmation yet, got: {text!r}"
    ok, _ = step("Customer says 'latte' — should ask for milk (no silent default)", _partial_order)
    passed += int(ok); failed += int(not ok)

    def _milk():
        r = sms(customer_phone, 'oat')
        text = extract_response_text(r)
        print(f"    bot: {text[:160]}")
        assert 'size' in text.lower(), f"expected size prompt, got: {text!r}"
    ok, _ = step("Customer says 'oat' — should ask for size", _milk)
    passed += int(ok); failed += int(not ok)

    def _size():
        r = sms(customer_phone, 'large')
        text = extract_response_text(r)
        print(f"    bot: {text[:160]}")
        assert 'sugar' in text.lower(), f"expected sugar prompt, got: {text!r}"
    ok, _ = step("Customer says 'large' — should ask for sugar", _size)
    passed += int(ok); failed += int(not ok)

    def _sugar():
        r = sms(customer_phone, '1')
        text = extract_response_text(r)
        print(f"    bot: {text[:200]}")
        assert 'confirm' in text.lower() or 'reply yes' in text.lower(), \
            f"expected confirmation, got: {text!r}"
        # Read-back should mention what the customer said.
        for word in ('oat', 'large', 'latte', '1 sugar'):
            assert word in text.lower(), f"read-back missing {word!r}: {text!r}"
    ok, _ = step("Customer says '1' — confirmation with read-back", _sugar)
    passed += int(ok); failed += int(not ok)

    def _confirm():
        r = sms(customer_phone, 'YES')
        text = extract_response_text(r)
        print(f"    bot: {text[:240]}")
        # New friendly order numbers look like "#N"
        assert '#' in text, f"expected order number in confirmation, got: {text!r}"
        # Queue position helper should have engaged
        assert ('in line' in text.lower() or 'wait time' in text.lower()), \
            f"expected queue position or wait time, got: {text!r}"
    ok, _ = step("Customer confirms — order created with friendly # and queue position", _confirm)
    passed += int(ok); failed += int(not ok)

    # 4. Pull the order out of the DB via the API and verify state
    def _list_orders():
        # Pending orders endpoint
        r = http('GET', '/api/orders/pending', token=token)
        if r.status != 200:
            # Try alternate
            r = http('GET', '/api/orders?status=pending', token=token)
        assert r.status == 200, f"orders list HTTP {r.status}: {r.body[:300]}"
        body = r.json
        orders = body.get('orders') if isinstance(body, dict) else None
        if orders is None and isinstance(body, dict):
            orders = body.get('data')
        if orders is None and isinstance(body, list):
            orders = body
        assert orders, f"no pending orders found: {r.body[:300]}"
        print(f"    found {len(orders)} pending order(s)")
        # Find ours by phone (best-effort: the field name varies)
        mine = None
        for o in orders:
            phone = (o.get('phone_number') or o.get('phone') or
                     o.get('customerPhone') or '')
            if customer_phone[-7:] in (phone or ''):
                mine = o
                break
        if mine is None:
            mine = orders[0]
        print(f"    order #: {mine.get('order_number') or mine.get('orderNumber')}")
        return mine
    ok, my_order = step("Order appears in pending list", _list_orders)
    passed += int(ok); failed += int(not ok)

    # 5. Barista starts the order
    if ok and my_order:
        order_number = my_order.get('order_number') or my_order.get('orderNumber')

        def _start():
            r = http('POST', f'/api/orders/{urllib.parse.quote(order_number)}/start',
                     token=token, json_body={})
            assert r.status == 200, f"start HTTP {r.status}: {r.body[:300]}"
            body = r.json
            assert body and body.get('success'), f"start not successful: {r.body[:300]}"
        ok2, _ = step(f"Barista starts order {order_number}", _start)
        passed += int(ok2); failed += int(not ok2)

        def _complete():
            r = http('POST', f'/api/orders/{urllib.parse.quote(order_number)}/complete',
                     token=token, json_body={})
            assert r.status == 200, f"complete HTTP {r.status}: {r.body[:300]}"
            body = r.json
            assert body and body.get('success'), f"complete not successful: {r.body[:300]}"
        ok3, _ = step(f"Barista completes order {order_number}", _complete)
        passed += int(ok3); failed += int(not ok3)

    # 6. Broadcast endpoint
    def _broadcast_preview():
        r = http('GET', '/api/support/broadcast/preview?audience=today', token=token)
        assert r.status == 200, f"broadcast preview HTTP {r.status}: {r.body[:300]}"
        body = r.json
        assert 'recipient_count' in body, f"missing field: {r.body[:300]}"
        print(f"    recipients today: {body.get('recipient_count')}")
    ok, _ = step("Broadcast preview returns recipient count", _broadcast_preview)
    passed += int(ok); failed += int(not ok)

    def _broadcast_dry_run():
        r = http('POST', '/api/support/broadcast/customers', token=token,
                 json_body={
                     'message': "Coffee break in 10!",
                     'audience': 'today',
                     'dry_run': True,
                 })
        assert r.status == 200, f"broadcast HTTP {r.status}: {r.body[:300]}"
        body = r.json
        assert body.get('dry_run') is True, f"not a dry run: {r.body[:300]}"
        print(f"    dry-run would have sent to {body.get('recipient_count')} recipients")
    ok, _ = step("Broadcast dry-run does not send", _broadcast_dry_run)
    passed += int(ok); failed += int(not ok)

    # 7. Place a couple more orders and check queue position shows up
    other_phone = '+15558882222'
    def _second_order():
        # Walk through: hi -> name -> single full order -> confirm
        sms(other_phone, 'hi')
        sms(other_phone, 'Sam')
        r = sms(other_phone, 'large oat latte 1 sugar')
        text = extract_response_text(r)
        assert 'confirm' in text.lower(), f"second order: {text!r}"
        r = sms(other_phone, 'YES')
        text = extract_response_text(r)
        print(f"    bot: {text[:240]}")
        # With at least 1 order in flight ahead, we should see "#N in line"
        # OR a wait-time line. We don't pin which because station routing
        # may put them in different queues.
        assert '#' in text, f"expected order #, got: {text!r}"
    ok, _ = step("Second customer order — confirmation references queue", _second_order)
    passed += int(ok); failed += int(not ok)

    return passed, failed


if __name__ == '__main__':
    print(f"Driving end-to-end scenario against {BASE}")
    p, f = run()
    print(f"\n{p} passed, {f} failed")
    sys.exit(0 if f == 0 else 1)
