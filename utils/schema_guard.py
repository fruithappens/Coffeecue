"""Stop shipping schema changes down the request path.

The pattern this exists to kill, from POST /orders/<id>/start -- the
hottest path in the system, run once per drink:

    ALTER TABLE orders ADD COLUMN IF NOT EXISTS started_at TIMESTAMP

The column already exists. It reads as a harmless no-op, and it is not:
**ALTER TABLE takes ACCESS EXCLUSIVE on the table BEFORE it checks
whether the column is there.** Measured, not assumed -- against a plain
reader holding ACCESS SHARE, a no-op ADD COLUMN blocked for the full
lock_timeout while CREATE TABLE IF NOT EXISTS and CREATE INDEX IF NOT
EXISTS returned in hundredths of a second. Only ADD COLUMN grabs first
and asks later.

An ACCESS EXCLUSIVE request that is merely WAITING queues every later
reader behind it, so one slow moment turns into a stalled table. That is
the same mechanism as the boot-time lock convoy, on a path that runs
400+ times at an event instead of once.

The fix is not to delete the safety net -- a fresh database really does
need the column. It is to ASK FIRST:

    information_schema.columns is an ordinary catalogue read. It takes
    no exclusive lock, it costs a fraction of a millisecond, and if the
    column is already there we never issue DDL at all.

And then to remember the answer, so the check itself stops costing
anything after the first request.
"""

import logging
import threading

logger = logging.getLogger(__name__)

# Per-process memory of what we have already confirmed. A schema does
# not change under a running process without a deploy, and a deploy is a
# new process, so caching "present" for the life of the process is
# sound. Deliberately only caches PRESENT: a column we failed to find is
# re-checked, so a database repaired underneath us heals on the next
# request rather than staying broken until a restart.
_known_present = set()
_lock = threading.Lock()


def _cache_key(table, column):
    return f"{table}.{column}".lower()


def reset_cache():
    """Forget everything. For tests, and for nothing else."""
    with _lock:
        _known_present.clear()


def column_exists(db, table, column):
    """Is the column there? A catalogue read, not a schema change.

    Returns None when the question could not be answered -- which the
    caller must treat as "do not assume it is missing", because acting
    on a failed check is how a hot path starts issuing DDL again.
    """
    try:
        cur = db.cursor()
        cur.execute(
            "SELECT 1 FROM information_schema.columns "
            "WHERE table_name = %s AND column_name = %s LIMIT 1",
            (str(table), str(column)),
        )
        return cur.fetchone() is not None
    except Exception as e:
        logger.warning("Could not check %s.%s: %s", table, column, e)
        try:
            db.rollback()
        except Exception:
            pass
        return None


def ensure_column(db, table, column, ddl):
    """Make sure a column exists, taking a lock only if it truly does not.

    Returns True if the column is present (or was just added), False if
    it is definitely absent and could not be added, and True on an
    unanswerable check -- fail SAFE, meaning "carry on without DDL".
    Blocking a barista from starting a coffee because a catalogue query
    hiccuped would be a worse bug than the one this fixes.
    """
    key = _cache_key(table, column)
    if key in _known_present:
        return True

    present = column_exists(db, table, column)

    if present:
        with _lock:
            _known_present.add(key)
        return True

    if present is None:
        # Could not tell. Do NOT issue DDL on a guess -- that is exactly
        # the exclusive lock this module exists to avoid.
        return True

    # Genuinely missing. This is the one case worth a lock, and it
    # happens once on a fresh database rather than once per request.
    logger.warning("Column %s.%s missing - adding it once.", table, column)
    try:
        cur = db.cursor()
        cur.execute(ddl)
        db.commit()
        with _lock:
            _known_present.add(key)
        return True
    except Exception as e:
        logger.error("Could not add %s.%s: %s", table, column, e)
        try:
            db.rollback()
        except Exception:
            pass
        return False
