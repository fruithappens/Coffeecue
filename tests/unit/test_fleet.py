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


def test_env_copies_are_read_and_bad_json_ignored():
    with patch.dict(os.environ, {"FLEET_COPIES": '[{"name": "Acme", "url": "https://acme.cupq.app"}, "junk", {"name": "x"}]'}):
        assert f._env_copies() == [{"name": "Acme", "url": "https://acme.cupq.app"}]
    with patch.dict(os.environ, {"FLEET_COPIES": "not json"}):
        assert f._env_copies() == []
    with patch.dict(os.environ, {"FLEET_COPIES": '{"url": "https://acme.cupq.app"}'}):
        assert f._env_copies() == []


def test_board_merges_saved_and_env_copies_once_each():
    app = Flask(__name__)
    seen = []

    def fake_probe(c):
        seen.append(c)
        return {"name": c["name"], "url": c["url"], "up": True}

    saved = [{"name": "Demo", "url": "https://demo.cupq.app"}]
    env = '[{"name": "Demo again", "url": "https://demo.cupq.app/"}, {"name": "Acme", "url": "https://acme.cupq.app"},' \
          ' {"name": "Evil", "url": "https://169.254.169.254"}]'
    with patch.dict(os.environ, {"FLEET_COPIES": env}), \
         patch.object(f, "_kv_get", return_value=saved), \
         patch.object(f, "_db", return_value=None), \
         patch.object(f, "self_status", return_value={"commit": "abc1234"}), \
         patch.object(f, "_probe", side_effect=fake_probe), \
         app.test_request_context("/api/fleet/board"):
        resp = f.get_board.__wrapped__() if hasattr(f.get_board, "__wrapped__") else f.get_board()
    urls = [c["url"] for c in seen]
    assert urls == ["https://demo.cupq.app", "https://acme.cupq.app"]  # once each, never the bad address
    assert resp.get_json()["data"]["copies"][0]["self"] is True
