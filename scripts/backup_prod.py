#!/usr/bin/env python3
"""Back up cupq.app's database to this Mac (roadmap S1-6, S1-13, S1-14).

    python3 backup_prod.py nightly     full dump, keep 14            (launchd, 3:00)
    python3 backup_prod.py hourly      dump only if anything changed, keep 48 (launchd, hourly)
    python3 backup_prod.py status      newest dumps and the last log lines
    python3 scripts/backup_prod.py install   copy to ~/cupq-backup and point both jobs at it

Each run: read the database address from Railway (token from ~/.zshrc,
never printed), pg_dump with up to 3 tries, then CHECK the file by listing
what's inside it (a dump that lists no table data is a failure). After a
good one it checks in with cupq.app (/api/public/backup-heartbeat), which
texts the admin number and whoever is on call if a day passes without one.
A failure also shows a notification on this Mac.

Why it changed (15 Oct 2026): the old hourly job logged in to the app with
the admin password and had failed every hour since that password changed
on 12 Oct; the old nightly script's "check" only checked pg_dump existed,
and that night's failure told nobody. This reads the database directly:
no app password, no failed logins.

Python 3.9 standard library only (macOS's own python3), so it doesn't
depend on any project folder or virtualenv.
"""
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

HOME = Path.home()
BACKUP_DIR = HOME / "expresso" / "backups"
HOURLY_DIR = BACKUP_DIR / "hourly"
LOG = BACKUP_DIR / "backup.log"
STATE = BACKUP_DIR / ".backup_state.json"
ENV_FILE = HOME / ".cupq_backup.env"         # BACKUP_HEARTBEAT_TOKEN=... (chmod 600)
INSTALL_DIR = HOME / "cupq-backup"
PG = Path("/opt/homebrew/opt/postgresql@16/bin")  # v16 client, matching cupq.app's server
KEEP = {"nightly": 14, "hourly": 48}
# Seconds to wait before each try. Five tries over ~25 minutes: after Railway's
# 21 Oct 2026 incident its public database connection got slow and dropped
# mid-dump (a dump took 5 min instead of 1), and three quick tries failed most
# nights.
TRIES = (0, 60, 180, 420, 900)
# Ask Postgres' client to keep an idle connection alive and to notice a dead
# one, so a stalled proxy fails fast and the next try starts.
KEEPALIVE = "keepalives=1&keepalives_idle=30&keepalives_interval=10&keepalives_count=6&connect_timeout=30"
HEARTBEAT_URL = "https://cupq.app/api/public/backup-heartbeat"

# cupq.app's Postgres service (Railway project "Coffee Cue")
LIVE_PROJECT = "1b1cd06b-5e5c-4f0a-a995-17ba21d9096a"
LIVE_ENV = "a5fe4ee3-a319-45c9-a75b-e3efec261a2f"
LIVE_POSTGRES = "3f6a7475-d383-4524-90c9-9ca815835237"
LIVE_WEB = "bfffe2df-3c0a-4ffd-be65-9d717847737a"
RAILWAY_API = "https://backboard.railway.com/graphql/v2"

# What changing means for the hourly run: every insert, update and delete
# Postgres has counted. The heartbeat itself writes one settings row, so the
# fingerprint is taken AFTER it, and only real changes trigger a dump.
FINGERPRINT_SQL = ("SELECT COALESCE(SUM(n_tup_ins + n_tup_upd + n_tup_del), 0) "
                   "FROM pg_stat_user_tables")


def log(msg):
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    with open(LOG, "a") as f:
        f.write(f"{datetime.now():%Y-%m-%d %H:%M:%S}  {msg}\n")


def notify(msg):
    """A notification on this Mac (best effort)."""
    try:
        subprocess.run(["osascript", "-e", f'display notification "{msg}" with title "CupQ backup"'],
                       timeout=10, capture_output=True)
    except Exception:
        pass


def profile_value(name):
    """A value saved in ~/.zshrc (export NAME='...'). Read, never printed."""
    if os.environ.get(name):
        return os.environ[name]
    try:
        for line in open(HOME / ".zshrc"):
            line = line.strip()
            if line.startswith(f"export {name}="):
                return line.split("=", 1)[1].strip().strip("'\"")
    except OSError:
        pass
    return None


