"""Logins end when they should (audit SEC-004): logout, deleted or
deactivated account, role change, password reset."""
import pytest
from flask import Flask

import utils.sessions as sessions


@pytest.fixture
def env(monkeypatch):
    accounts = {"7": {"role": "barista", "active": True, "tv": 0, "pw": "h1"}}
    revoked = set()
    monkeypatch.setattr(sessions, "_account", lambda uid: accounts.get(str(uid)))
    monkeypatch.setattr(sessions, "_revoked_set", lambda: revoked)
    monkeypatch.setattr(sessions, "_db_rows", lambda sql, params: [])
    app = Flask(__name__)
    app.config["JWT_SECRET_KEY"] = "s1"
    with app.app_context():
        yield accounts, revoked


def _token(sub="7", **extra):
    t = {"sub": sub, "jti": "j-" + sub, "exp": 4102444800, "role": "admin"}
    t.update(extra)
    return t


def test_live_login_uses_the_accounts_role_now(env):
    t = _token(**sessions.stamp_claims("7"))
    assert sessions.check(t) == (True, "barista")  # not the token's "admin"


def test_role_change_password_reset_and_deactivation_end_it(env):
    accounts, _ = env
    for change in ({"role": "staff"}, {"pw": "h2"}, {"active": False}, {"tv": 1}):
        accounts["7"] = {"role": "barista", "active": True, "tv": 0, "pw": "h1"}
        t = _token(**sessions.stamp_claims("7"))
        accounts["7"].update(change)
        assert sessions.check(t)[0] is False, change


def test_deleted_account_ends_it(env):
    accounts, _ = env
    t = _token(**sessions.stamp_claims("7"))
    del accounts["7"]
    assert sessions.check(t)[0] is False


def test_logout_ends_it(env):
    _, revoked = env
    t = _token(**sessions.stamp_claims("7"))
    sessions.revoke(t)
    assert "j-7" in revoked
    assert sessions.check(t)[0] is False


def test_service_tokens_pass_unless_revoked(env):
    _, revoked = env
    t = _token(sub="try-demo-barista", role="barista")
    assert sessions.check(t) == (True, "barista")
    revoked.add(t["jti"])
    assert sessions.check(t)[0] is False


def test_tokens_from_before_the_stamp_still_work_until_expiry(env):
    assert sessions.check(_token())[0] is True
