#!/usr/bin/env python3
"""Save, list and restore whole database snapshots.

Steve: "would be good to backup and save the database and download and
then load up the treenet version".

Two jobs, and the second is the one that matters:

  save     a real backup you can keep, copy off the machine, or hand to
           someone. Also the thing you take BEFORE an event so there is
           a known-good point to come back to.
  restore  put a snapshot into a THROWAWAY database so a load test can
           hammer a faithful copy of real data without touching the
           system anyone is using.

WHY THE GUARDS ARE STRICT. A restore drops and recreates the target, so
a mistyped name is not a typo, it is a deleted event. And a snapshot of
live data carries REAL customer phone numbers, which is why anything
that runs against a restored copy has to keep the SMS path shut.

pg_dump version: Homebrew leaves several around and pg_dump refuses to
read a NEWER server. This picks the one matching the running server
rather than whatever is first on PATH -- the mismatch is otherwise a
confusing "aborting because of server version mismatch" at the exact
moment you wanted a backup.
"""

import argparse
import glob
import gzip
import os
import re
import shutil
import subprocess
import sys
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
SNAPDIR = os.path.join(HERE, "snapshots")

# Never restore ON TOP of these, whatever the arguments say.
PROTECTED = {"expresso", "postgres", "template0", "template1", "railway"}


def _server_version(db):
    out = subprocess.run(
        ["psql", "-d", db, "-A", "-t", "-c", "SHOW server_version"],
        capture_output=True,
        text=True,
    )
    m = re.match(r"(\d+)", (out.stdout or "").strip())
    return m.group(1) if m else None


def _tool(name, db):
    """The pg_dump/psql matching the SERVER, not whatever is on PATH."""
    major = _server_version(db)
    if major:
        candidate = f"/opt/homebrew/opt/postgresql@{major}/bin/{name}"
        if os.path.exists(candidate):
            return candidate
    return shutil.which(name) or name


def _in_use_by_others(db):
    """Connections on `db` other than ours. Restoring under a live server
    is how you take that server down."""
    out = subprocess.run(
        [
            "psql",
            "-d",
            "postgres",
            "-A",
            "-t",
            "-c",
            "SELECT count(*) FROM pg_stat_activity WHERE datname = "
            f"'{db}' AND pid <> pg_backend_pid()",
        ],
        capture_output=True,
        text=True,
    )
    try:
        return int((out.stdout or "0").strip())
    except ValueError:
        return 0


def cmd_save(args):
    os.makedirs(SNAPDIR, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    label = re.sub(r"[^A-Za-z0-9_-]+", "-", args.label or args.db).strip("-")
    path = os.path.join(SNAPDIR, f"{label}-{stamp}.sql.gz")

    dump = _tool("pg_dump", args.db)
    print(f"dumping {args.db} using {dump}")
    proc = subprocess.Popen(
        [dump, "-d", args.db, "--no-owner", "--no-privileges"],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    with gzip.open(path, "wb") as fh:
        shutil.copyfileobj(proc.stdout, fh)
    _, err = proc.communicate()
    if proc.returncode != 0:
        os.path.exists(path) and os.remove(path)
        print(f"FAILED: {(err or b'').decode(errors='replace').strip()}")
        return 1

    size = os.path.getsize(path)
    print(f"saved   {path}")
    print(f"        {size/1024/1024:.1f} MB compressed")
    print()
    print("To copy it off this machine:")
    print(f"    cp {path} ~/Desktop/")
    return 0


def cmd_list(args):
    files = sorted(glob.glob(os.path.join(SNAPDIR, "*.sql.gz")), reverse=True)
    if not files:
        print("no snapshots yet — make one with:  dbsnapshot.py save")
        return 0
    print(f"{'snapshot':<44} {'size':>9}   taken")
    for f in files:
        st = os.stat(f)
        print(
            f"{os.path.basename(f):<44} {st.st_size/1024/1024:>7.1f} MB   "
            f"{datetime.fromtimestamp(st.st_mtime):%Y-%m-%d %H:%M}"
        )
    return 0


def cmd_restore(args):
    target = args.into
    if target in PROTECTED:
        print(
            f"REFUSED: '{target}' is protected. A restore DROPS the target "
            f"database.\n         Restore into a throwaway name instead, "
            f"e.g. --into expresso_loadtest"
        )
        return 2

    busy = _in_use_by_others(target)
    if busy:
        print(
            f"REFUSED: {busy} other connection(s) are on '{target}'. "
            f"Something is using it.\n         Stop it first, or pick "
            f"another name."
        )
        return 2

    src = args.snapshot
    if not os.path.isabs(src) and not os.path.exists(src):
        matches = sorted(
            glob.glob(os.path.join(SNAPDIR, f"*{src}*.sql.gz")), reverse=True
        )
        if not matches:
            print(f"no snapshot matching '{src}'. Try:  dbsnapshot.py list")
            return 1
        src = matches[0]
        print(f"matched {os.path.basename(src)}")

    psql = _tool("psql", "postgres")
    print(f"dropping and recreating {target}")
    subprocess.run(
        ["psql", "-d", "postgres", "-q", "-c", f'DROP DATABASE IF EXISTS "{target}"'],
        check=False,
    )
    made = subprocess.run(
        ["psql", "-d", "postgres", "-q", "-c", f'CREATE DATABASE "{target}"'],
        capture_output=True,
        text=True,
    )
    if made.returncode != 0:
        print(f"FAILED to create: {made.stderr.strip()}")
        return 1

    print(f"restoring {os.path.basename(src)} -> {target}")
    opener = gzip.open if src.endswith(".gz") else open
    with opener(src, "rb") as fh:
        proc = subprocess.Popen(
            [psql, "-d", target, "-q", "-v", "ON_ERROR_STOP=0"],
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )
        shutil.copyfileobj(fh, proc.stdin)
        proc.stdin.close()
        err = (proc.stderr.read() or b"").decode(errors="replace")
        proc.wait()

    errors = [ln for ln in err.splitlines() if "ERROR" in ln]
    counts = subprocess.run(
        [
            "psql",
            "-d",
            target,
            "-A",
            "-t",
            "-c",
            "SELECT (SELECT count(*) FROM information_schema.tables "
            "WHERE table_schema='public')",
        ],
        capture_output=True,
        text=True,
    )
    print()
    print(
        f"restored: {(counts.stdout or '?').strip()} tables, " f"{len(errors)} error(s)"
    )
    for ln in errors[:5]:
        print(f"   {ln[:100]}")
    print()
    print("REMEMBER: this copy holds REAL customer phone numbers.")
    print("Anything you point at it must keep the SMS path shut —")
    print("TESTING_MODE=True and PICKUP_REMINDER_MINUTES=0.")
    return 0


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    sub = ap.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("save", help="back up a database to testbench/snapshots/")
    s.add_argument("--db", default="expresso")
    s.add_argument("--label", default=None, help="name it, e.g. --label treenet-2026")
    s.set_defaults(func=cmd_save)

    ls = sub.add_parser("list", help="show saved snapshots")
    ls.set_defaults(func=cmd_list)

    r = sub.add_parser("restore", help="load a snapshot into a THROWAWAY database")
    r.add_argument("snapshot", help="file path, or part of a snapshot name")
    r.add_argument("--into", required=True, help="throwaway database name")
    r.set_defaults(func=cmd_restore)

    args = ap.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