def env_value(name):
    try:
        for line in open(ENV_FILE):
            if line.strip().startswith(f"{name}="):
                return line.split("=", 1)[1].strip().strip("'\"")
    except OSError:
        pass
    return None


def railway(query, variables):
    token = profile_value("RAILWAY_API_TOKEN")
    if not token:
        raise RuntimeError("RAILWAY_API_TOKEN not in ~/.zshrc")
    req = urllib.request.Request(RAILWAY_API, data=json.dumps({"query": query, "variables": variables}).encode(),
                                 headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json",
                                          "User-Agent": "cupq-backup/2"})
    with urllib.request.urlopen(req, timeout=60) as r:
        out = json.loads(r.read())
    if out.get("errors"):
        raise RuntimeError("Railway: " + "; ".join(e.get("message", "?") for e in out["errors"]))
    return out["data"]


def database_url():
    v = railway("query($p: String!, $e: String!, $s: String!) { variables(projectId: $p, environmentId: $e, serviceId: $s) }",
                {"p": LIVE_PROJECT, "e": LIVE_ENV, "s": LIVE_POSTGRES})["variables"]
    url = v.get("DATABASE_PUBLIC_URL")
    if not url:
        raise RuntimeError("cupq.app's Postgres has no DATABASE_PUBLIC_URL")
    return url


