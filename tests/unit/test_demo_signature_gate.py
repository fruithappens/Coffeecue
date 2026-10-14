"""Unsigned "demo" tokens are never honoured on a public copy (15 Oct 2026).

Anyone can write one claiming to be an admin. Test copies like
demo.cupq.app run with TESTING_MODE=True on the internet, so that must not
be what opens the door.
"""
import flask

import auth


def _enabled(monkeypatch, host, env=None, testing=True):
    monkeypatch.setenv("TESTING_MODE", "True" if testing else "False")
    if env is None:
        monkeypatch.delenv("ALLOW_UNSIGNED_DEMO_TOKENS", raising=False)
    else:
        monkeypatch.setenv("ALLOW_UNSIGNED_DEMO_TOKENS", env)
    app = flask.Flask(__name__)
    app.config["TESTING_MODE"] = testing
    with app.test_request_context("/", base_url=f"https://{host}"):
        return auth._demo_mode_enabled()


def test_testing_mode_alone_never_opens_it(monkeypatch):
    assert not _enabled(monkeypatch, "demo.cupq.app")
    assert not _enabled(monkeypatch, "localhost")


def test_even_when_switched_on_only_localhost(monkeypatch):
    assert not _enabled(monkeypatch, "demo.cupq.app", env="true")
    assert not _enabled(monkeypatch, "cupq.app", env="true")
    assert _enabled(monkeypatch, "localhost", env="true")
    assert _enabled(monkeypatch, "127.0.0.1", env="true")


def test_outside_a_request_is_closed(monkeypatch):
    monkeypatch.setenv("ALLOW_UNSIGNED_DEMO_TOKENS", "true")
    assert not auth._demo_mode_enabled()
