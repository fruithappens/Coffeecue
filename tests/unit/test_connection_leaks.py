"""No pooled connection outlives its request or its background job.

cupq.app's pool (30) emptied on 17 Oct 2026: the hourly backup kept one
connection per run, and ~30 handlers that took one with get_db_connection()
never returned it. Teardown now returns whatever a request took."""

import os
import sys
from unittest.mock import patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from flask import Flask  # noqa: E402

import utils.database as dbm  # noqa: E402


class Conn:
    closed = 0

    def rollback(self):
        pass

    def cursor(self):
        raise AssertionError("not used")


class Pool:
    maxconn = 30

    def __init__(self):
        self.out = set()

    def getconn(self):
        c = Conn()
        self.out.add(id(c))
        return c

    def putconn(self, c):
        self.out.discard(id(c))


app = Flask(__name__)


def with_pool():
    pool = Pool()
    return pool, patch.object(dbm, "connection_pool", pool)


def test_teardown_returns_what_a_handler_forgot():
    pool, p = with_pool()
    with p, app.test_request_context("/api/users"):
        a, b, c = dbm.get_db_connection(), dbm.get_db_connection(), dbm.get_db_connection()
        dbm.close_connection(a)  # this one the handler did return
        assert len(pool.out) == 2
        assert dbm.return_request_connections() == 2
    assert pool.out == set()


def test_a_request_inside_a_request_keeps_its_hands_off_the_outer_ones():
    pool, p = with_pool()
    with p, app.test_request_context("/api/try/advance"):
        outer = dbm.get_db_connection()
        with app.test_request_context("/api/orders/1/start"):
            dbm.get_db_connection()
            assert dbm.return_request_connections() == 1
        assert id(outer) in pool.out  # still the outer request's
        dbm.return_request_connections()
    assert pool.out == set()


def test_untracked_and_background_connections_are_the_callers_job():
    pool, p = with_pool()
    with p:
        with app.test_request_context("/"):
            kept = dbm.get_db_connection(track=False)
            assert dbm.return_request_connections() == 0
        bg = dbm.get_db_connection()  # no request: not tracked
        assert {id(kept), id(bg)} <= pool.out


def test_the_hourly_backup_returns_its_connection():
    import services.backup_scheduler as bs

    pool, p = with_pool()
    with p, patch("routes.event_data_routes.build_snapshot", side_effect=RuntimeError("boom")):
        assert bs.take_backup(app) is None
    assert pool.out == set()
