"""Help requests know who sent them (g.user, set by the app's before_request)."""

import os
import sys

from flask import Flask, g

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

import routes.support_request_routes as sr  # noqa: E402


def test_who_reads_g_user():
    app = Flask(__name__)
    with app.test_request_context():
        g.user = {"username": "treenet3", "role": "barista"}
        assert sr._who() == ("treenet3", "barista")


def test_who_without_a_user_is_blank_not_an_error():
    app = Flask(__name__)
    with app.test_request_context():
        assert sr._who() == ("", "")
