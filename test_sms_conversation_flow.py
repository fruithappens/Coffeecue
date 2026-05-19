"""
Self-contained tests for the SMS conversation state machine.

Runs with plain `python3 test_sms_conversation_flow.py` — no pytest, no
Postgres, no Twilio. The CoffeeOrderSystem.__init__ touches the DB during
boot, so we stub the database-dependent helpers immediately after
construction and drive `handle_sms()` directly.

These tests cover the behavior the previous Claude session fixed:
  - parse_order no longer injects silent defaults
  - state machine asks for each missing field instead of jumping to confirm
  - sugar handler re-prompts on unrecognized input instead of defaulting
    to "no sugar"
  - confirmation step-back when the customer specifies everything at once
"""

import sys
import os
from unittest.mock import MagicMock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from services.coffee_system import CoffeeOrderSystem
from services.nlp import NLPService


# ---------- helpers ---------------------------------------------------------


def make_system():
    """Build a CoffeeOrderSystem with the DB layer stubbed out.

    The constructor itself calls several `_load_*` / `_init_*` methods that
    hit the database. We give it a MagicMock for `db` and rely on those
    methods' broad except-handlers to swallow the resulting errors and
    leave the object in a usable state. Then we monkeypatch every helper
    that the conversation flow actually relies on at request time.
    """
    db = MagicMock()
    config = {'EVENT_NAME': 'Test Event'}
    system = CoffeeOrderSystem(db, config)

    # Stub the catalog lookups — return realistic in-stock options.
    system._get_available_coffee_types = lambda: [
        'latte', 'cappuccino', 'flat white', 'espresso', 'long black', 'mocha'
    ]
    system._get_available_milk_types = lambda: [
        'full cream', 'skim', 'soy', 'almond', 'oat', 'lactose free', 'no milk'
    ]
    system._get_available_sweeteners = lambda: [
        ('no sugar', 'sugar'), ('1 sugar', 'sugar'), ('2 sugar', 'sugar'),
        ('3 sugar', 'sugar'), ('half sugar', 'sugar'),
    ]
    system._get_available_sizes = lambda coffee_type='': ['small', 'medium', 'large']

    # Stub the customer lookup — no returning customer by default.
    system.get_customer = lambda phone: None

    # Stub settings reads so they don't try the DB.
    system._get_setting = lambda key, default=None: default

    # Stub the usual-order suggestion lookup.
    system._get_usual_order_suggestion = lambda phone, name: None

    return system


def send(system, phone, message):
    """Convenience: drive a single SMS turn and return the bot's reply."""
    return system.handle_sms(phone, message, messaging_service=None, metadata=None)


# ---------- tiny test runner ------------------------------------------------


_TESTS = []


def test(label):
    def deco(fn):
        _TESTS.append((label, fn))
        return fn
    return deco


def assert_contains(haystack, needle, label=''):
    if needle.lower() not in haystack.lower():
        raise AssertionError(
            f"{label}: expected response to contain {needle!r}\n"
            f"  actual response: {haystack!r}"
        )


def assert_not_contains(haystack, needle, label=''):
    if needle.lower() in haystack.lower():
        raise AssertionError(
            f"{label}: expected response NOT to contain {needle!r}\n"
            f"  actual response: {haystack!r}"
        )


# ---------- NLPService.parse_order: no silent defaults ---------------------


@test("parse_order does NOT inject defaults when apply_defaults is False (default)")
def t_parse_order_no_defaults():
    nlp = NLPService()
    result = nlp.parse_order("I'd like a latte")
    assert result.get('type') == 'latte', f"got {result}"
    # The bug we fixed: size and milk used to be silently filled in here.
    assert 'size' not in result, f"size leaked into parse output: {result}"
    assert 'milk' not in result, f"milk leaked into parse output: {result}"


@test("parse_order still injects defaults when apply_defaults=True")
def t_parse_order_defaults_when_opt_in():
    nlp = NLPService()
    result = nlp.parse_order("I'd like a latte", apply_defaults=True)
    assert result.get('size') == 'medium', f"expected default size, got {result}"
    assert result.get('milk') == 'full cream', f"expected default milk, got {result}"


@test("parse_order recognizes explicit milk choice")
def t_parse_order_milk_recognized():
    nlp = NLPService()
    result = nlp.parse_order("large oat latte 2 sugar")
    assert result.get('type') == 'latte', f"got {result}"
    assert result.get('size') == 'large', f"got {result}"
    assert result.get('milk') == 'oat', f"got {result}"
    assert result.get('sugar') == '2 sugar', f"got {result}"


