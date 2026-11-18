"""Every route that writes the settings table is closed to barista logins.

Barista logins are shared at the cart and handed to QR-set-up tablets; the
settings table holds the plan tier, PINs and event-access config.
"""
import ast
from pathlib import Path

ROUTES = Path(__file__).resolve().parents[2] / "routes"
# The /api endpoints: the core file plus the area files split out of it.
SRCS = [ROUTES / "consolidated_api_routes.py", *sorted(ROUTES.glob("api/*.py"))]


def _settings_writers():
    for node in (n for src in SRCS for n in ast.walk(ast.parse(src.read_text()))):
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
                arg = dec.args[0]
                # A named list (MANAGER_ROLES) never includes barista.
                roles = [arg.id] if isinstance(arg, ast.Name) else [e.value for e in arg.elts]
        if route:
            yield node.name, roles


def test_settings_writes_need_a_manager():
    found = list(_settings_writers())
    assert found, "no settings write routes found"
    for name, roles in found:
        assert roles is not None, f"{name} has no role check"
        assert "barista" not in roles, f"{name} lets a barista login write settings"
