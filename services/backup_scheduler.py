"""Hourly backups taken BY the server, so they do not need Steve's laptop.

Steve: "I can't always guarantee that my laptop will be online and on the
Internet when these events are."

Quite right, and that is exactly when backups matter most. The local
scheduler still runs and is still worth having -- two copies in two
places is the point -- but the server now takes its own on the same
hourly, only-when-changed rule, so a laptop that is shut costs nothing.

WHERE THEY GO, in order of preference:

  1. RAILWAY_VOLUME_MOUNT_PATH, if a volume is attached. This is the one
     that actually survives things: a Railway volume outlives deploys,
     restarts and container replacement.
  2. Otherwise a directory on the container disk, which is EPHEMERAL --
     wiped on the next deploy. Still better than nothing between
     deploys, and it says so loudly in the log rather than pretending.

Attach a volume in the Railway dashboard and it is used automatically;
no code change, no redeploy needed beyond the restart that mounting it
causes anyway.

TWO RULES THIS FOLLOWS THAT THE REST OF THE APP LEARNED THE HARD WAY:

  * It opens its OWN database connection and never touches
    coffee_system.db. That singleton is shared by nearly every request
    handler, and a slow query on it stalls the entire site -- that is
    precisely what took production down on 25 Aug. A background job must
    not be able to do that.
  * It never raises into the app. A backup that fails is a problem; a
    backup that takes the coffee system down with it is a catastrophe.
"""

import gzip
import json
import logging
import os
import threading
import time
from datetime import datetime

logger = logging.getLogger(__name__)

INTERVAL_SECONDS = int(os.environ.get("BACKUP_INTERVAL_SECONDS", 3600))
KEEP_RECENT = int(os.environ.get("BACKUP_KEEP_RECENT", 48))  # ~2 days hourly
KEEP_DAILY = int(os.environ.get("BACKUP_KEEP_DAILY", 30))  # then a month
_started = False
_lock = threading.Lock()


def backup_dir():
    """The volume if there is one, otherwise ephemeral container disk."""
    vol = os.environ.get("RAILWAY_VOLUME_MOUNT_PATH")
    if vol:
        path = os.path.join(vol, "backups")
    else:
        path = os.environ.get("BACKUP_DIR", "/tmp/coffeecue-backups")
    try:
        os.makedirs(path, exist_ok=True)
    except Exception as e:
        logger.warning("backup dir %s unusable: %s", path, e)
    return path


def on_volume():
    return bool(os.environ.get("RAILWAY_VOLUME_MOUNT_PATH"))


def _fingerprint(snapshot):
    """Change means the DATA changed, not that the clock moved. The export
    stamps itself every run, so hashing the file would make every
    snapshot look different and defeat the whole idea."""
    tables = (snapshot or {}).get("tables") or {}
    orders = tables.get("orders") or []
    newest = ""
    for o in orders:
        ts = str(o.get("updated_at") or o.get("created_at") or "")
        if ts > newest:
            newest = ts
    return {
        "orders": len(orders),
        "customers": len(tables.get("customer_preferences") or []),
        "messages": len(tables.get("sms_messages") or []),
        "newest": newest,
        "event": (snapshot or {}).get("event_name"),
    }


def _fingerprint_path():
    return os.path.join(backup_dir(), ".last_fingerprint.json")


def _read_fingerprint():
    try:
        with open(_fingerprint_path()) as fh:
            return json.load(fh)
    except Exception:
        return None


def _write_fingerprint(fp):
    try:
        with open(_fingerprint_path(), "w") as fh:
            json.dump(fp, fh)
    except Exception as e:
        logger.warning("could not record backup fingerprint: %s", e)


