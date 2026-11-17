"""Login tokens are read from headers and cookies, never the address (SEC-023).

A token in the address stays in browser history and proxy logs. The
printable report fetches with the header instead (utils/openAuthedPage.js).
"""
from pathlib import Path

APP = Path(__file__).resolve().parents[2] / "app.py"


def test_token_location_has_no_query_string():
    src = APP.read_text()
    line = next(l for l in src.splitlines() if "JWT_TOKEN_LOCATION" in l and "=" in l)
    assert "query_string" not in line
