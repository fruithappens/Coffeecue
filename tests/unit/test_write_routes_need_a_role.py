"""Every route that changes something names who may do it (audit SEC-003).

A login isn't enough: barista logins are shared at the cart and handed to
QR-set-up tablets. A new write route fails this test until it has a role
check, or is added below with the reason it doesn't need one.
"""
import ast
import re
from pathlib import Path

from flask import Flask, g, jsonify

from auth import MANAGER_ROLES, STAFF_ROLES, role_allowed, writes_need

ROUTES = Path(__file__).resolve().parents[2] / "routes"

# Login-only on purpose: the route checks inside, or it's the caller's own account.
CHECKS_INSIDE = {
    ("two_step_routes.py", "setup"),
    ("two_step_routes.py", "enable"),
    ("two_step_routes.py", "disable"),
    ("user_api_routes.py", "create_user"),
    ("user_api_routes.py", "update_user"),
    ("users_simple_api.py", "create_user"),
}


def _login_only_writes():
    for path in sorted(ROUTES.glob("*.py")):
        for node in ast.walk(ast.parse(path.read_text())):
            if not isinstance(node, ast.FunctionDef):
                continue
            decs = [ast.unparse(d) for d in node.decorator_list]
            routes = " ".join(d for d in decs if ".route(" in d)
            if not routes or not re.search(r"POST|PUT|PATCH|DELETE", routes):
                continue
            others = [d for d in decs if ".route(" not in d]
            if not any("jwt_required" in d for d in others):
                continue  # public routes have their own checks (webhooks, ordering)
            if any(re.search(r"role|writes_need|admin|support_", d) for d in others):
                continue
            yield path.name, node.name


def test_no_write_route_is_login_only():
    found = set(_login_only_writes()) - CHECKS_INSIDE
    assert not found, f"these change things with only a login check: {sorted(found)}"


def _client(role, roles):
    app = Flask(__name__)

    @app.before_request
    def _user():
        g.user = {"role": role}

    @app.route("/x", methods=["GET", "PUT"])
    @writes_need(roles)
    def x():
        return jsonify(ok=True)

    return app.test_client()


def test_a_barista_can_read_but_not_change_a_manager_route():
    c = _client("barista", MANAGER_ROLES)
    assert c.get("/x").status_code == 200
    assert c.put("/x").status_code == 403


def test_a_barista_can_change_a_staff_route():
    assert _client("barista", STAFF_ROLES).put("/x").status_code == 200


def test_an_unnamed_role_cannot_change_anything():
    for role in ("display", "customer", "", "guest"):
        assert _client(role, STAFF_ROLES).put("/x").status_code == 403


def test_organizers_count_wherever_staff_does():
    for role in ("organizer", "organiser", "event_organizer"):
        assert role_allowed(role, ["admin", "staff"])
        assert _client(role, MANAGER_ROLES).put("/x").status_code == 200
    assert not role_allowed("barista", ["admin", "staff"])
