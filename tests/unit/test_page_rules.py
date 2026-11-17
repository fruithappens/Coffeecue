"""SEC-013: pages may run scripts only from CupQ itself.

The built app never calls eval / new Function and loads nothing from a CDN,
so the page rules allow neither. If a new library needs one, this test
fails first, and the choice is made on purpose rather than by accident."""

import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, ROOT)

from flask import Flask, Response  # noqa: E402

import security_middleware as sm  # noqa: E402

app = Flask(__name__)


def directives(path="/"):
    with app.test_request_context(path):
        csp = sm.add_security_headers(Response("ok")).headers["Content-Security-Policy"]
    out = {}
    for part in csp.split(";"):
        bits = part.split()
        if bits:
            out[bits[0]] = bits[1:]
    return out


def test_no_eval_and_no_outside_scripts():
    for path in ("/", "/barista", "/run", "/order", "/try"):
        d = directives(path)
        assert "'unsafe-eval'" not in d["script-src"], path
        for name in ("script-src", "style-src", "font-src"):
            outside = [s for s in d[name] if s.startswith("http")]
            assert not outside, (path, name, outside)


def test_frontend_source_loads_nothing_from_a_cdn():
    front = os.path.join(ROOT, "Barista Front End")
    hits = []
    for base in ("public", "src"):
        for dirpath, _dirs, files in os.walk(os.path.join(front, base)):
            if "test-framework" in dirpath:  # dev-only tool, never bundled
                continue
            for f in files:
                if not f.endswith((".html", ".js", ".jsx", ".css")):
                    continue
                text = open(os.path.join(dirpath, f), encoding="utf-8", errors="ignore").read()
                if re.search(r"<(script|link)[^>]+(src|href)=[\"']https?://", text):
                    hits.append(os.path.join(dirpath, f))
                if re.search(r"(?<![\w.$])eval\(|new Function\(", text):
                    hits.append(os.path.join(dirpath, f) + " (eval)")
    assert not hits, hits
