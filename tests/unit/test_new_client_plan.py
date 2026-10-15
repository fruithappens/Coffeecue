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


def test_texts_never_block_a_build_but_tokens_do():
    import socket
    from unittest.mock import patch

    def gaierror(*a, **k):
        raise socket.gaierror

    with patch.object(nc, "_has_token", side_effect=lambda n: n == "CLOUDFLARE_API_TOKEN"), \
         patch.object(nc.socket, "getaddrinfo", side_effect=gaierror):
        pre = nc.prerequisites("acme", "acme.cupq.app")
    blocking = {c for c, ok, _n, b in pre if not ok and b}
    assert blocking == {"Railway API token"}
    texts = [p for p in pre if p[0].startswith("Text number")][0]
    assert texts[1] is False and texts[3] is False


def test_apply_refuses_without_tokens(capsys):
    from unittest.mock import patch

    with patch.object(nc, "_has_token", return_value=False):
        assert nc.main(["acme", "--apply"]) == 2
    assert "Can't build yet" in capsys.readouterr().err
