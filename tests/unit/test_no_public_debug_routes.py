"""Routes the 31 Oct 2026 audit found open to anyone stay gone.

SEC-001: POST /sms/send-test (optional login) texted any number and echoed a
customer's mobile from an order number. SEC-002: GET /debug/users listed
every staff login. Both lived outside /api, where the public probe never
looked."""
import ast
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def _route_paths(path):
    tree = ast.parse((ROOT / path).read_text())
    found = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and getattr(node.func, "attr", "") == "route":
            if node.args and isinstance(node.args[0], ast.Constant):
                found.append(node.args[0].value)
    return found


def test_no_debug_routes_in_app():
    assert not [p for p in _route_paths("app.py") if p.startswith("/debug")]


def test_no_unprefixed_sms_send_test():
    # The organiser's test text is /api/sms/test, managers only (readiness_api).
    assert "/sms/send-test" not in _route_paths("routes/sms_routes.py")


def test_baristas_cannot_text_any_number():
    # SEC-017: /api/sms/send-test let a barista login text any number.
    api = ["routes/consolidated_api_routes.py"] + sorted(
        str(f.relative_to(ROOT)) for f in (ROOT / "routes" / "api").glob("*.py"))
    assert all("/sms/send-test" not in _route_paths(f) for f in api)
