"""Is someone backing this server up? (roadmap S1-14)

The backups run on Steve's Mac (scripts/backup_prod.py: a full dump every
night, an hourly one when anything changed). After each good, verified
dump the Mac checks in here:

    POST /api/public/backup-heartbeat   Authorization: Bearer <BACKUP_HEARTBEAT_TOKEN>
    {"kind": "nightly" | "hourly", "bytes": 15100000}

and the service watch (services/service_watch.py) texts the admin number
and whoever is on call when there's been no good backup for STALE_HOURS.
Found 15 Oct 2026: that night's dump failed (the Mac woke late and the
connection dropped) and nothing told anyone; the hourly job had been
failing every hour for three days the same way.

Off unless BACKUP_HEARTBEAT_TOKEN is set: a copy nobody backs up (demo)
never nags.
"""
import json
import logging
import os
import time
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

KV_KEY = "backup_heartbeat"
STALE_HOURS = float(os.getenv("BACKUP_STALE_HOURS", "26"))
REALERT_S = 6 * 3600  # a missed backup texts every 6 hours, not every 15 minutes

_last_alert = {"at": 0.0}


def enabled():
    return bool(os.getenv("BACKUP_HEARTBEAT_TOKEN"))


def _read(cur):
    cur.execute("SELECT value FROM settings WHERE key = %s", (KV_KEY,))
    row = cur.fetchone()
    raw = (row[0] if not isinstance(row, dict) else row.get("value")) if row else None
    try:
        v = json.loads(raw) if isinstance(raw, str) else (raw or {})
    except ValueError:
        v = {}
    return v if isinstance(v, dict) else {}


def record(conn, kind, size):
    """Store a good backup's check-in."""
    v = {"at": datetime.now(timezone.utc).isoformat(), "kind": str(kind)[:12],
         "bytes": int(size or 0)}
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO settings (key, value) VALUES (%s, %s) "
        "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
        (KV_KEY, json.dumps(v)))
    conn.commit()
    return v


def last(cur):
    """(hours since the last good backup or None if never, the record)."""
    v = _read(cur)
    try:
        at = datetime.fromisoformat(v["at"])
    except (KeyError, ValueError, TypeError):
        return None, v
    return (datetime.now(timezone.utc) - at).total_seconds() / 3600, v


def check(cur, alert, now=None):
    """Alert when backups are expected and the newest is too old. Returns
    the (code, message) raised, or None."""
    if not enabled():
        return None
    hours, _v = last(cur)
    if hours is not None and hours < STALE_HOURS:
        _last_alert["at"] = 0.0  # healthy again: the next miss texts at once
        return None
    now = now if now is not None else time.monotonic()
    if _last_alert["at"] and now - _last_alert["at"] < REALERT_S:
        return None
    _last_alert["at"] = now
    if hours is None:
        msg = ("CupQ: no backup of this server has ever checked in. Check the "
               "backup job on the Mac (~/expresso/backups/backup.log).")
    else:
        msg = (f"CupQ: no good backup for {hours:.0f} hours. Is the Mac on and "
               "online? See ~/expresso/backups/backup.log.")
    alert("BACKUP_MISSED", "critical", msg)
    return ("BACKUP_MISSED", msg)
