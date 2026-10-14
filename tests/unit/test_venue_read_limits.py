"""Venue-sized rate limits on the public pages a room polls (13 Oct 2026).

A venue's wifi is one public address; the 5,000/hour default cut the room
off after about a dozen phones. The pages in PUBLIC_POLL_READS get a cap
sized for a full room instead. No database needed.
"""
import glob
import re

import flask
import pytest

pytest.importorskip("flask_limiter")

import security_middleware as sm  # noqa: E402


def _all_route_paths():
    paths = set()
    for f in glob.glob("routes/*.py") + ["app.py"]:
        src = open(f).read()
        prefix = ""
        m = re.search(r"Blueprint\([^)]*url_prefix=['\"]([^'\"]+)['\"]", src)
        if m:
            prefix = m.group(1)
        for r in re.findall(r"route\(\s*['\"]([^'\"]+)['\"]", src):
            paths.add(r if r.startswith("/api") else prefix + r)
            paths.add("/api" + r)
    return paths


def test_every_venue_sized_page_is_a_real_route():
    # A renamed route would silently drop back to the 5,000/hour default.
    paths = _all_route_paths()
    missing = [p for p in sm.PUBLIC_POLL_READS if p not in paths]
    assert missing == []


def test_the_wrapped_view_replaces_the_original():
    # Flask-Limiter checks a route's own limit inside the wrapper it
    # returns; keeping the original view means no limit at all.
    app = flask.Flask(__name__)

    @app.route("/api/display/orders")
    def board():
        return "ok"

    @app.route("/api/app-version")
    def version():
        return "v"

    found = sm.size_public_reads_for_venue(app)
    assert found == ["/api/display/orders"]
    assert app.view_functions["board"] is not board
    assert getattr(app.view_functions["board"], "_cupq_venue_sized", False)
    assert app.view_functions["version"] is version
    # Idempotent: a second call doesn't wrap twice.
    once = app.view_functions["board"]
    sm.size_public_reads_for_venue(app)
    assert app.view_functions["board"] is once