# ---------- handle_sms: step-through flow ----------------------------------


@test("'latte' alone prompts for milk, not jumps to confirmation")
def t_latte_alone_asks_milk():
    system = make_system()
    phone = '+1555000001'

    # Bootstrap: greeting first, then customer says name, then orders.
    send(system, phone, 'hi')
    send(system, phone, 'Alex')
    reply = send(system, phone, 'latte')

    assert_contains(reply, 'milk', label='latte alone')
    assert_not_contains(reply, 'confirm', label='latte alone')
    assert_not_contains(reply, 'YES to send', label='latte alone')


@test("'large oat latte' (missing sugar) prompts for sugar, not confirms")
def t_partial_order_asks_sugar():
    system = make_system()
    phone = '+1555000002'

    send(system, phone, 'hi')
    send(system, phone, 'Sam')
    reply = send(system, phone, 'large oat latte')

    assert_contains(reply, 'sugar', label='partial order')
    assert_not_contains(reply, 'reply YES', label='partial order')


@test("Complete one-shot order goes straight to confirmation with read-back")
def t_complete_order_confirms():
    system = make_system()
    phone = '+1555000003'

    send(system, phone, 'hi')
    send(system, phone, 'Jordan')
    reply = send(system, phone, 'large oat latte 1 sugar')

    assert_contains(reply, 'confirm', label='complete order')
    # Read-back should include the actual choices, not defaults.
    assert_contains(reply, 'oat', label='complete order — oat')
    assert_contains(reply, 'large', label='complete order — large')


# ---------- handle_sms: sugar handler ---------------------------------------


@test("Unrecognized sugar reply re-prompts instead of silently using 'no sugar'")
def t_sugar_unrecognized_reprompts():
    system = make_system()
    phone = '+1555000004'

    send(system, phone, 'hi')
    send(system, phone, 'Pat')
    send(system, phone, 'latte')        # asks for milk
    send(system, phone, 'oat')          # asks for size
    send(system, phone, 'large')        # asks for sugar
    reply = send(system, phone, 'yeah a little bit')

    # Should NOT have committed the order with "no sugar" silently.
    assert_not_contains(reply, 'Order #', label='unrecognized sugar')
    assert_not_contains(reply, 'confirmed', label='unrecognized sugar')
    # Should re-prompt about sugar.
    assert_contains(reply, 'sugar', label='unrecognized sugar')


@test("'no sugar' phrasing is accepted and order summary read-back is correct")
def t_sugar_no_sugar_accepted():
    system = make_system()
    phone = '+1555000005'

    send(system, phone, 'hi')
    send(system, phone, 'Robin')
    send(system, phone, 'latte')        # → milk?
    send(system, phone, 'oat')          # → size?
    send(system, phone, 'medium')       # → sugar?
    reply = send(system, phone, 'none')

    # Now in awaiting_confirmation. The read-back should mention the order
    # contents but no Order # (not committed yet, just summarized).
    assert_contains(reply, 'confirm', label='no-sugar accepted')
    assert_contains(reply, 'no sugar', label='no-sugar accepted')


# ---------- handle_sms: black coffee skips milk question --------------------


@test("Espresso skips the milk question (it's a black coffee)")
def t_espresso_skips_milk():
    system = make_system()
    phone = '+1555000006'

    send(system, phone, 'hi')
    send(system, phone, 'Casey')
    reply = send(system, phone, 'espresso')

    # Should ask for size (the next field after auto-setting milk='no milk').
    assert_contains(reply, 'size', label='espresso')
    assert_not_contains(reply, 'milk', label='espresso')


# ---------- queue position helper ------------------------------------------


@test("_get_queue_position returns None gracefully when DB query fails")
def t_queue_position_none_on_error():
    system = make_system()

    # The MagicMock DB will raise on the subquery because nothing is set
    # up — our helper must catch and return None, not crash.
    system.db.cursor = MagicMock(side_effect=Exception('boom'))
    pos = system._get_queue_position(station_id=1, order_number='A123')
    assert pos is None, f"expected None on error, got {pos!r}"


