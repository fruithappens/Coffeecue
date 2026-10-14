"""The API access log: one line per request, phone numbers masked.

It used to write two lines per request (plus a CORS line in app.py), with
the caller's full phone number from /api/ea/me?phone=... in each. At a
1,000-phone event that was ~375 lines a second and Railway began dropping
log lines.
"""
import json
import logging
import os

import flask
import pytest

pytest.importorskip("flask_jwt_extended")
os.makedirs("logs", exist_ok=True)

import security_monitoring as smon  # noqa: E402


class _Capture(logging.Handler):
    def __init__(self):
        super().__init__()
        self.lines = []

    def emit(self, record):
        self.lines.append(record.getMessage())


def test_one_line_per_request_with_status_duration_and_masked_phone():
    app = flask.Flask(__name__)
    smon.init_security_monitoring(app)

    @app.route("/api/ea/me")
    def me():
        return flask.jsonify({"success": False}), 404

    cap = _Capture()
    smon.api_logger.addHandler(cap)
    try:
        app.test_client().get("/api/ea/me?phone=%2B61412345678")
    finally:
        smon.api_logger.removeHandler(cap)

    assert len(cap.lines) == 1
    entry = json.loads(cap.lines[0])
    assert entry["method"] == "GET"
    assert entry["path"] == "/api/ea/me"
    assert entry["status_code"] == 404
    assert "duration_ms" in entry
    assert entry["query_params"]["phone"].endswith("678")
    assert "412345" not in cap.lines[0]


def test_secrets_still_hidden_entirely():
    assert smon._safe_query_params({"token": "abc123"}) == {"token": "***"}
    assert smon._safe_query_params({"email": "a@b.co"})["email"] == "***.co"
