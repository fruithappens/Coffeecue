"""The fleet board: which addresses it will fetch, and who may read a copy's numbers."""

import os
import sys
from unittest.mock import patch

from flask import Flask

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

import routes.fleet_routes as f  # noqa: E402


def test_only_https_on_our_domains():
    assert f._clean_url("https://demo.cupq.app/run") == "https://demo.cupq.app"
    assert f._clean_url("https://CUPQ.APP") == "https://cupq.app"
    assert f._clean_url("https://web-production-1.up.railway.app") == "https://web-production-1.up.railway.app"
    for bad in ("http://demo.cupq.app", "https://169.254.169.254", "https://localhost",
                "https://evilcupq.app", "https://cupq.app.evil.com", "https://demo.cupq.app:8443",
                "ftp://cupq.app", "", None):
        assert f._clean_url(bad) is None, bad


def _token(header, env):
    app = Flask(__name__)
    with patch.dict(os.environ, env, clear=False), \
         app.test_request_context(headers={"Authorization": header} if header else {}):
        return f._token_ok()


def test_token_must_match_and_be_configured():
    assert _token("Bearer s3cret-fleet", {"FLEET_STATUS_TOKEN": "s3cret-fleet"}) is True
    assert _token("Bearer wrong", {"FLEET_STATUS_TOKEN": "s3cret-fleet"}) is False
    assert _token(None, {"FLEET_STATUS_TOKEN": "s3cret-fleet"}) is False
    # Not configured: no token opens it, not even an empty one.
    assert _token("Bearer ", {"FLEET_STATUS_TOKEN": ""}) is False
