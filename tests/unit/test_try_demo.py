"""Try it live: off unless switched on, demo numbers only, a session sees only its own order."""

import os
import sys
from unittest.mock import patch

from flask import Flask

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

import routes.try_routes as tr  # noqa: E402
from services import demo_texts  # noqa: E402


def client():
    app = Flask(__name__)
    app.register_blueprint(tr.bp)
    return app.test_client()


def test_off_unless_switched_on():
    c = client()
    with patch.dict(os.environ, {"TRY_DEMO_ENABLED": ""}):
        for method, path in (("post", "/api/try/session"), ("post", "/api/try/text"), ("get", "/api/try/state"),
                             ("post", "/api/try/advance"), ("get", "/api/try/label")):
            assert getattr(c, method)(path).status_code == 404, path


def test_pool_is_demo_numbers_only():
    assert len(tr.POOL) == 50
    assert all(demo_texts.is_demo(p) for p in tr.POOL)
    assert tr.POOL[0] == "+61400009950" and tr.POOL[-1] == "+61400009999"


def test_sessions_are_separate_and_expire():
    c = client()
    with patch.dict(os.environ, {"TRY_DEMO_ENABLED": "true"}), patch.object(tr, "_fresh_start"):
        a = c.post("/api/try/session").get_json()
        b = c.post("/api/try/session").get_json()
    assert a["token"] != b["token"] and a["phone"] != b["phone"] and a["src"].startswith("try-")
    with patch.dict(os.environ, {"TRY_DEMO_ENABLED": "true"}):
        assert c.get("/api/try/state?token=wrong").status_code == 410
        tr._sessions[a["token"]]["created"] -= tr.SESSION_TTL_S + 1
        assert c.get(f"/api/try/state?token={a['token']}").status_code == 410


def test_advance_needs_an_order_and_a_known_action():
    c = client()
    with patch.dict(os.environ, {"TRY_DEMO_ENABLED": "true"}), patch.object(tr, "_fresh_start"):
        t = c.post("/api/try/session").get_json()["token"]
        assert c.post("/api/try/advance", json={"token": t, "action": "delete"}).status_code == 400
        with patch.object(tr, "_order_for", return_value=None):
            assert c.post("/api/try/advance", json={"token": t, "action": "start"}).status_code == 409


def test_only_orders_since_the_session_began():
    captured = {}

    class Cur:
        def execute(self, sql, params):
            captured["sql"], captured["params"] = sql, params

        def fetchone(self):
            return None

    class Conn:
        def cursor(self):
            return Cur()

    s = {"phone": "+61400009950", "src": "try-abc", "created": tr.time.time() - 60}
    with patch("utils.database.get_db_connection", return_value=Conn()), patch("utils.database.close_connection"):
        assert tr._order_for(s) is None
    assert "make_interval" in captured["sql"]
    assert 60 <= captured["params"][2] <= 70  # this session's age, not two hours
