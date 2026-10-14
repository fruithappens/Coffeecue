"""The connection pool under load (1,000-phone load test, 13 Oct 2026).

Two failures, both reproduced against a local server with a pool of 4:

1. psycopg2's SimpleConnectionPool has no lock. Under eventlet, opening a
   connection yields mid-getconn(), so 200 requests all passed the "fewer
   than maxconn?" check and Postgres ran out of connections.
2. "connection pool exhausted" (all in use) was treated as a broken pool and
   the pool was rebuilt, orphaning every connection still checked out.

No database needed: the pool is faked.
"""
import threading
import time

import pytest

psycopg2 = pytest.importorskip("psycopg2")

from utils import database  # noqa: E402


def test_pool_is_the_locked_kind():
    src = open(database.__file__).read()
    assert "pool.ThreadedConnectionPool(" in src
    assert "pool.SimpleConnectionPool(" not in src


class _FakePool:
    def __init__(self, free):
        self.free = free
        self.maxconn = free
        self.lock = threading.Lock()

    def getconn(self):
        with self.lock:
            if self.free <= 0:
                raise psycopg2.pool.PoolError("connection pool exhausted")
            self.free -= 1
            return object()

    def putconn(self, conn, *a, **k):
        with self.lock:
            self.free += 1


def test_busy_pool_waits_for_a_connection_instead_of_rebuilding(monkeypatch):
    fake = _FakePool(free=0)
    monkeypatch.setattr(database, "connection_pool", fake)
    monkeypatch.setattr(database, "_POOL_WAIT_S", 3.0)
    rebuilt = []
    monkeypatch.setattr(database, "init_db_pool", lambda *a, **k: rebuilt.append(1))

    # Someone hands a connection back shortly.
    threading.Timer(0.2, fake.putconn, args=(object(),)).start()
    t0 = time.monotonic()
    conn = database.get_db_connection()
    assert conn is not None
    assert 0.15 < time.monotonic() - t0 < 2.5
    assert rebuilt == []


def test_pool_still_busy_after_the_wait_fails_the_request_not_the_pool(monkeypatch):
    fake = _FakePool(free=0)
    monkeypatch.setattr(database, "connection_pool", fake)
    monkeypatch.setattr(database, "_POOL_WAIT_S", 0.2)
    rebuilt = []
    monkeypatch.setattr(database, "init_db_pool", lambda *a, **k: rebuilt.append(1))

    with pytest.raises(database._PoolBusy):
        database.get_db_connection()
    assert rebuilt == []
    assert database.connection_pool is fake
