"""Self-serve sign-up: what the public form accepts, and the saved event it becomes."""

import base64
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

import routes.signup_routes as su  # noqa: E402

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


def form(**kw):
    base = {"organisation": "Acme Events", "name": "Jo", "email": "jo@acme.example", "event_name": "Acme Summit",
            "starts": "2026-11-03", "ends": "2026-11-04", "milks": ["oat", "full cream", "goat"],
            "sizes": ["large"], "drinks": {"chai": True, "espresso_drinks": True}, "agree": True}
    base.update(kw)
    return base


def test_a_good_form_is_tidied():
    f, why = su.clean(form())
    assert why is None
    assert f["slug"] == "acme-events"                       # made from the organisation
    assert f["milks"] == ["full cream", "oat"]              # menu order, unknown milk dropped
    assert f["drinks"] == {"espresso_drinks": True, "hot_chocolate": False, "chai": True, "matcha": False}
    assert f["timezone"] == "Australia/Adelaide" and f["primary_colour"] == "#3B2A20"


def test_refusals_say_what_to_fix():
    for change, word in (({"organisation": ""}, "organisation"), ({"email": "nope"}, "email"),
                         ({"event_name": ""}, "called"), ({"slug": "www"}, "web address"),
                         ({"slug": "Bad Name!"}, "web address"), ({"starts": "soon"}, "first and last"),
                         ({"ends": "2026-11-01"}, "before"), ({"agree": False}, "terms"),
                         ({"phone": "123"}, "short")):
        f, why = su.clean(form(**change))
        assert f is None and word in why, (change, why)


def test_logo_is_checked_by_its_bytes():
    ok = "data:image/png;base64," + base64.b64encode(PNG).decode()
    assert su.clean_logo(ok)[0].startswith("data:image/png;base64,")
    svg = "data:image/svg+xml;base64," + base64.b64encode(b"<svg onload=alert(1)>").decode()
    assert su.clean_logo(svg) == ("", "The logo must be a PNG or JPEG image.")
    liar = "data:image/png;base64," + base64.b64encode(b"<html>not a png").decode()
    assert su.clean_logo(liar)[1] == "The logo must be a PNG or JPEG image."
    big = "data:image/png;base64," + base64.b64encode(PNG + b"\x00" * su.LOGO_MAX_BYTES).decode()
    assert "too big" in su.clean_logo(big)[1]
    assert su.clean_logo("") == ("", None)


def test_event_file_matches_what_quick_setup_saves():
    f, _ = su.clean(form(teas=True, primary_colour="#E10A0A"))
    ev = su.to_event(f)
    p = ev["payload"]
    assert ev["name"] == "Acme Summit" and isinstance(p, dict)
    assert p["event_name"] == "Acme Summit" and p["branding"]["clientName"] == "Acme Events"
    assert p["branding"]["primaryColor"] == "#E10A0A"
    assert p["teas"]["english_breakfast"] and not p["teas"]["generic"]
    assert p["sizes"] == ["large"] and p["vip_code"] == ""
    # The build script refuses a file without a payload dict; this one has it.
    assert set(("milks", "sizes", "drinks", "teas", "branding")) <= set(p)


def test_build_command_carries_nothing_a_stranger_typed():
    from datetime import date as d, datetime
    from unittest.mock import patch

    from flask import Flask

    row = (7, datetime(2026, 10, 15), "approved", "Acme", "Jo", "jo@acme.example", None,
           'Summit"; rm -rf ~ #', "acme", d(2026, 11, 3), d(2026, 11, 4), "200", "Australia/Adelaide",
           True, "pro", "{}", None, None, True, None, "steve")

    class Cur:
        def execute(self, *a):
            pass

        def fetchall(self):
            return [row]

    class Conn:
        def cursor(self):
            return Cur()

    app = Flask(__name__)
    with patch.object(su, "_db", return_value=Conn()), patch.object(su, "_release"), \
         app.test_request_context("/api/signups"):
        view = su.list_signups
        while hasattr(view, "__wrapped__"):
            view = view.__wrapped__
        cmd = view().get_json()["signups"][0]["build_command"]
    assert cmd == ("cd ~/expresso && python3 scripts/new_client.py acme --apply --region sg "
                   "--event-file ~/Downloads/acme.cupq-event.json")
