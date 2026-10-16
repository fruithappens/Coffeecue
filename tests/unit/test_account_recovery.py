"""Forgot password: the answer never says whether a login exists, links only
point at our own addresses, @local logins get no email, a link works once."""

import os
import sys
from unittest.mock import patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from flask import Flask  # noqa: E402

import routes.account_recovery_routes as pr  # noqa: E402
from security_middleware import limiter  # noqa: E402


class Cur:
    def __init__(self, db):
        self.db, self.row = db, None

    def execute(self, sql, params=None):
        self.db.sql.append((sql, params))
        if sql.startswith("SELECT id, username"):
            self.row = self.db.user
        elif sql.startswith("SELECT id, user_id"):
            self.row = self.db.token_row

    def fetchone(self):
        return self.row


class Conn:
    def __init__(self, user=None, token_row=None):
        self.user, self.token_row, self.sql, self.commits = user, token_row, [], 0

    def cursor(self):
        return Cur(self)

    def commit(self):
        self.commits += 1

    def rollback(self):
        pass


def app():
    a = Flask(__name__)
    a.config["RATELIMIT_ENABLED"] = False
    limiter.init_app(a)
    a.register_blueprint(pr.bp)
    return a


def post(path, body, conn, host="cupq.app"):
    sent = []
    with patch("utils.database.get_db_connection", return_value=conn), \
         patch("utils.database.close_connection"), \
         patch.object(pr.threading, "Thread", side_effect=lambda target, args, daemon: type(
             "T", (), {"start": lambda self: sent.append(args)})()):
        r = app().test_client().post(path, json=body, headers={"Host": host})
    return r, sent


def test_real_email():
    assert pr.real_email("steve@cupq.com.au")
    assert not pr.real_email("treenetadmin@local") and not pr.real_email("") and not pr.real_email("nope")


def test_unknown_and_known_logins_get_the_same_answer():
    unknown, s1 = post("/api/auth/forgot-password", {"login": "nobody"}, Conn())
    known, s2 = post("/api/auth/forgot-password", {"login": "demoowner"},
                     Conn(user=(7, "demoowner", "owner@example.org", "Demo Owner")))
    assert unknown.get_json() == known.get_json() and unknown.status_code == known.status_code == 200
    assert s1 == [] and len(s2) == 1
    to, name, link, site = s2[0]
    assert to == "owner@example.org" and name == "Demo" and site == "cupq.app"
    assert link.startswith("https://cupq.app/reset-password?token=")


def test_no_email_for_a_local_login_or_a_strange_host():
    _, s = post("/api/auth/forgot-password", {"login": "t1"}, Conn(user=(3, "t1", "t1@local", "")))
    assert s == []
    _, s = post("/api/auth/forgot-password", {"login": "demoowner"},
                Conn(user=(7, "demoowner", "owner@example.org", "")), host="evil.example")
    assert s == []


def test_a_demo_copy_link_points_at_the_demo_copy():
    _, s = post("/api/auth/forgot-password", {"login": "demoowner"},
                Conn(user=(7, "demoowner", "owner@example.org", "")), host="demo.cupq.app")
    assert s[0][2].startswith("https://demo.cupq.app/reset-password?token=")


def test_reset_needs_a_live_token_and_a_long_enough_password():
    r, _ = post("/api/auth/reset-password", {"token": "x" * 40, "password": "short"}, Conn())
    assert r.status_code == 400
    r, _ = post("/api/auth/reset-password", {"token": "x" * 40, "password": "long enough now"}, Conn())
    assert r.status_code == 400 and "expired" in r.get_json()["message"]
    conn = Conn(token_row=(1, 7))
    r, _ = post("/api/auth/reset-password", {"token": "x" * 40, "password": "long enough now"}, conn)
    assert r.status_code == 200 and conn.commits == 1
    updates = [p for s, p in conn.sql if s.startswith("UPDATE users SET password_hash")]
    assert updates and updates[0][1] == 7 and updates[0][0].startswith(("scrypt:", "pbkdf2:"))
