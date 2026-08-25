#!/usr/bin/env python3
"""Load test against the REAL deployment, over the real internet.

Steve: "not Railway's box and network - need to test there happy to do
some phone users and sms as well on planned 'attack' all at once if we
can".

WHY THIS EXISTS SEPARATELY FROM my_swarm.py
-------------------------------------------
my_swarm.py boots its own server against a throwaway database and reads
that database directly to check the aftermath. Neither is possible here:
Railway's database is not reachable from a laptop, and the whole point is
to measure the box and the network we actually run on. So this speaks
HTTP and nothing else -- it is a customer, not an operator.

It also measures the thing my_swarm cannot. A localhost p95 of 7ms says
nothing about a delegate on venue wifi in a basement function room. The
number that matters here is what THEY wait.

WHAT IT IS SAFE TO DO TO PRODUCTION
-----------------------------------
Four rules, each enforced rather than remembered:

1. Every simulated customer uses the +6140000 bench prefix. That is not
   an allocatable Australian mobile range, and services/messaging.py
   refuses to hand any number with that prefix to the SMS provider --
   in the sender, not at a call site. Production runs in LIVE SMS mode,
   so this is the rule that stops a load test costing money.

2. A backup is taken first, through the app's own endpoint, and the run
   ABORTS if it does not succeed. Never load-test something you cannot
   put back.

3. Every order is named with a run tag. NOTE: the API has no per-order
   delete, so this tool cannot tidy up after itself -- it counts what it
   left and tells you. Removal means wiping the event's orders, which
   takes a backup first. Do not run this against an event whose order
   history you want to keep.

4. Pointing at a non-localhost host requires --yes-this-is-production on
   the command line. There is no default that reaches production.

WHAT IT DELIBERATELY DOES NOT DO
--------------------------------
No real SMS to real people. If you want that -- and it is worth doing
once -- send a handful by hand from a phone you own while this is
running, and watch them arrive. A load test is the wrong instrument for
proving a carrier delivers.
"""

import argparse
import json
import os
import statistics
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime

BENCH_PREFIX = "+6140000"
POLL_SECONDS = 8.0  # what MyCoffeePage.js actually uses


def call(base, path, method="GET", body=None, token=None, timeout=30, ok_codes=()):
    """One HTTP call. Returns (elapsed_ms, payload_or_None, error_or_None).

    `ok_codes` are HTTP statuses that are a real answer rather than a
    failure. /api/ea/me replies 404 for a phone it does not recognise,
    which is what it should do and what most of a bench swarm will get;
    counting those as errors made the first smoke run report 100%
    failure against a server that was completely healthy.
    """
    url = base.rstrip("/") + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
        ms = (time.time() - t0) * 1000
        try:
            return ms, json.loads(raw), None
        except Exception:
            return ms, None, None
    except urllib.error.HTTPError as e:
        ms = (time.time() - t0) * 1000
        if e.code in ok_codes:
            try:
                return ms, json.loads(e.read()), None
            except Exception:
                return ms, None, None
        return ms, None, f"HTTP {e.code}"
    except Exception as e:
        return (time.time() - t0) * 1000, None, str(e)[:60]


