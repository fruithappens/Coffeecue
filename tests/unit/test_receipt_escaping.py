"""The public receipt page escapes what customers typed (audit SEC-006)."""
from datetime import datetime

from flask import Flask

from routes import consolidated_api_routes as api


class _Cursor:
    def __init__(self, row):
        self.row = row

    def execute(self, *a, **k):
        pass

    def fetchone(self):
        return self.row


class _DB:
    def __init__(self, row):
        self.row = row

    def cursor(self, *a, **k):
        return _Cursor(self.row)

    def rollback(self):
        pass


class _System:
    def __init__(self, row):
        self.db = _DB(row)


EVIL = '<script>alert(1)</script>'


def _receipt(monkeypatch, details, for_friend=None):
    row = ("42", details, "completed", 1, datetime(2026, 11, 1, 9, 0),
           datetime(2026, 11, 1, 9, 5), 0, for_friend)
    monkeypatch.setattr(api, "_kv_get", lambda db, key, default=None:
                        {"event_name": "Expo <b>", "logo": "javascript:alert(1)"}
                        if key == "branding_settings" else default)
    app = Flask(__name__)
    app.config["coffee_system"] = _System(row)
    with app.test_request_context("/api/orders/42/receipt"):
        resp = api.order_receipt("42")
        if isinstance(resp, tuple):
            resp = resp[0]
        return resp.get_data(as_text=True) if hasattr(resp, "get_data") else resp


def test_customer_text_is_escaped(monkeypatch):
    body = _receipt(monkeypatch, {"name": EVIL, "type": "latte", "milk": EVIL + " oat"},
                    for_friend=EVIL)
    assert "<script>" not in body
    assert "&lt;script&gt;" in body


def test_branding_is_escaped_and_bad_logo_dropped(monkeypatch):
    body = _receipt(monkeypatch, {"name": "Sam", "type": "latte"})
    assert "Expo &lt;b&gt;" in body
    assert "javascript:" not in body
