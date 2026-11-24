"""Orders left waiting from an earlier day are closed, never left to top
the next event's queue (three from Sep were still pending in Nov 2026)."""
import pytest

from services import stale_orders


class _Cur:
    def __init__(self, conn):
        self.conn = conn

    def execute(self, sql, params):
        if self.conn.fail:
            raise RuntimeError("db down")
        self.conn.sql, self.conn.params = sql, params

    def fetchall(self):
        return [(1, "1028"), (2, "1029")]


class _Conn:
    def __init__(self, fail=False):
        self.fail, self.committed, self.rolled_back = fail, False, False

    def cursor(self):
        return _Cur(self)

    def commit(self):
        self.committed = True

    def rollback(self):
        self.rolled_back = True


def test_closes_only_waiting_orders_past_the_limit():
    conn = _Conn()
    assert stale_orders.close_stale(conn) == ["1028", "1029"]
    assert conn.committed
    assert "status IN ('pending', 'in-progress')" in conn.sql
    assert "scheduled_for IS NULL OR scheduled_for <" in conn.sql
    assert "'completed'" not in conn.sql  # made coffees are never touched
    assert conn.params == (stale_orders.NOTE, 12, 12)


def test_an_error_rolls_back():
    conn = _Conn(fail=True)
    with pytest.raises(RuntimeError):
        stale_orders.close_stale(conn)
    assert conn.rolled_back and not conn.committed


def test_sweep_never_raises(monkeypatch):
    from services import service_watch

    monkeypatch.setattr(service_watch, "_connect", lambda: _Conn(fail=True))
    assert service_watch.sweep_stale_orders() == []