class Track:
    """Latency for one kind of request, as the customer experiences it."""

    def __init__(self, name):
        self.name = name
        self.ms = []
        self.errors = 0
        self.lock = threading.Lock()

    def record(self, ms, err):
        with self.lock:
            if err:
                self.errors += 1
            else:
                self.ms.append(ms)

    def line(self):
        n = len(self.ms) + self.errors
        if not self.ms:
            return f"{self.name:24} {n:6} reqs  all failed"
        s = sorted(self.ms)
        p50 = s[len(s) // 2]
        p95 = s[int(len(s) * 0.95)] if len(s) > 1 else s[0]
        pct = (self.errors / n * 100) if n else 0
        return (
            f"{self.name:24} {n:6} reqs  p50 {p50:7.0f}ms  p95 {p95:7.0f}ms  "
            f"max {max(s):7.0f}ms  errors {self.errors:4} ({pct:.1f}%)"
        )


def take_backup(base, token):
    """The app's own backup, through its own endpoint. Returns True on
    a backup we can see afterwards -- not merely a 200."""
    before = count_backups(base, token)
    ms, body, err = call(base, "/api/event-data/backup", "POST", {}, token, timeout=120)
    if err:
        print(f"  backup call failed: {err}")
        return False
    after = count_backups(base, token)
    if after is None or before is None:
        print("  could not read the backup list to confirm it landed")
        return False
    if after <= before:
        print(f"  backup did not appear (was {before}, still {after})")
        return False
    print(f"  backup taken in {ms/1000:.1f}s — {before} -> {after} on the server")
    return True


def count_backups(base, token):
    _, body, err = call(base, "/api/event-data/backups", token=token)
    if err or not isinstance(body, dict):
        return None
    return body.get("count")


def order_count(base, token):
    """How many orders the server is holding.

    Uses /api/orders/statistics, which reports a real total.

    NOT /api/orders: that endpoint caps its response at 50 rows however
    large a `limit` you pass, so counting its length quietly measures the
    cap instead of the data. The first version of this did exactly that
    and reported "49 -> 50 (+1)" for a run that created five orders --
    caught only because the mismatch check below fired. The database
    actually held 54.
    """
    _, body, err = call(base, "/api/orders/statistics", token=token, timeout=60)
    if err or not isinstance(body, dict):
        return None
    stats = body.get("statistics")
    if isinstance(stats, dict) and isinstance(stats.get("total_orders"), int):
        return stats["total_orders"]
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", required=True, help="e.g. https://…up.railway.app")
    ap.add_argument("--user", default="coffeecue")
    ap.add_argument("--password", default=os.environ.get("SIEGE_PASSWORD", ""))
    ap.add_argument(
        "--delegates",
        type=int,
        default=100,
        help="phones holding /my open, polling every 8s",
    )
    ap.add_argument("--seconds", type=int, default=180)
    ap.add_argument(
        "--orders", type=int, default=40, help="orders placed DURING the poll storm"
    )
    ap.add_argument("--station", type=int, default=1)
    ap.add_argument("--yes-this-is-production", action="store_true", dest="confirmed")
    ap.add_argument(
        "--skip-backup",
        action="store_true",
        help="only for a deployment you are willing to lose",
    )
    ap.add_argument(
        "--count-leftovers",
        action="store_true",
        help="count a previous run's orders (with --tag) and stop; cannot delete",
    )
    ap.add_argument(
        "--tag", default=None, help="run tag (default: today's date + time)"
    )
    args = ap.parse_args()

    base = args.base.rstrip("/")
    local = "localhost" in base or "127.0.0.1" in base

    if not local and not args.confirmed:
        print("REFUSED. That is not localhost.")
        print()
        print("This drives a REAL deployment: it creates real orders in the")
        print("real database and puts real load on the box people order from.")
        print("Pass --yes-this-is-production when you actually mean it, and")
        print("pick a time when nobody is queuing.")
        return 2

    if not args.password:
        print("No password. Pass --password or set SIEGE_PASSWORD in the")
        print("environment (better — it keeps it out of your shell history).")
        return 2

    tag = args.tag or f"SIEGE-{datetime.now().strftime('%m%d-%H%M')}"
    print(f"target : {base}")
    print(f"tag    : {tag}")
    print()

    ms, body, err = call(
        base,
        "/api/auth/login",
        "POST",
        {"username": args.user, "password": args.password},
    )
    token = (body or {}).get("token")
    if err or not token:
        print(f"could not log in: {err or 'no token in response'}")
        return 1
    print(f"logged in ({ms:.0f}ms)")

    if args.count_leftovers:
        if not args.tag:
            print("--count-leftovers needs --tag")
            return 2
        n = leftovers(base, token, args.tag)
        print(f"{n} orders still carry the tag {args.tag}")
        return 0

    if not local and not args.skip_backup:
        print("taking a backup first...")
        if not take_backup(base, token):
            print()
            print("ABORTED: no backup, no siege.")
            return 1
    print()

    before = order_count(base, token)
    print(f"orders on the server before: {before if before is not None else 'unknown'}")
    print()
    print(f"{args.delegates} phones polling /my every {POLL_SECONDS:.0f}s")
    print(
        f"  = ~{args.delegates / POLL_SECONDS:.0f} requests/second, for {args.seconds}s"
    )
    print(f"{args.orders} orders placed during it, all on {BENCH_PREFIX}… numbers")
    print()

    tracks = {
        "menu": Track("menu (first load)"),
        "poll": Track("/my poll"),
        "order": Track("order placed"),
        "board": Track("display board"),
    }
    stop = threading.Event()
    created = []
    created_lock = threading.Lock()

    def poller(i):
        phone = f"{BENCH_PREFIX}{i:04d}"
        # Stagger, or 100 phones all poll on the same tick and the shape
        # is a drumbeat rather than the steady pressure a room produces.
        time.sleep((i % int(POLL_SECONDS)) + (i % 100) / 100.0)
        while not stop.is_set():
            ms, _, err = call(
                base,
                f"/api/ea/me?phone={urllib.parse.quote(phone)}",
                timeout=25,
                ok_codes=(404,),
            )
            tracks["poll"].record(ms, err)
            stop.wait(POLL_SECONDS)

    def orderer():
        gap = max(0.4, args.seconds / max(1, args.orders))
        for n in range(args.orders):
            if stop.is_set():
                break
            phone = f"{BENCH_PREFIX}{9000 + n:04d}"
            ms, body, err = call(
                base,
                "/api/orders",
                "POST",
                {
                    "customer_name": f"{tag}-{n:03d}",
                    "coffee_type": "Latte",
                    "milk_type": "Full Cream",
                    "size": "Regular",
                    "sugar": "No sugar",
                    "station_id": args.station,
                    "phone": phone,
                },
                token,
                timeout=40,
            )
            tracks["order"].record(ms, err)
            if not err and isinstance(body, dict):
                num = (body.get("data") or {}).get("order_number") or body.get(
                    "order_number"
                )
                if num:
                    with created_lock:
                        created.append(str(num))
            stop.wait(gap)

    def boarder():
        while not stop.is_set():
            ms, _, err = call(base, "/api/display/orders", timeout=25)
            tracks["board"].record(ms, err)
            stop.wait(5)

    ms, _, err = call(base, "/api/display/menu", timeout=30)
    tracks["menu"].record(ms, err)

    threads = [
        threading.Thread(target=poller, args=(i,), daemon=True)
        for i in range(args.delegates)
    ]
    threads.append(threading.Thread(target=orderer, daemon=True))
    threads.append(threading.Thread(target=boarder, daemon=True))
    for t in threads:
        t.start()

    t0 = time.time()
    try:
        while time.time() - t0 < args.seconds:
            time.sleep(5)
            el = int(time.time() - t0)
            p = tracks["poll"]
            s = sorted(p.ms)
            p95 = s[int(len(s) * 0.95)] if len(s) > 1 else 0
            print(
                f"  {el:5}s  {len(p.ms):6} polls  p95 {p95:6.0f}ms  "
                f"errors {p.errors}"
            )
    except KeyboardInterrupt:
        print("\ninterrupted — stopping and cleaning up")
    stop.set()
    for t in threads:
        t.join(timeout=15)

    print()
    print("=" * 78)
    for t in tracks.values():
        if t.ms or t.errors:
            print(t.line())
    print("=" * 78)
    print()

    after = order_count(base, token)
    print("Did it survive?")
    made = (after - before) if (before is not None and after is not None) else None
    print(
        f"  orders before / after : {before} / {after}"
        + (f"  (+{made})" if made is not None else "")
    )
    if made is not None and made != len(created):
        print(
            f"  MISMATCH: {len(created)} were accepted but the server shows "
            f"{made} more — orders were lost or something else was writing"
        )
    print(f"  orders this run made  : {len(created)}")
    ms, hb, err = call(base, "/api/health", timeout=30)
    print(f"  health after the storm: {'ok' if not err else err} ({ms:.0f}ms)")
    ms, _, err = call(
        base,
        "/api/auth/login",
        "POST",
        {"username": args.user, "password": args.password},
    )
    print(
        f"  login still answers   : {'yes' if not err else 'NO — ' + err} ({ms:.0f}ms)"
    )
    print()

    left = leftovers(base, token, tag)
    print("What this left behind")
    print(f"  {len(created)} orders created, named {tag}-000 onwards")
    if left is not None:
        print(f"  {left} of them still visible in the order list")
    print()
    print("  There is NO per-order delete in the API. To remove them, wipe the")
    print("  event's orders from Organiser > Settings > Event Data. That takes")
    print("  a fresh backup first and refuses if the backup fails (#370).")
    print("  Until then they will appear in the event report and the tallies.")
    return 0


def leftovers(base, token, tag):
    """Count what this run left behind. It does NOT delete.

    There is no per-order delete endpoint in the API -- the only removal
    path is the whole-event wipe. The first version of this file claimed
    to clean up and cheerfully reported "removed 0 of 8", which is the
    worst possible outcome: a tool that says it tidied up when it did
    not. So it counts, names the tag, and hands over the one command that
    actually removes them.
    """
    _, body, err = call(base, "/api/orders?limit=500", token=token, timeout=60)
    if err:
        print(f"  could not list orders: {err}")
        return None
    rows = []
    if isinstance(body, dict):
        rows = body.get("data") or body.get("orders") or []
    elif isinstance(body, list):
        rows = body
    return sum(
        1 for r in rows if tag and tag in str((r or {}).get("customer_name") or "")
    )


if __name__ == "__main__":
    sys.exit(main())
