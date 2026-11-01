"""Rate limits stay on everywhere but a laptop copy: demo.cupq.app runs
TESTING_MODE on the public internet (audit SEC-005)."""
import importlib

import pytest


def _limits(monkeypatch, **env):
    for k in ("TESTING_MODE", "RAILWAY_ENVIRONMENT", "RAILWAY_PUBLIC_DOMAIN", "RATELIMIT_ENABLED"):
        monkeypatch.delenv(k, raising=False)
    for k, v in env.items():
        monkeypatch.setenv(k, v)
    import security_middleware
    return importlib.reload(security_middleware)._limits_on


@pytest.fixture(autouse=True)
def _restore(monkeypatch):
    yield
    monkeypatch.undo()
    import security_middleware
    importlib.reload(security_middleware)


def test_demo_has_limits(monkeypatch):
    assert _limits(monkeypatch, TESTING_MODE="True", RAILWAY_ENVIRONMENT="production") is True


def test_live_has_limits(monkeypatch):
    assert _limits(monkeypatch, TESTING_MODE="False", RAILWAY_ENVIRONMENT="production") is True


def test_laptop_test_copy_has_none(monkeypatch):
    assert _limits(monkeypatch, TESTING_MODE="True") is False


def test_override_for_a_load_test(monkeypatch):
    assert _limits(monkeypatch, TESTING_MODE="True", RAILWAY_ENVIRONMENT="production",
                   RATELIMIT_ENABLED="false") is False
