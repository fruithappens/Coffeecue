"""Server errors are recorded next to tablet crashes, once per minute per problem."""

import os
import sys
import time
from unittest.mock import patch

from flask import Flask, jsonify

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

import services.server_errors as se  # noqa: E402


def setup_function():
    se._recent.clear()


def test_same_problem_inside_a_minute_is_recorded_once():
    assert se._first_time(("GET", "/api/x", 500, "boom")) is True
    assert se._first_time(("GET", "/api/x", 500, "boom")) is False
    assert se._first_time(("GET", "/api/y", 500, "boom")) is True  # different address


def _app():
    app = Flask(__name__)
    app.config["PROPAGATE_EXCEPTIONS"] = False

    @app.route("/api/handled")
    def handled():
        return jsonify({"success": False, "message": "menu query failed"}), 500

    @app.route("/api/uncaught")
    def uncaught():
        raise ValueError("bad input")

    @app.route("/api/fine")
    def fine():
        return jsonify({"ok": True})

    se.install(app)
    return app


def test_handled_500_and_uncaught_exception_are_recorded():
    calls = []
    with patch.object(se, "record", side_effect=lambda *a, **k: calls.append(a)):
        c = _app().test_client()
        assert c.get("/api/fine").status_code == 200
        assert c.get("/api/handled").status_code == 500
        assert c.get("/api/uncaught").status_code == 500
        time.sleep(0.3)  # the handled one is recorded off the request thread
    joined = [" ".join(str(x) for x in a) for a in calls]
    assert any("/api/handled" in j and "menu query failed" in j for j in joined)
    assert any("/api/uncaught" in j and "ValueError: bad input" in j for j in joined)
    assert not any("/api/fine" in j for j in joined)
