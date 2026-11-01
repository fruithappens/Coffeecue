"""A request made inside another (test_client) gets its own pooled
connection and returns only that one.

/me/order places the coffee through test_client. With the connection kept
on flask.g, which the inner request shares, the inner request returned the
outer's connection and the outer returned it again; the pool closed the
duplicate and the next customer request drew a dead connection (500).
"""
from flask import Flask, jsonify, request

import utils.database as database
from services.coffee_system import CoffeeOrderSystem


class _Conn:
    closed = 0


def test_inner_request_has_its_own_connection(monkeypatch):
    handed_out, returned = [], []

    def fake_get(*a, **k):
        c = _Conn()
        handed_out.append(c)
        return c

    def fake_close(c):
        returned.append(c)

    monkeypatch.setattr(database, "get_db_connection", fake_get)
    monkeypatch.setattr(database, "close_connection", fake_close)

    cs = CoffeeOrderSystem.__new__(CoffeeOrderSystem)
    cs._db = None
    app = Flask(__name__)

    # The same teardown app.py registers.
    @app.teardown_request
    def _release(exc=None):
        req = request._get_current_object()
        pooled = getattr(req, "_cupq_pooled_db", None)
        if pooled is not None:
            database.close_connection(pooled)
            req._cupq_pooled_db = None

    seen = {}

    @app.route("/inner")
    def inner():
        seen["inner"] = cs.db
        return jsonify(ok=True)

    @app.route("/outer")
    def outer():
        seen["outer_before"] = cs.db
        with app.test_client() as c:
            c.get("/inner")
        seen["outer_after"] = cs.db
        return jsonify(ok=True)

    with app.test_client() as c:
        c.get("/outer")

    assert seen["outer_before"] is seen["outer_after"]
    assert seen["inner"] is not seen["outer_before"]
    # Each connection handed back exactly once.
    assert sorted(map(id, returned)) == sorted(map(id, handed_out))
    assert len(returned) == 2
