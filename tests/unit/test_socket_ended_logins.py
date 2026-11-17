"""A login that has ended can't open a live-update connection (SEC-004)."""
from unittest.mock import patch

from flask import Flask

from routes import websocket_routes_fixed as ws


def _role(check_result):
    app = Flask(__name__)
    with app.app_context(), \
            patch.object(ws, "decode_token", lambda t: {"sub": "7", "role": "admin", "jti": "j"}), \
            patch("utils.sessions.check", lambda d: check_result):
        return ws._extract_role({"token": "anything"})


def test_an_ended_login_is_refused():
    assert _role((False, None)) is None


def test_a_live_login_gets_its_role_now_not_the_token_role():
    assert _role((True, "barista")) == "barista"
