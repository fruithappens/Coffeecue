"""Rate limits key on an address the caller can't choose (audit SEC-005),
and ten wrong passwords pause a login."""
from datetime import datetime, timedelta

from flask import Flask, g
from werkzeug.security import generate_password_hash

import auth
from security_middleware import _client_ip


def _key(remote, **headers):
    app = Flask(__name__)
    with app.test_request_context("/", headers=headers, environ_base={"REMOTE_ADDR": remote}):
        return _client_ip()


def test_made_up_headers_are_ignored_from_anyone_but_cloudflare():
    assert _key("84.17.44.225", **{"CF-Connecting-IP": "9.9.9.9", "X-Forwarded-For": "8.8.8.8"}) == "84.17.44.225"


def test_cloudflare_may_name_the_caller():
    assert _key("172.64.1.2", **{"CF-Connecting-IP": "1.125.105.82"}) == "1.125.105.82"
    assert _key("2606:4700::1", **{"CF-Connecting-IP": "1.125.105.82"}) == "1.125.105.82"


def test_cloudflare_without_the_header_is_keyed_on_itself():
    assert _key("172.64.1.2") == "172.64.1.2"


class _Cur:
    def __init__(self, row):
        self.row, self.updates = row, []

    def execute(self, sql, params=()):
        if sql.lstrip().upper().startswith("UPDATE"):
            self.updates.append((sql, params))

    def fetchone(self):
        return self.row

    def close(self):
        pass


class _Conn:
    def __init__(self, cur):
        self.cur = cur

    def cursor(self):
        return self.cur

    def commit(self):
        pass


def _login(monkeypatch, failed, locked_until, password):
    row = (7, "ana", "a@x", generate_password_hash("right-one"), "barista", "Ana", failed, locked_until)
    cur = _Cur(row)
    monkeypatch.setattr(auth, "get_db_connection", lambda *a, **k: _Conn(cur))
    monkeypatch.setattr(auth, "close_connection", lambda c: None)
    app = Flask(__name__)
    with app.test_request_context("/"):
        result = auth.verify_login("ana", password)
        return result, cur.updates, getattr(g, "login_locked", False)


def test_wrong_password_counts(monkeypatch):
    result, updates, locked = _login(monkeypatch, 3, None, "nope")
    assert result is None and not locked
    assert updates[-1][1] == (4, 7)


def test_tenth_wrong_password_locks(monkeypatch):
    result, updates, locked = _login(monkeypatch, 9, None, "nope")
    assert result is None and locked
    assert "account_locked_until" in updates[-1][0]


def test_locked_login_refuses_even_the_right_password(monkeypatch):
    result, _, locked = _login(monkeypatch, 0, datetime.now() + timedelta(minutes=5), "right-one")
    assert result is None and locked


def test_lock_runs_out(monkeypatch):
    result, updates, _ = _login(monkeypatch, 0, datetime.now() - timedelta(minutes=1), "right-one")
    assert result and result["id"] == 7
    assert "failed_login_attempts = 0" in updates[-1][0]
