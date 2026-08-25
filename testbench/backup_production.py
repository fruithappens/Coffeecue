#!/usr/bin/env python3
"""Take a backup of PRODUCTION, on a schedule, without piling up junk.

Steve's in-app backup system does not run -- production reports that the
data_backups table does not exist -- so until today the only backups
were the ones taken by hand.

HOW OFTEN, and why it is not a fixed interval:

Run this HOURLY, but it only WRITES when something has changed. Those
two things together give the right answer in both situations, which no
single fixed interval does:

  * Between events almost nothing changes, so an hourly run writes maybe
    one file a day and the folder stays readable.
  * On an event morning the data changes constantly, so it writes every
    hour -- and an hour is the right granularity there. Losing an hour of
    orders is an annoyance you can reconstruct from the cups on the
    bench. Losing a day is not.

Change is measured on the DATA, not the clock: order count, customer
count, and the newest order timestamp. A snapshot that would be
byte-identical in the ways that matter is skipped.

RETENTION, tiered, because the value of a backup decays but never
reaches zero:
  * everything from the last 7 days
  * one per day for 8 weeks
  * one per week beyond that
So an event you ran in March is still recoverable, without keeping 800
copies of a quiet Tuesday.

CREDENTIALS are never stored in this repository. Set them in the
environment, or put them in ~/.coffeecue_backup.env as
    COFFEECUE_URL=https://...
    COFFEECUE_USER=...
    COFFEECUE_PASS=...
"""

import argparse
import glob
import gzip
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
SNAPDIR = os.path.join(HERE, "snapshots")
ENV_FILE = os.path.expanduser("~/.coffeecue_backup.env")
DEFAULT_URL = "https://web-production-4cc9c.up.railway.app"


def _load_env():
    """Environment first, then the dotfile. Never the repo."""
    cfg = {
        "url": os.environ.get("COFFEECUE_URL"),
        "user": os.environ.get("COFFEECUE_USER"),
        "password": os.environ.get("COFFEECUE_PASS"),
    }
    if os.path.exists(ENV_FILE):
        try:
            for line in open(ENV_FILE):
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                k, v = k.strip().upper(), v.strip().strip('"').strip("'")
                if k == "COFFEECUE_URL" and not cfg["url"]:
                    cfg["url"] = v
                elif k == "COFFEECUE_USER" and not cfg["user"]:
                    cfg["user"] = v
                elif k == "COFFEECUE_PASS" and not cfg["password"]:
                    cfg["password"] = v
        except Exception as e:
            print(f"could not read {ENV_FILE}: {e}")
    cfg["url"] = (cfg["url"] or DEFAULT_URL).rstrip("/")
    return cfg


def _post(url, body, timeout=60):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST")
    req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read() or b"{}")


def fetch_snapshot(cfg, timeout=300):
    token = _post(
        f"{cfg['url']}/api/auth/login",
        {"username": cfg["user"], "password": cfg["password"]},
    ).get("token")
    if not token:
        raise RuntimeError("login did not return a token")
    req = urllib.request.Request(f"{cfg['url']}/api/event-data/export")
    req.add_header("Authorization", "Bearer " + token)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read()
    blob = json.loads(raw)
    return blob.get("snapshot") or blob, raw


def fingerprint(snapshot):
    """What 'changed' means. Deliberately about the DATA, not the clock.

    exported_at moves every run, so hashing the whole payload would make
    every snapshot look different and defeat the point.
    """
    tables = snapshot.get("tables") or {}
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
        "newest_order": newest,
        "event": snapshot.get("event_name"),
    }


def last_fingerprint():
    path = os.path.join(SNAPDIR, ".last_fingerprint.json")
    try:
        return json.load(open(path))
    except Exception:
        return None


def save_fingerprint(fp):
    os.makedirs(SNAPDIR, exist_ok=True)
    with open(os.path.join(SNAPDIR, ".last_fingerprint.json"), "w") as fh:
        json.dump(fp, fh)


def prune(keep_all_days=7, keep_daily_weeks=8):
    """Tiered thinning. Never touches anything a human named."""
    files = sorted(glob.glob(os.path.join(SNAPDIR, "auto-*.json.gz")))
    now = datetime.now()
    seen_days, seen_weeks, removed = set(), set(), []
    for path in sorted(files, reverse=True):  # newest first
        try:
            stamp = datetime.fromtimestamp(os.path.getmtime(path))
        except OSError:
            continue
        age = now - stamp
        if age <= timedelta(days=keep_all_days):
            continue
        if age <= timedelta(weeks=keep_daily_weeks):
            key = stamp.strftime("%Y-%m-%d")
            if key in seen_days:
                removed.append(path)
            seen_days.add(key)
            continue
        key = stamp.strftime("%Y-W%W")
        if key in seen_weeks:
            removed.append(path)
        seen_weeks.add(key)
    for path in removed:
        try:
            os.remove(path)
        except OSError:
            pass
    return len(removed)


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument(
        "--force", action="store_true", help="write a snapshot even if nothing changed"
    )
    ap.add_argument(
        "--quiet", action="store_true", help="only speak up on change or error"
    )
    args = ap.parse_args()

    cfg = _load_env()
    if not cfg["user"] or not cfg["password"]:
        print("No credentials. Set COFFEECUE_USER and COFFEECUE_PASS, or create")
        print(f"{ENV_FILE} with:")
        print("    COFFEECUE_URL=https://your-app.up.railway.app")
        print("    COFFEECUE_USER=...")
        print("    COFFEECUE_PASS=...")
        return 2

    try:
        snapshot, raw = fetch_snapshot(cfg)
    except Exception as e:
        # Loud on failure: a backup that quietly stopped working is worse
        # than no backup, because you believe you have one.
        print(f"BACKUP FAILED: {e}")
        return 1

    fp = fingerprint(snapshot)
    if not args.force and fp == last_fingerprint():
        if not args.quiet:
            print(f"no change since the last backup ({fp['orders']} orders) - skipped")
        return 0

    os.makedirs(SNAPDIR, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    path = os.path.join(SNAPDIR, f"auto-{stamp}.json.gz")
    with gzip.open(path, "wb") as fh:
        fh.write(raw)
    save_fingerprint(fp)
    pruned = prune()
    print(
        f"backed up {fp['event'] or 'production'}: {fp['orders']} orders, "
        f"{fp['customers']} customers -> {os.path.basename(path)} "
        f"({os.path.getsize(path)/1024:.0f} KB)"
        + (f", pruned {pruned} old" if pruned else "")
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