def prune(path=None):
    """Everything for KEEP_RECENT files, then one a day for KEEP_DAILY."""
    path = path or backup_dir()
    try:
        files = sorted(
            (
                f
                for f in os.listdir(path)
                if f.startswith("auto-") and f.endswith(".json.gz")
            ),
            reverse=True,
        )
    except Exception:
        return 0
    removed, seen_days = 0, set()
    for i, name in enumerate(files):
        if i < KEEP_RECENT:
            continue
        day = name[5:13]  # auto-YYYYMMDD-...
        if day in seen_days or len(seen_days) > KEEP_DAILY:
            try:
                os.remove(os.path.join(path, name))
                removed += 1
            except OSError:
                pass
        else:
            seen_days.add(day)
    return removed


def take_backup(app):
    """One backup. Returns a short human sentence, or None when skipped."""
    from routes.event_data_routes import build_snapshot

    # Its OWN connection. Never the shared singleton -- see the module
    # docstring; this is the rule that keeps a background job from being
    # able to stall every request in the system.
    from utils.database import get_db_connection

    conn = None
    try:
        conn = get_db_connection()
        if conn is None:
            logger.warning("backup: no database connection available")
            return None
        snapshot = build_snapshot(conn)
    except Exception as e:
        logger.error("backup: could not build snapshot: %s", e)
        return None
    finally:
        try:
            if conn is not None:
                conn.rollback()  # read-only; do not leave a txn open
        except Exception:
            pass

    fp = _fingerprint(snapshot)
    if fp == _read_fingerprint():
        return None

    path = backup_dir()
    name = "auto-%s.json.gz" % datetime.now().strftime("%Y%m%d-%H%M%S")
    full = os.path.join(path, name)

    # WRITTEN TO A TEMP FILE AND RENAMED ONLY ONCE IT IS COMPLETE.
    #
    # The first version wrote straight to the final name, and when the
    # serialisation raised -- snapshots contain datetime and Decimal, so
    # it raised on the very first run -- it left a 46-byte file sitting
    # in the backup list looking exactly like a backup. An empty file
    # that claims to be a backup is worse than no file at all: you only
    # find out when you are restoring it.
    #
    # default=str is what the export endpoint has always used; the
    # scheduler was missing it, which is how that failure arose.
    tmp = full + ".part"
    try:
        with gzip.open(tmp, "wb") as fh:
            fh.write(
                json.dumps(
                    {"status": "success", "snapshot": snapshot}, default=str
                ).encode()
            )
        written = os.path.getsize(tmp)
        # A real snapshot of an empty event is still a few hundred bytes
        # of table structure. Anything smaller did not survive the write.
        if written < 200:
            raise ValueError("snapshot came out at %d bytes" % written)
        os.replace(tmp, full)
    except Exception as e:
        logger.error("backup: could not write %s: %s", full, e)
        try:
            os.remove(tmp)
        except OSError:
            pass
        return None
    _write_fingerprint(fp)
    pruned = prune(path)
    where = "volume" if on_volume() else "EPHEMERAL container disk"
    msg = "backup %s: %d orders, %d customers -> %s (%s)%s" % (
        fp.get("event") or "production",
        fp["orders"],
        fp["customers"],
        name,
        where,
        ", pruned %d" % pruned if pruned else "",
    )
    logger.info(msg)
    return msg


def start(app):
    """Start the hourly loop. Safe to call more than once."""
    global _started
    with _lock:
        if _started:
            return
        _started = True

    if not on_volume():
        logger.warning(
            "Backups are being written to EPHEMERAL container storage and will "
            "be lost on the next deploy. Attach a Railway volume and they will "
            "be kept automatically - no code change needed."
        )

    def loop():
        # Let the app finish coming up before touching the database.
        time.sleep(30)
        while True:
            try:
                take_backup(app)
            except Exception as e:
                # Never let a backup failure escape into the app.
                logger.error("backup loop error (continuing): %s", e)
            time.sleep(INTERVAL_SECONDS)

    t = threading.Thread(target=loop, name="backup-scheduler", daemon=True)
    t.start()
    logger.info(
        "Backup scheduler started (every %ds, writing to %s)",
        INTERVAL_SECONDS,
        backup_dir(),
    )
