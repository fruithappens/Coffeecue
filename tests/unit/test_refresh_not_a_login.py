"""A refresh token is not a login (audit SEC-004).

Before, the before_request hook decoded any valid token into g.user, so the
30-day refresh token opened every route an 8-hour access token did."""
from datetime import timedelta

import pytest
from flask import Flask, g, jsonify

import auth
import utils.sessions as sessions


@pytest.fixture(autouse=True)
def _account_7(monkeypatch):
    # The session check (utils/sessions.py) looks the login up; give it one
    # rather than whatever database this machine has.
    monkeypatch.setattr(
        sessions, "_account",
        lambda uid: {"role": "admin", "active": True, "tv": 0, "pw": "h"} if str(uid) == "7" else None)
    monkeypatch.setattr(sessions, "_revoked_set", lambda: set())


def _app():
    app = Flask(__name__)
    app.config.update(
        JWT_SECRET_KEY="test-secret-test-secret-test-secret-32",
        JWT_ACCESS_TOKEN_EXPIRES=timedelta(hours=8),
        JWT_REFRESH_TOKEN_EXPIRES=timedelta(days=30),
        TESTING=True,
    )
    auth.init_app(app)

    @app.route("/who")
    @auth.jwt_required_with_demo()
    def who():
        return jsonify(user=(g.user or {}).get("username"))

    @app.route("/admin")
    @auth.role_required_with_demo(["admin"])
    def admin():
        return jsonify(ok=True)

    return app


def _tokens(app):
    with app.app_context():
        return auth.generate_tokens({"id": 7, "username": "ana", "role": "admin"})


def test_access_token_still_works():
    app = _app()
    t = _tokens(app)
    c = app.test_client()
    h = {"Authorization": "Bearer " + t["access_token"]}
    assert c.get("/who", headers=h).status_code == 200
    assert c.get("/admin", headers=h).status_code == 200


def test_refresh_token_is_refused_as_a_login():
    app = _app()
    t = _tokens(app)
    c = app.test_client()
    h = {"Authorization": "Bearer " + t["refresh_token"]}
    assert c.get("/who", headers=h).status_code == 401
    assert c.get("/admin", headers=h).status_code in (401, 403)
