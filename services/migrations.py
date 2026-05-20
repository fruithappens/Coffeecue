"""
Schema migrations runner.

Replaces the scattered ALTER TABLE IF NOT EXISTS calls in
coffee_system._init_event_scheduling() with a proper numbered-
migrations system. Each migration is:

  - idempotent (safe to re-run)
  - applied in order, exactly once per database
  - tracked in the `schema_migrations` table

To add a migration:

  1. Append a new entry to the MIGRATIONS list below with the next
     version number.
  2. Provide a docstring (logged on apply).
  3. Provide a function `def upgrade(cursor)` that does the work.
     Cursor is already inside a transaction — raise to roll back.

Run via `apply_pending_migrations(conn)` at app startup. Existing
ALTER TABLE calls in coffee_system.py can stay during the
transition — migrations 1-5 below replicate them so a fresh DB
gets the right schema even without the legacy init path.

This module deliberately avoids dependencies on Flask, SQLAlchemy,
or Alembic. It's plain psycopg2 — minimal surface area.
"""
from __future__ import annotations
import logging
from typing import Callable, NamedTuple

logger = logging.getLogger(__name__)


class Migration(NamedTuple):
    version: int
    name: str
    upgrade: Callable[[object], None]


# ---------------------------------------------------------------------------
# Migration definitions
# ---------------------------------------------------------------------------
# Each migration's upgrade(cur) is a single function that runs inside a
# transaction. It receives a cursor. The runner commits after each
# migration succeeds.
#
# Migrations should be small and obviously correct. If you find yourself
# writing complex logic, prefer a "data migration" script run separately.

def _m001_station_stats_extras(cur):
    """Add columns historically expected on station_stats but missing
    on some installs: capabilities (JSONB), capacity, notes,
    equipment_notes, name, location. These exist as scattered
    ALTER TABLE calls in coffee_system._init_event_scheduling; this
    migration consolidates them."""
    cur.execute("""
        ALTER TABLE station_stats
        ADD COLUMN IF NOT EXISTS capabilities JSONB DEFAULT '{}'::jsonb,
        ADD COLUMN IF NOT EXISTS capacity INTEGER DEFAULT 10,
        ADD COLUMN IF NOT EXISTS notes TEXT,
        ADD COLUMN IF NOT EXISTS equipment_notes TEXT,
        ADD COLUMN IF NOT EXISTS name TEXT,
        ADD COLUMN IF NOT EXISTS location TEXT
    """)


def _m002_customer_preferences_is_vip(cur):
    """customer_preferences was missing is_vip on most installs;
    _handle_vip_code 500'd with 'column does not exist'."""
    cur.execute("""
        ALTER TABLE customer_preferences
        ADD COLUMN IF NOT EXISTS is_vip BOOLEAN DEFAULT FALSE
    """)


def _m003_users_is_active(cur):
    """support_api_routes references users.is_active for the User
    Management panel; was never in the schema."""
    cur.execute("""
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE
    """)


def _m004_order_number_seq(cur):
    """Postgres sequence used by both SMS flow and walk-in flow to
    generate short, human-friendly order numbers ('C42' rather than
    'W0544296')."""
    cur.execute("CREATE SEQUENCE IF NOT EXISTS order_number_seq START 1")


def _m005_orders_picked_up_at(cur):
    """`picked_up_at` timestamp written by /api/orders/<id>/pickup.
    Older DBs missing this column take the slow-path UPDATE in the
    pickup endpoint."""
    cur.execute("""
        ALTER TABLE orders
        ADD COLUMN IF NOT EXISTS picked_up_at TIMESTAMP
    """)


# Master list. Append new migrations at the bottom — DO NOT renumber
# existing ones, and DO NOT change `version`. The runner trusts the
# version number to determine which migrations to skip.
MIGRATIONS: list[Migration] = [
    Migration(1, 'station_stats_extras',       _m001_station_stats_extras),
    Migration(2, 'customer_preferences_is_vip', _m002_customer_preferences_is_vip),
    Migration(3, 'users_is_active',            _m003_users_is_active),
    Migration(4, 'order_number_seq',           _m004_order_number_seq),
    Migration(5, 'orders_picked_up_at',        _m005_orders_picked_up_at),
]


# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------

def _ensure_migrations_table(cur):
    """Create the bookkeeping table on first run."""
    cur.execute("""
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version  INTEGER PRIMARY KEY,
            name     TEXT NOT NULL,
            applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)


def _applied_versions(cur) -> set[int]:
    cur.execute("SELECT version FROM schema_migrations")
    return {row[0] for row in cur.fetchall()}


def apply_pending_migrations(conn) -> list[str]:
    """Apply any migrations whose version is greater than what's
    already recorded. Returns a list of human-readable strings for
    each migration applied. Safe to call at every boot.

    Raises only on truly fatal errors — individual migration failures
    are logged and the runner moves on (best-effort, like the existing
    ALTER TABLE IF NOT EXISTS pattern).
    """
    applied: list[str] = []
    try:
        cur = conn.cursor()
        _ensure_migrations_table(cur)
        conn.commit()
        already = _applied_versions(cur)
        for m in MIGRATIONS:
            if m.version in already:
                continue
            try:
                logger.info(f"[migrations] applying #{m.version} {m.name}")
                m.upgrade(cur)
                cur.execute(
                    "INSERT INTO schema_migrations (version, name) VALUES (%s, %s) "
                    "ON CONFLICT (version) DO NOTHING",
                    (m.version, m.name),
                )
                conn.commit()
                applied.append(f"#{m.version} {m.name}")
            except Exception as e:
                logger.error(f"[migrations] #{m.version} {m.name} FAILED: {e}")
                try:
                    conn.rollback()
                except Exception:
                    pass
        if applied:
            logger.info(f"[migrations] applied: {', '.join(applied)}")
        else:
            logger.info("[migrations] no pending migrations")
    except Exception as e:
        logger.exception(f"[migrations] runner failed: {e}")
        try:
            conn.rollback()
        except Exception:
            pass
    return applied