@test("_get_queue_position returns the integer count when DB succeeds")
def t_queue_position_success():
    system = make_system()

    fake_cursor = MagicMock()
    fake_cursor.execute = MagicMock()
    fake_cursor.fetchone = MagicMock(return_value=(3,))
    system.db.cursor = MagicMock(return_value=fake_cursor)

    pos = system._get_queue_position(station_id=1, order_number='A123')
    assert pos == 3, f"expected 3, got {pos!r}"


# ---------- start-order SMS notification -----------------------------------


@test("_notify_customer_order_started builds a friendly SMS body")
def t_start_notification_body():
    # Import here so we don't blow up if Flask isn't available.
    from routes.consolidated_api_routes import _notify_customer_order_started

    captured = {}

    class FakeMessagingService:
        def send_message(self, to, body):
            captured['to'] = to
            captured['body'] = body
            return 'sid_fake'

    # We need a Flask app context for current_app to resolve. Use a
    # minimal one with messaging_service planted in config.
    from flask import Flask
    app = Flask(__name__)
    app.config['messaging_service'] = FakeMessagingService()

    order_details = {'type': 'latte', 'size': 'large', 'milk': 'oat'}
    with app.app_context():
        _notify_customer_order_started('+1555000099', '#42', order_details)

    assert captured.get('to') == '+1555000099', f"phone wrong: {captured}"
    body = captured.get('body') or ''
    assert 'large' in body, f"size missing from body: {body!r}"
    assert 'oat' in body, f"milk missing from body: {body!r}"
    assert 'latte' in body, f"type missing from body: {body!r}"
    assert '#42' in body, f"order number missing from body: {body!r}"


@test("_notify_customer_order_started silently no-ops when phone is missing")
def t_start_notification_no_phone():
    from routes.consolidated_api_routes import _notify_customer_order_started
    from flask import Flask
    app = Flask(__name__)

    class FailIfCalled:
        def send_message(self, to, body):
            raise AssertionError("should not be called when phone is None")

    app.config['messaging_service'] = FailIfCalled()
    with app.app_context():
        # Must not raise.
        _notify_customer_order_started(None, '#42', {'type': 'latte'})
        _notify_customer_order_started('', '#42', {'type': 'latte'})


@test("_notify_customer_order_started swallows messaging errors")
def t_start_notification_swallows_errors():
    from routes.consolidated_api_routes import _notify_customer_order_started
    from flask import Flask
    app = Flask(__name__)

    class Boom:
        def send_message(self, to, body):
            raise RuntimeError("twilio down")

    app.config['messaging_service'] = Boom()
    with app.app_context():
        # The order has already moved to in-progress in the DB by the time
        # we get here; a Twilio outage must never raise back to the caller.
        _notify_customer_order_started('+1555000099', '#42', {'type': 'latte'})


# ---------- broadcast SMS endpoint -----------------------------------------


def _broadcast_app(recipients, messaging=None):
    """Build a Flask test app with the support blueprint and a stub DB.

    `recipients` is the list of phone numbers `_broadcast_recipients`
    should return for any audience (we don't test SQL here).
    """
    from flask import Flask
    from flask_jwt_extended import JWTManager
    import routes.support_api_routes as sup
    from routes.support_api_routes import support_api_bp

    # Monkey-patch the recipient query so we don't need a real DB.
    sup._broadcast_recipients = lambda cursor, audience: list(recipients)

    # Stub the DB connection helper used inside the route.
    fake_cursor = MagicMock()
    fake_cursor.close = MagicMock()
    fake_conn = MagicMock()
    fake_conn.cursor = MagicMock(return_value=fake_cursor)
    import utils.database
    utils.database.get_db_connection = lambda: fake_conn

    app = Flask(__name__)
    app.config['JWT_SECRET_KEY'] = 'test-secret'
    JWTManager(app)
    app.config['messaging_service'] = messaging
    # Strip JWT requirement for these route tests — we only care about
    # the broadcast logic. (Production routes use support_role_required
    # which currently allows any authenticated user anyway.)
    sup.support_role_required = lambda f: f
    # The decorator was already applied at import time, so unwrap it.
    for endpoint, view in list(app.view_functions.items()):
        pass

    app.register_blueprint(support_api_bp)
    return app