def fingerprint(url):
    r = subprocess.run([str(PG / "psql"), url, "-tAc", FINGERPRINT_SQL], capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        raise RuntimeError("fingerprint query failed: " + r.stderr.strip()[:160])
    return r.stdout.strip()


def verify(path):
    """Count the tables whose data the dump holds; a dump without them is no backup."""
    r = subprocess.run([str(PG / "pg_restore"), "--list", str(path)], capture_output=True, text=True, timeout=120)
    if r.returncode != 0:
        return 0
    return sum(1 for line in r.stdout.splitlines() if " TABLE DATA " in line)


def _with_keepalive(url):
    return url + ("&" if "?" in url else "?") + KEEPALIVE


def _first_error(stderr):
    """The line that says what went wrong. pg_dump's LAST line is usually a
    'detail: Query was: ...' echo, which hid the cause in the log."""
    lines = [ln.strip() for ln in (stderr or "").splitlines() if ln.strip()]
    for ln in lines:
        if "error" in ln.lower() or "could not" in ln.lower() or "server closed" in ln.lower():
            return ln
    return lines[0] if lines else "dump held no table data"


def dump(url, out):
    url = _with_keepalive(url)
    last_err = ""
    for i, wait in enumerate(TRIES, 1):
        if wait:
            time.sleep(wait)
        r = subprocess.run([str(PG / "pg_dump"), url, "-Fc", "-f", str(out)],
                           capture_output=True, text=True, timeout=3600)
        tables = verify(out) if r.returncode == 0 and out.exists() else 0
        if tables >= 10:
            return tables
        last_err = _first_error(r.stderr)[:200]
        log(f"RETRY try {i} failed: {last_err}")
        out.unlink(missing_ok=True)
    raise RuntimeError(last_err or "pg_dump failed")


MAX_AGE_DAYS = 14  # the privacy notice (cupq.app/privacy) promises about two weeks


def prune(folder, prefix, keep):
    """Keep the newest `keep`, and nothing older than MAX_AGE_DAYS: a Mac that
    slept through some nights used to leave dumps three weeks old."""
    files = sorted(folder.glob(f"{prefix}*.dump"), key=lambda p: p.stat().st_mtime, reverse=True)
    cutoff = time.time() - MAX_AGE_DAYS * 86400
    gone = [f for i, f in enumerate(files) if i >= keep or (i > 0 and f.stat().st_mtime < cutoff)]
    for old in gone:
        old.unlink()
    return len(gone)


def heartbeat(kind, size):
    token = env_value("BACKUP_HEARTBEAT_TOKEN")
    if not token:
        log("NOTE no BACKUP_HEARTBEAT_TOKEN in ~/.cupq_backup.env: cupq.app won't know this backup happened")
        return
    req = urllib.request.Request(HEARTBEAT_URL, data=json.dumps({"kind": kind, "bytes": size}).encode(),
                                 headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json",
                                          "User-Agent": "cupq-backup/2"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            log(f"OK   checked in with cupq.app ({r.status})")
    except (urllib.error.URLError, OSError) as e:
        log(f"WARN check-in with cupq.app failed: {e}")


def load_state():
    try:
        return json.loads(STATE.read_text())
    except (OSError, ValueError):
        return {}


def save_state(st):
    STATE.write_text(json.dumps(st))


def run(kind):
    folder = BACKUP_DIR if kind == "nightly" else HOURLY_DIR
    folder.mkdir(parents=True, exist_ok=True)
    st = load_state()
    try:
        url = database_url()
        if kind == "hourly":
            fp = fingerprint(url)
            if fp == st.get("fingerprint"):
                return 0  # nothing changed since the last good backup: no file, no log line
        out = folder / f"coffeecue_prod_{datetime.now():%Y-%m-%d_%H%M%S}.dump"
        log(f"START {kind} backup -> {out}")
        tables = dump(url, out)
        size = out.stat().st_size
        log(f"OK   {kind} dump verified: {tables} tables, {size / 1e6:.1f} MB")
        heartbeat(kind, size)
        time.sleep(2)  # let Postgres count the check-in before fingerprinting
        st.update(fingerprint=fingerprint(url), last_ok=datetime.now().isoformat(), last_kind=kind)
        save_state(st)
        removed = prune(folder, "coffeecue_prod_", KEEP[kind])
        if removed:
            log(f"PRUNE removed {removed} old {kind} dump(s), keeping newest {KEEP[kind]}")
        log("DONE")
        return 0
    except Exception as e:  # noqa: BLE001 - a backup job reports, never crashes silently
        log(f"FAIL {kind}: {e}")
        notify(f"The {kind} backup of cupq.app failed: {str(e)[:80]}")
        return 1


def status():
    for label, folder in (("nightly", BACKUP_DIR), ("hourly", HOURLY_DIR)):
        files = sorted(folder.glob("coffeecue_prod_*.dump"), key=lambda p: p.stat().st_mtime, reverse=True)
        print(f"{label}: {len(files)} kept" + (f", newest {files[0].name} ({files[0].stat().st_size / 1e6:.1f} MB)" if files else ""))
    print("last good:", load_state().get("last_ok", "never"))
    try:
        print("".join(open(LOG).readlines()[-6:]))
    except OSError:
        pass
    return 0


PLISTS = {
    "com.cupq.dbbackup": ("nightly", {"StartCalendarInterval": {"Hour": 3, "Minute": 0}}),
    "com.coffeecue.backup": ("hourly", {"StartInterval": 3600}),
}


def install():
    """Copy this script to ~/cupq-backup and point the two launchd jobs at it.
    Makes the heartbeat token once (kept in ~/.cupq_backup.env, chmod 600)."""
    import plistlib
    import secrets as _secrets

    INSTALL_DIR.mkdir(exist_ok=True)
    target = INSTALL_DIR / "backup_prod.py"
    shutil.copy2(__file__, target)
    if not env_value("BACKUP_HEARTBEAT_TOKEN"):
        old = os.umask(0o077)
        try:
            with open(ENV_FILE, "a") as f:
                f.write(f"BACKUP_HEARTBEAT_TOKEN={_secrets.token_urlsafe(32)}\n")
        finally:
            os.umask(old)
        print(f"made a heartbeat token in {ENV_FILE} (not shown)")
    agents = HOME / "Library" / "LaunchAgents"
    for label, (kind, when) in PLISTS.items():
        path = agents / f"{label}.plist"
        plist = {"Label": label, "ProgramArguments": ["/usr/bin/python3", str(target), kind],
                 "StandardOutPath": str(BACKUP_DIR / f"launchd.{kind}.out.log"),
                 "StandardErrorPath": str(BACKUP_DIR / f"launchd.{kind}.err.log"), **when}
        subprocess.run(["launchctl", "unload", str(path)], capture_output=True)
        with open(path, "wb") as f:
            plistlib.dump(plist, f)
        r = subprocess.run(["launchctl", "load", str(path)], capture_output=True, text=True)
        print(f"{label}: {kind} -> {target} ({'loaded' if r.returncode == 0 else r.stderr.strip()})")
    return 0


def main(argv):
    cmd = argv[1] if len(argv) > 1 else ""
    if cmd in ("nightly", "hourly"):
        return run(cmd)
    if cmd == "status":
        return status()
    if cmd == "install":
        return install()
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
