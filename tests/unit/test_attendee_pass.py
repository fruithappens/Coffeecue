"""On /my a typed mobile may see that attendee's coffee, but changing it
(rename, usual, cancel) needs the pass earned with their surname (SEC-009)."""
import ast
from pathlib import Path

from flask import Flask

from utils.order_owner import attendee_pass, pass_ok, same_surname

EA = Path(__file__).resolve().parents[2] / "routes" / "ea_survey_routes.py"


def _app():
    app = Flask(__name__)
    app.config["JWT_SECRET_KEY"] = "s1"
    return app


def test_pass_is_per_attendee():
    with _app().app_context():
        p = attendee_pass("c1")
        assert pass_ok("c1", p)
        assert not pass_ok("c2", p)
        assert not pass_ok("c1", "")
        assert not pass_ok("", p)


def test_surname_match_is_forgiving_but_not_loose():
    assert same_surname("o'brien", "O'Brien")
    assert same_surname("Smith-Jones", "smith jones")
    assert not same_surname("Smith", "Smyth")
    assert not same_surname("", "Smith")
    assert not same_surname("Smith", "")


def _func(tree, name):
    return next(n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name == name)


def test_changes_need_the_pass():
    tree = ast.parse(EA.read_text())
    for name in ("ea_me_set_usual", "ea_me_set_name"):
        calls = {getattr(c.func, "id", None) for c in ast.walk(_func(tree, name)) if isinstance(c, ast.Call)}
        assert "_pass_refused" in calls, f"{name} changes an attendee without the pass"


def test_lookups_fetch_the_surname():
    # Without last_name in the lookup every attendee would look surname-less
    # and the check would wave everyone through.
    src = EA.read_text()
    start = src.index("_ATT_COLS = (")
    assert "last_name" in src[start : src.index(")", start)]
