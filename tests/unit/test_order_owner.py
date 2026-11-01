"""Cancelling or collecting an order needs the key of the phone that placed it
(audit finding SEC-008): order numbers are sequential and on the public board."""
import ast
from pathlib import Path

from flask import Flask

from utils.order_owner import key_ok, order_key

ROUTES = Path(__file__).resolve().parents[2] / "routes" / "consolidated_api_routes.py"


def _app(secret="s1"):
    app = Flask(__name__)
    app.config["JWT_SECRET_KEY"] = secret
    return app


def test_key_matches_only_its_own_order():
    with _app().app_context():
        k = order_key("101")
        assert key_ok(k, "101")
        assert not key_ok(k, "102")
        assert not key_ok("", "101")
        assert not key_ok(None, "101")


def test_round_key_works_for_its_lettered_drinks():
    with _app().app_context():
        assert key_ok(order_key("336"), "336b", "336")
        assert not key_ok(order_key("337"), "336b", "336")


def test_key_depends_on_the_secret():
    with _app("s1").app_context():
        k1 = order_key("101")
    with _app("s2").app_context():
        assert not key_ok(k1, "101")


def test_public_order_actions_check_the_key():
    tree = ast.parse(ROUTES.read_text())
    wanted = {"customer_cancel_order", "mark_collected_public"}
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name in wanted:
            calls = {
                getattr(c.func, "id", None)
                for c in ast.walk(node)
                if isinstance(c, ast.Call)
            }
            assert "_owner_key_refused" in calls, f"{node.name} skips the owner key"
            wanted.discard(node.name)
    assert not wanted, f"routes not found: {wanted}"
