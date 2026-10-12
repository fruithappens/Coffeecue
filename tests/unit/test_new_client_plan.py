"""The new-client dry run: names it refuses, and settings it must never copy."""

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "scripts")))

import new_client as nc  # noqa: E402


def test_refuses_bad_and_reserved_names(capsys):
    for bad in ("WWW", "www", "a", "1demo", "demo_", "x" * 40, "staging"):
        assert nc.main([bad]) == 2, bad


def test_secrets_are_generated_never_copied():
    g = nc.classify(nc.code_env_vars())
    for k in ("JWT_SECRET_KEY", "SECRET_KEY", "PIN_PEPPER", "CLOUDPRNT_SHARED_SECRET"):
        assert k in g["generate"]
    assert "DEFAULT_ADMIN_PASSWORD" in g["first_admin"]
    # The script's own tokens are not app settings.
    flat = set(g["defaults"]) | set(g["per_client"])
    assert not {"RAILWAY_API_TOKEN", "CLOUDFLARE_API_TOKEN", "TWILIO_MASTER_AUTH_TOKEN"} & flat


def test_production_only_settings_are_never_copied():
    g = nc.classify(["DEMO_FORM_ORIGINS", "BENCH_USER", "EA_CLIENT_SECRET", "TWILIO_AUTH_TOKEN"])
    assert {"DEMO_FORM_ORIGINS", "BENCH_USER"} <= set(g["never_copy"])
    assert "EA_CLIENT_SECRET" in sum(g["optional"].values(), [])
    assert "TWILIO_AUTH_TOKEN" in g["sms"]