@test("broadcast preview returns recipient count without sending")
def t_broadcast_preview():
    sent_log = []

    class FakeMsg:
        def send_message(self, to, body):
            sent_log.append((to, body))
            return 'sid'

    app = _broadcast_app(['+15550001', '+15550002', '+15550003'], FakeMsg())
    with app.test_client() as client:
        # Forge a JWT-free path by hitting the route directly with the
        # decorator stripped above. We still need to pass through Flask's
        # routing, so use the test client.
        # Note: in this test harness the decorator was stripped at import
        # time only if the test_sms file is imported BEFORE the route
        # module — which it isn't. So we route through the app but accept
        # that JWT will trip; instead, call the inner function via the
        # app context.
        from routes.support_api_routes import broadcast_preview
        with app.test_request_context('/api/support/broadcast/preview?audience=today'):
            from flask import jsonify  # noqa: F401
            resp = broadcast_preview.__wrapped__() if hasattr(broadcast_preview, '__wrapped__') else broadcast_preview()
    body = resp.get_json()
    assert body.get('status') == 'success', f"got {body}"
    assert body.get('recipient_count') == 3, f"count wrong: {body}"
    assert sent_log == [], "preview should not send anything"


@test("broadcast send delivers to each recipient and reports counts")
def t_broadcast_send_success():
    sent_log = []

    class FakeMsg:
        def send_message(self, to, body):
            sent_log.append((to, body))
            return 'sid_' + to

    app = _broadcast_app(['+15550001', '+15550002', '+15550003'], FakeMsg())
    from routes.support_api_routes import broadcast_customers
    with app.test_request_context(
        '/api/support/broadcast/customers',
        method='POST',
        json={'message': 'Coffee break in 10!', 'audience': 'today'},
    ):
        resp = broadcast_customers.__wrapped__() if hasattr(broadcast_customers, '__wrapped__') else broadcast_customers()
    body = resp.get_json()
    assert body.get('sent') == 3, f"sent count wrong: {body}"
    assert body.get('failed') == 0, f"failed count wrong: {body}"
    assert len(sent_log) == 3
    assert all(b == 'Coffee break in 10!' for _, b in sent_log)


@test("broadcast rejects empty messages")
def t_broadcast_empty_rejected():
    app = _broadcast_app([], MagicMock())
    from routes.support_api_routes import broadcast_customers
    with app.test_request_context(
        '/api/support/broadcast/customers',
        method='POST',
        json={'message': '   ', 'audience': 'today'},
    ):
        resp = broadcast_customers.__wrapped__() if hasattr(broadcast_customers, '__wrapped__') else broadcast_customers()
    assert resp[1] == 400, f"expected 400, got {resp}"


@test("broadcast rejects unknown audience")
def t_broadcast_bad_audience():
    app = _broadcast_app([], MagicMock())
    from routes.support_api_routes import broadcast_customers
    with app.test_request_context(
        '/api/support/broadcast/customers',
        method='POST',
        json={'message': 'hi', 'audience': 'everyone-ever'},
    ):
        resp = broadcast_customers.__wrapped__() if hasattr(broadcast_customers, '__wrapped__') else broadcast_customers()
    assert resp[1] == 400, f"expected 400, got {resp}"


@test("broadcast caps recipient list at 500")
def t_broadcast_capped():
    fake_phones = [f'+1555{i:07d}' for i in range(600)]
    sent_log = []

    class FakeMsg:
        def send_message(self, to, body):
            sent_log.append(to)
            return 'sid'

    app = _broadcast_app(fake_phones, FakeMsg())
    from routes.support_api_routes import broadcast_customers
    with app.test_request_context(
        '/api/support/broadcast/customers',
        method='POST',
        json={'message': 'hello', 'audience': 'today'},
    ):
        resp = broadcast_customers.__wrapped__() if hasattr(broadcast_customers, '__wrapped__') else broadcast_customers()
    body = resp.get_json()
    assert body.get('capped') is True, f"expected capped, got {body}"
    assert body.get('sent') == 500, f"should send only first 500, got {body}"
    assert len(sent_log) == 500


# ---------- run all ---------------------------------------------------------


def main():
    # Quiet the library logging during tests.
    import logging
    logging.disable(logging.CRITICAL)

    passed = 0
    failed = 0
    for label, fn in _TESTS:
        try:
            fn()
        except AssertionError as e:
            failed += 1
            print(f"FAIL  {label}\n      {e}")
        except Exception as e:
            failed += 1
            print(f"ERROR {label}\n      {type(e).__name__}: {e}")
        else:
            passed += 1
            print(f"PASS  {label}")

    print(f"\n{passed} passed, {failed} failed (of {len(_TESTS)})")
    return 0 if failed == 0 else 1


if __name__ == '__main__':
    sys.exit(main())
