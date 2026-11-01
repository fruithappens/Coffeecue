"""Every route that writes the settings table is closed to barista logins.

Barista logins are shared at the cart and handed to QR-set-up tablets; the
settings table holds the plan tier, PINs and event-access config.
"""
import ast
from pathlib import Path

SRC = Path(__file__).resolve().parents[2] / "routes" / "consolidated_api_routes.py"


def _settings_writers():
    tree = ast.parse(SRC.read_text())
    for node in ast.walk(tree):
        if not isinstance(node, ast.FunctionDef):
            continue
        route = roles = None
        for dec in node.decorator_list:
            if not isinstance(dec, ast.Call):
                continue
            name = getattr(dec.func, "attr", getattr(dec.func, "id", ""))
            if name == "route" and dec.args and isinstance(dec.args[0], ast.Constant):
                methods = [
                    e.value
                    for kw in dec.keywords
                    if kw.arg == "methods"
                    for e in kw.value.elts
                ]
                if dec.args[0].value == "/settings" and set(methods) & {"PUT", "PATCH", "POST"}:
                    route = methods
            if name == "role_required_with_demo" and dec.args:
                roles = [e.value for e in dec.args[0].elts]
        if route:
            yield node.name, roles


def test_settings_writes_need_a_manager():
    found = list(_settings_writers())
    assert found, "no settings write routes found"
    for name, roles in found:
        assert roles is not None, f"{name} has no role check"
        assert "barista" not in roles, f"{name} lets a barista login write settings"
