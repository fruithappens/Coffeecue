"""Keeping schema changes off the request path.

The property under test is not "does it add the column". It is "does it
avoid taking an ACCESS EXCLUSIVE lock when it does not need one" --
because that lock, requested on a path that runs once per drink, is what
stalls a whole table.
"""

import os
import sys

sys.path.insert(
    0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
)

from utils.schema_guard import (column_exists, ensure_column,  # noqa: E402
                                reset_cache)


class FakeCursor:
    def __init__(self, db):
        self.db = db

    def execute(self, sql, params=None):
        self.db.executed.append(sql.strip())
        if self.db.raise_on and self.db.raise_on in sql:
            raise RuntimeError("boom")
        self._result = (
            (1,) if (self.db.column_present and "information_schema" in sql) else None
        )

    def fetchone(self):
        return self._result


class FakeDB:
    def __init__(self, column_present=True, raise_on=None):
        self.column_present = column_present
        self.raise_on = raise_on
        self.executed = []
        self.commits = 0
        self.rollbacks = 0

    def cursor(self):
        return FakeCursor(self)

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1


DDL = "ALTER TABLE orders ADD COLUMN IF NOT EXISTS started_at TIMESTAMP"


def setup_function():
    reset_cache()


def _alters(db):
    return [s for s in db.executed if "ALTER TABLE" in s]


def test_no_ddl_when_the_column_is_already_there():
    # The whole point. This is the production case, every single request.
    db = FakeDB(column_present=True)
    assert ensure_column(db, "orders", "started_at", DDL) is True
    assert _alters(db) == [], "took an exclusive lock it did not need"


def test_it_adds_the_column_when_genuinely_missing():
    db = FakeDB(column_present=False)
    assert ensure_column(db, "orders", "started_at", DDL) is True
    assert len(_alters(db)) == 1
    assert db.commits == 1


def test_the_check_itself_stops_costing_anything():
    # A catalogue read is cheap, but not free, and this runs per drink.
    db = FakeDB(column_present=True)
    for _ in range(50):
        ensure_column(db, "orders", "started_at", DDL)
    assert len(db.executed) == 1, "re-queried the catalogue every call"


def test_a_failed_check_does_NOT_trigger_ddl():
    # Acting on an unanswerable check is how a hot path starts issuing
    # exclusive-lock DDL again.
    db = FakeDB(column_present=True, raise_on="information_schema")
    assert ensure_column(db, "orders", "started_at", DDL) is True
    assert _alters(db) == []


def test_a_failed_check_is_not_cached():
    # A database repaired underneath us should heal on the next request,
    # not stay broken until someone restarts the process.
    db = FakeDB(column_present=True, raise_on="information_schema")
    ensure_column(db, "orders", "started_at", DDL)
    healthy = FakeDB(column_present=True)
    ensure_column(healthy, "orders", "started_at", DDL)
    assert len(healthy.executed) == 1, "cached a failure as success"


def test_a_failed_alter_reports_failure_and_rolls_back():
    db = FakeDB(column_present=False, raise_on="ALTER TABLE")
    assert ensure_column(db, "orders", "started_at", DDL) is False
    assert db.rollbacks == 1


def test_column_exists_returns_none_when_it_cannot_tell():
    db = FakeDB(raise_on="information_schema")
    assert column_exists(db, "orders", "started_at") is None


def test_different_columns_are_cached_separately():
    db = FakeDB(column_present=True)
    ensure_column(db, "orders", "started_at", DDL)
    ensure_column(db, "orders", "picked_up_at", DDL)
    assert len(db.executed) == 2
