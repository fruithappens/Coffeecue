"""Only CupQ's own address may call a server copy's API from a browser (SEC-012)."""
from utils.allowed_sites import allowed_sites

LIVE = {"RAILWAY_ENVIRONMENT": "production", "RAILWAY_PUBLIC_DOMAIN": "cupq.app", "RAILWAY_STATIC_URL": "cupq.app"}


def test_a_server_copy_allows_only_its_own_https_address():
    assert allowed_sites(LIVE) == ["https://cupq.app"]


def test_patterns_and_bare_hosts_in_the_setting_are_ignored():
    env = dict(LIVE, CORS_ALLOWED_ORIGINS="https://*.railway.app, demo.cupq.app, https://client.example/")
    assert allowed_sites(env) == ["https://client.example", "https://cupq.app"]


def test_a_laptop_copy_allows_the_dev_server():
    assert "http://localhost:3000" in allowed_sites({})
    assert "http://localhost:3000" not in allowed_sites(LIVE)
