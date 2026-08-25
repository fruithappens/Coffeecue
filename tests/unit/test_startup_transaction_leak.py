"""Startup must not leave a transaction open on the shared connection.

THE BUG THIS GUARDS (2026-08-24, reproduced 5/5)

psycopg2 is not autocommit, so a bare SELECT opens a transaction that
lives until someone commits or rolls back. Several boot-time checks
read and returned without doing either, and they run on the singleton
connection that lives as long as the process — so a server sat `idle in
transaction` from boot onwards, holding ACCESS SHARE on `users`.

Nothing looks wrong until a schema change arrives. ALTER TABLE needs
ACCESS EXCLUSIVE, so it queues behind the idle transaction — and once
an ACCESS EXCLUSIVE request is WAITING, Postgres queues every later
lock request behind it, including plain SELECTs. Login hung system-wide
behind a migration that was itself waiting on a connection doing
nothing. Not a deadlock (no cycle), so Postgres never broke it, and the
process stayed alive so no restart policy fired.

It needs two instances on one database to bite, which is exactly what a
Railway deploy is: the new container boots while the old one still
serves.

These tests use a fake connection, so they need no database and stay
fast. The end-to-end check (start two servers, watch pg_stat_activity)
lives in the test bench.
"""

import os
import sys

sys.path.insert(
    0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
)

from services import migrations  # noqa: E402


def _executed_sql(source):
    """Every string literal passed to a .execute() call in `source`."""
    import ast

    found = []
    for node in ast.walk(ast.parse(source)):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        if not (isinstance(func, ast.Attribute) and func.attr == "execute"):
            continue
        for arg in node.args:
            if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
                found.append(arg.value)
    return found


class FakeCursor:
    """Records SQL and reports the transaction state a real psycopg2
    connection would be in after it."""

    def __init__(self, conn):
        self.conn = conn

    def execute(self, sql, params=None):
        self.conn.statements.append(sql)
        # Any statement starts a transaction if one isn't open.
        if not sql.strip().upper().startswith("SET"):
            self.conn.in_transaction = True

    def fetchall(self):
        # Pretend every migration is already applied — the ordinary
        # boot, and the case that used to leak: the loop body never
        # runs, so nothing ever commits.
        return [(m.version,) for m in migrations.MIGRATIONS]

    def fetchone(self):
        return None


class FakeConn:
    def __init__(self):
        self.statements = []
        self.in_transaction = False
        self.commits = 0
        self.rollbacks = 0

    def cursor(self):
        return FakeCursor(self)

    def commit(self):
        self.commits += 1
        self.in_transaction = False

    def rollback(self):
        self.rollbacks += 1
        self.in_transaction = False


class TestMigrationRunnerLeavesNoOpenTransaction:
    def test_ordinary_boot_ends_clean(self):
        """Every migration already applied: the loop body never runs,
        so only the bookkeeping SELECT happens. That SELECT is what
        used to be left dangling for the life of the process."""
        conn = FakeConn()
        migrations.apply_pending_migrations(conn)
        assert conn.in_transaction is False, (
            "migration runner returned with a transaction still open — "
            "this is the leak that wedged every later ALTER TABLE"
        )

    def test_runner_survives_a_failing_migration_without_leaking(self):
        conn = FakeConn()
        original = migrations.MIGRATIONS

        def boom(cur):
            raise RuntimeError("migration exploded")

        try:
            migrations.MIGRATIONS = [migrations.Migration(9999, "boom", boom)]
            migrations.apply_pending_migrations(conn)
        finally:
            migrations.MIGRATIONS = original

        assert conn.in_transaction is False, (
            "a failed migration left the connection in a transaction"
        )


class TestMigrationsCannotWedgeTheDatabase:
    def test_a_lock_timeout_is_set_before_any_ddl(self):
        """Without this, a migration blocked on a table lock waits
        forever AND blocks every reader queued behind it. With it, the
        migration fails fast, stays pending, and readers get through."""
        conn = FakeConn()
        migrations.apply_pending_migrations(conn)

        lock_timeouts = [s for s in conn.statements if "lock_timeout" in s.lower()]
        assert lock_timeouts, "no lock_timeout was set before running migrations"

        first_ddl = next(
            (
                i
                for i, s in enumerate(conn.statements)
                if "ALTER TABLE" in s.upper() or "CREATE TABLE" in s.upper()
            ),
            None,
        )
        if first_ddl is not None:
            first_timeout = conn.statements.index(lock_timeouts[0])
            assert first_timeout < first_ddl, (
                "lock_timeout must be set BEFORE any DDL runs, or the "
                "first ALTER can still wait forever"
            )

    def test_timeout_is_a_sane_bound(self):
        assert 0 < migrations.LOCK_TIMEOUT_MS <= 60_000, (
            "lock_timeout should be seconds, not minutes — its whole job "
            "is to fail before a lock convoy forms"
        )


class TestBootPathHasNoDDL:
    """The ALTERs that used to run on every boot are gone.

    They were written 'ADD COLUMN IF NOT EXISTS', which reads like a
    no-op once the column exists. It isn't: Postgres takes ACCESS
    EXCLUSIVE on the table BEFORE checking whether the column is there.
    So every single boot took the strongest possible lock on `users`,
    `station_stats` and `customer_preferences` for no reason — and that
    is what a second booting instance collided with.
    """

    def test_coffee_system_does_not_alter_tables_on_boot(self):
        path = os.path.join(
            os.path.dirname(
                os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            ),
            "services",
            "coffee_system.py",
        )
        with open(path, encoding="utf-8") as f:
            source = f.read()

        # Inspect the SQL actually handed to .execute(), not the file
        # text — the comments and docstrings in that module explain this
        # very bug and legitimately say "ALTER TABLE".
        offenders = [
            sql
            for sql in _executed_sql(source)
            if "ALTER TABLE" in sql.upper()
        ]
        assert not offenders, (
            "ALTER TABLE is back in a boot path: "
            f"{[' '.join(s.split())[:60] for s in offenders]}. "
            "Schema changes belong in services/migrations.py, where they "
            "run once per database under a lock_timeout — not on every "
            "single boot."
        )
