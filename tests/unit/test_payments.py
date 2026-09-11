"""Payments: the state an order is in, the marks, the summary, and Square's pieces."""
import base64
import hashlib
import hmac
import json
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from services.payments import (  # noqa: E402
    SquareClient, mode_of, order_number_from_webhook, payment_link_request, price_of,
    state_of, summary, verify_webhook_signature, webhook_is_completed,
)

ON = {"enabled": True, "mode": "pay_to_collect"}
OFF = {"enabled": False, "mode": "pay_to_collect"}


class TestState:
    def test_pricing_off_means_nothing_is_owed(self):
        assert state_of("pending", {"price": 4.5}, OFF) == "none"
        assert mode_of(OFF) == "honour"

    def test_priced_and_not_paid_is_unpaid(self):
        assert state_of("pending", {"price": 4.5}, ON) == "unpaid"
        assert state_of(None, {"price": "4.50"}, ON) == "unpaid"

    def test_paid_is_paid_whatever_the_price(self):
        assert state_of("paid", {"price": 4.5}, ON) == "paid"
        assert state_of("PAID", {}, ON) == "paid"

    def test_free_and_vip_comp_owe_nothing(self):
        assert state_of("pending", {"price": 0}, ON) == "none"
        assert state_of("pending", {"price": 0.0, "price_formatted": "VIP - no charge"}, ON) == "none"
        assert state_of("pending", {}, ON) == "none"

    def test_honour_mode_still_tracks_paid_and_unpaid(self):
        honour = {"enabled": True, "mode": "honour"}
        assert state_of("pending", {"price": 3}, honour) == "unpaid"
        assert mode_of({"enabled": True, "mode": "nonsense"}) == "honour"

    def test_price_of_is_forgiving(self):
        assert price_of({"price": "4.50"}) == 4.5
        assert price_of({"price": None}) is None
        assert price_of("not a dict") is None


class _Cur:
    def __init__(self, rows): self.rows, self.description = rows, None
    def execute(self, *a): pass
    def fetchall(self): return self.rows


class TestSummary:
    def test_totals_and_methods(self):
        rows = [
            ("paid", {"price": 4.5, "paid_method": "cash"}),
            ("paid", {"price": 5.0, "paid_method": "square"}),
            ("pending", {"price": 4.0}),
            ("pending", {"price": 0.0}),          # free: not owed
            ("pending", {}),                       # no price: not owed
        ]
        s = summary(_Cur(rows), "d0", "d1", ON)
        assert s["enabled"] and s["mode"] == "pay_to_collect"
        assert s["orders_priced"] == 3
        assert s["paid"] == {"count": 2, "total": 9.5}
        assert s["unpaid"] == {"count": 1, "total": 4.0}
        assert s["by_method"]["cash"] == {"count": 1, "total": 4.5}
        assert s["by_method"]["square"] == {"count": 1, "total": 5.0}

    def test_pricing_off_is_empty(self):
        assert summary(_Cur([("pending", {"price": 4})]), "d0", "d1", OFF)["enabled"] is False


class TestSquare:
    def test_webhook_signature_round_trip(self):
        key, url, body = "sig-key", "https://cupq.app/api/square/webhook", b'{"type":"payment.completed"}'
        sig = base64.b64encode(hmac.new(key.encode(), url.encode() + body, hashlib.sha256).digest()).decode()
        assert verify_webhook_signature(key, url, body, sig)
        assert not verify_webhook_signature(key, url, body + b" ", sig)
        assert not verify_webhook_signature("other", url, body, sig)
        assert not verify_webhook_signature("", url, body, sig)
        assert not verify_webhook_signature(key, url, body, "")

    def test_payment_link_request_shape(self):
        b = payment_link_request("1021", 4.5, "aud", "LOC1", "Flat white", "https://cupq.app/order?order=1021")
        assert b["quick_pay"]["price_money"] == {"amount": 450, "currency": "AUD"}
        assert b["quick_pay"]["location_id"] == "LOC1"
        assert b["order_reference_id"] == "1021"
        assert b["checkout_options"]["redirect_url"].endswith("order=1021")
        assert b["checkout_options"]["allow_tipping"] is False
        # the same order asks for the same link (idempotency)
        assert b["idempotency_key"] == payment_link_request("1021", 4.5, "AUD", "LOC1", "x")["idempotency_key"]

    def test_client_uses_the_injected_post_and_never_raises(self):
        calls = []
        def fake_post(path, body):
            calls.append((path, body)); return 200, {"payment_link": {"url": "https://square.link/x", "id": "PL1"}}
        c = SquareClient(env="sandbox", access_token="tok", post=fake_post)
        assert c.base.startswith("https://connect.squareupsandbox.com")
        assert c.create_payment_link("7", 3.0, "AUD", "LOC", "Latte") == ("https://square.link/x", "PL1")
        assert calls[0][0] == "/v2/online-checkout/payment-links"
        failing = SquareClient(post=lambda p, b: (401, {"errors": [{"detail": "nope"}]}))
        assert failing.create_payment_link("7", 3.0, "AUD", "LOC", "Latte") == (None, None)
        boom = SquareClient(post=lambda p, b: (_ for _ in ()).throw(RuntimeError("down")))
        assert boom.create_payment_link("7", 3.0, "AUD", "LOC", "Latte") == (None, None)

    def test_webhook_event_parsing(self):
        ev = {"type": "payment.completed", "data": {"object": {"payment": {"status": "COMPLETED", "reference_id": "1021"}}}}
        assert webhook_is_completed(ev) and order_number_from_webhook(ev) == "1021"
        assert not webhook_is_completed({"type": "payment.created", "data": {"object": {"payment": {"status": "PENDING"}}}})
        assert order_number_from_webhook({}) == ""
