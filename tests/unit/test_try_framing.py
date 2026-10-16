"""The live demo (/try) may be framed by cupq.com.au and nobody else; staff
screens stay same-origin only; event-app pages stay embeddable."""

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from flask import Flask, Response  # noqa: E402

import security_middleware as sm  # noqa: E402

app = Flask(__name__)


def headers(path):
    with app.test_request_context(path):
        r = sm.add_security_headers(Response("ok"))
    return r.headers.get("X-Frame-Options"), r.headers.get("Content-Security-Policy", "")


def test_try_page_framed_by_the_website_only():
    xfo, csp = headers("/try")
    assert xfo is None
    assert "frame-ancestors 'self' https://cupq.com.au https://www.cupq.com.au" in csp
    assert "frame-ancestors *" not in csp


def test_staff_screens_stay_same_origin():
    for path in ("/run", "/barista", "/api/try/state"):
        xfo, csp = headers(path)
        assert xfo == "SAMEORIGIN" and "frame-ancestors 'self';" in csp, path


def test_event_app_pages_still_embeddable():
    xfo, csp = headers("/order")
    assert xfo is None and "frame-ancestors" not in csp
