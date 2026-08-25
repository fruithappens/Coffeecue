#!/usr/bin/env python3
"""400 delegates with /my open on their phones. Can the system take it?

Steve: "have say 400 'people' logged into /my and some sms as well to
test if it can handle it and any other tests that check everything
survives".

WHAT THIS ACTUALLY SIMULATES. /my is not a page people open once. They
order, then leave it open to watch for "ready", and it polls
/api/ea/me every 8 seconds the whole time. So the load a 400-person
event puts on the system is not 400 requests -- it is 400 phones
holding a connection open and asking again, forever:

    400 delegates / 8s  ~=  50 requests/second, sustained, all morning

That is the number to know BEFORE the day, and it is a completely
different shape from the order burst the existing load_test.py covers.
Orders are spiky and brief; this is flat and endless, and it is the one
that quietly exhausts a connection pool.

WHAT IT CHECKS BESIDES SPEED. "Can it handle it" is not only latency.
After the storm it asks whether the system is still HEALTHY:

  * did every order survive, exactly once
  * is the database free of leaked transactions
  * is anything stuck in a lock queue
  * can it still read `users` (i.e. can anyone still log in)

A run that is fast and leaves the database wedged is a failure.

SAFETY. Never point this at production and never at a database anything
else is using -- it is throwaway-copy only, and the copy holds REAL
phone numbers from the dump. The server it drives gets TESTING_MODE=True
and PICKUP_REMINDER_MINUTES=0 so no notification path can fire, and the
seeded delegates use the +6140000 bench range the SMS layer blocks
outright. Three independent barriers, because one is how accidents
happen.
"""

import argparse
import json
import os
import statistics
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, REPO)

PREFIX = "local:ZZLOAD-"
PROTECTED_DB = {"expresso", "postgres", "railway", "template0", "template1"}
POLL_SECONDS = 8.0  # what MyCoffeePage.js actually uses


# ---------------------------------------------------------------- metrics
class Metric:
    def __init__(self, name):
        self.name = name
        self.ms = []
        self.errors = {}
        self.lock = threading.Lock()

    def record(self, ms, err=None):
        with self.lock:
            self.ms.append(ms)
            if err:
                self.errors[err] = self.errors.get(err, 0) + 1

    def pct(self, p):
        if not self.ms:
            return 0.0
        xs = sorted(self.ms)
        return xs[min(len(xs) - 1, int(round(p / 100.0 * (len(xs) - 1))))]

    def line(self):
        n = len(self.ms)
        bad = sum(self.errors.values())
        rate = (bad / n * 100) if n else 0
        return (
            f"{self.name:<22} {n:>6} reqs  "
            f"p50 {self.pct(50):>6.0f}ms  p95 {self.pct(95):>7.0f}ms  "
            f"max {max(self.ms) if self.ms else 0:>7.0f}ms  "
            f"errors {bad:>4} ({rate:.1f}%)"
        )


def call(base, path, method="GET", body=None, timeout=30, token=None):
    url = base + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    if data:
        req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            r.read()
            return (time.time() - t0) * 1000, None
    except urllib.error.HTTPError as e:
        e.read()
        return (time.time() - t0) * 1000, f"HTTP {e.code}"
    except Exception as e:
        return (time.time() - t0) * 1000, type(e).__name__


# ------------------------------------------------------------------ guard
def guard(db):
    """Refuse anything that could touch a system in use. Runs BEFORE we
    open a connection of our own -- the in-use check counts connections,
    so connecting first would make us the thing it complains about."""
    if db in PROTECTED_DB:
        print(f"REFUSED: '{db}' is protected. Restore a throwaway copy first:")
        print(f"    python testbench/dbsnapshot.py save --label pre-loadtest")
        print(
            f"    python testbench/dbsnapshot.py restore pre-loadtest "
            f"--into expresso_loadtest"
        )
        return False
    out = subprocess.run(
        [
            "psql",
            "-d",
            "postgres",
            "-A",
            "-t",
            "-c",
            f"SELECT count(*) FROM pg_stat_activity WHERE datname = '{db}' "
            f"AND pid <> pg_backend_pid()",
        ],
        capture_output=True,
        text=True,
    )
    try:
        busy = int((out.stdout or "0").strip())
    except ValueError:
        busy = 0
    if busy:
        print(f"REFUSED: {busy} other connection(s) are already on '{db}'.")
        print("         Something is using it — a load test would hit them too.")
        return False
    return True


# ----------------------------------------------------------------- checks
def survival_checks(db, base):
    """Fast is not the same as survived."""
    import psycopg2

    conn = psycopg2.connect(f"dbname={db}")
    conn.autocommit = True
    cur = conn.cursor()
    problems = []

    cur.execute(
        "SELECT count(*) FROM pg_stat_activity WHERE datname = %s "
        "AND state LIKE 'idle in transaction%%' "
        "AND age(clock_timestamp(), state_change) > interval '10 seconds'",
        (db,),
    )
    leaked = cur.fetchone()[0]
    print(
        f"  leaked transactions      : {leaked}"
        f"{'  <-- locks held with nobody using them' if leaked else ''}"
    )
    if leaked:
        problems.append(f"{leaked} leaked transaction(s)")

    cur.execute("SELECT count(*) FROM pg_locks WHERE NOT granted")
    stuck = cur.fetchone()[0]
    print(f"  stuck in a lock queue    : {stuck}")
    if stuck:
        problems.append(f"{stuck} connection(s) waiting on locks")

    cur.execute("SELECT count(*) FROM pg_stat_activity WHERE datname = %s", (db,))
    print(f"  open connections         : {cur.fetchone()[0]}")

    # Can anyone still log in? This reads `users`, which is the table the
    # boot-lock convoy strands. Health alone answers without touching it,
    # so health being green proves nothing here.
    ms, err = call(
        base,
        "/api/auth/login",
        "POST",
        {"username": "zz-nobody", "password": "zz"},
        timeout=20,
    )
    ok = err in (None, "HTTP 401")
    print(f"  login still answers      : {'yes' if ok else 'NO'} ({ms:.0f}ms)")
    if not ok:
        problems.append(f"login stopped answering ({err})")

    conn.close()
    return problems


# ------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default="expresso_loadtest")
    ap.add_argument("--delegates", type=int, default=400)
    ap.add_argument("--seconds", type=int, default=60)
    ap.add_argument("--port", default="5095")
    ap.add_argument(
        "--repo", default=REPO, help="checkout to boot (lets you compare branches)"
    )
    ap.add_argument(
        "--base",
        default=None,
        help="drive an ALREADY-RUNNING server instead of booting one",
    )
    ap.add_argument(
        "--orders",
        type=int,
        default=40,
        help="kiosk orders placed DURING the poll storm",
    )
    ap.add_argument(
        "--sms",
        type=int,
        default=15,
        help="SMS conversations run through the real pipeline "
        "(no Twilio, TESTING_MODE, blocked bench numbers)",
    )
    args = ap.parse_args()

    if args.base and "railway.app" in args.base:
        print("REFUSED: that is production. This test is for a throwaway copy.")
        return 2

    proc = None
    base = args.base
    if not base:
        if not guard(args.db):
            return 2
        env = dict(
            os.environ,
            PORT=args.port,
            TESTING_MODE="True",
            PICKUP_REMINDER_MINUTES="0",  # the copy holds real numbers
            DATABASE_URL=f"postgres:///{args.db}",
        )
        print(f"booting a server on :{args.port} against {args.db}")
        print(f"        from {args.repo}")
        proc = subprocess.Popen(
            [sys.executable, "-u", "run_server.py"],
            cwd=args.repo,
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        base = f"http://localhost:{args.port}"
        deadline = time.time() + 90
        while time.time() < deadline:
            _, err = call(base, "/api/health", timeout=3)
            if not err:
                break
            time.sleep(2)
        else:
            print("the server never came up — nothing to load test")
            proc.terminate()
            return 1
        print("up\n")

    try:
        import psycopg2

        conn = psycopg2.connect(f"dbname={args.db}")
        cur = conn.cursor()
        cur.execute(
            "SELECT ea_contact_id FROM ea_attendees "
            "WHERE ea_contact_id LIKE %s ORDER BY ea_contact_id LIMIT %s",
            (PREFIX + "%", args.delegates),
        )
        cids = [r[0] for r in cur.fetchall()]
        cur.execute("SELECT count(*) FROM orders")
        orders_before = cur.fetchone()[0]
        conn.close()

        if len(cids) < args.delegates:
            print(f"only {len(cids)} seeded delegates — seed more first:")
            print(
                f"    python testbench/loadtest/seed_delegates.py "
                f"--db {args.db} --count {args.delegates}"
            )
            return 1

        rps = args.delegates / POLL_SECONDS
        print(
            f"{len(cids)} delegates with /my open, polling every "
            f"{POLL_SECONDS:.0f}s"
        )
        print(
            f"that is ~{rps:.0f} requests/second sustained, for " f"{args.seconds}s\n"
        )

        m_me = Metric("/my poll (ea/me)")
        m_menu = Metric("menu (first load)")
        m_order = Metric("kiosk order")
        m_sms = Metric("SMS conversation")
        stop = threading.Event()
        placed = []
        placed_lock = threading.Lock()

        # Admin session for the SMS harness. Not fatal if it fails --
        # the poll storm is still worth measuring without it, and saying
        # so is better than a run that silently drops a third of the load
        # it claims to apply.
        admin_token = None
        if args.sms:
            _, err = call(base, "/api/health")
            try:
                req = urllib.request.Request(
                    base + "/api/auth/login",
                    data=json.dumps(
                        {"username": "coffeecue", "password": "adminpassword"}
                    ).encode(),
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                with urllib.request.urlopen(req, timeout=20) as r:
                    admin_token = (json.loads(r.read()) or {}).get("token")
            except Exception as e:
                print(f"  (no admin login -- skipping the SMS load: {e})")

        def delegate(cid, slot):
            # Spread the phones across the poll window instead of firing
            # them in lockstep. Real delegates arrive over a session
            # break, and a synchronised thundering herd measures
            # something that never happens.
            time.sleep((slot / max(1, len(cids))) * POLL_SECONDS)
            ms, err = call(base, "/api/display/menu")
            m_menu.record(ms, err)
            while not stop.is_set():
                ms, err = call(base, f"/api/ea/me?cid={cid}")
                m_me.record(ms, err)
                if stop.wait(POLL_SECONDS):
                    break

        def orderer(i):
            """Walk-ups arriving during the storm. Phoneless on purpose --
            an order with no number cannot notify anyone, which is one
            more reason a mistake here stays inside the machine."""
            time.sleep((i / max(1, args.orders)) * min(args.seconds, 30))
            if stop.is_set():
                return
            ms, err = call(
                base,
                "/api/display/order",
                "POST",
                {
                    "name": f"ZZLoad{i:04d}",
                    "coffee_type": "Flat White",
                    "milk_type": "Full Cream",
                    "size": "Regular",
                    "sugar": "No sugar",
                },
                timeout=30,
            )
            m_order.record(ms, err)
            if not err:
                with placed_lock:
                    placed.append(i)

        def texter(i):
            """A real inbound SMS through the real handler -- no Twilio,
            no credits, and from the +6140000 range the SMS layer blocks
            outright."""
            time.sleep((i / max(1, args.sms)) * min(args.seconds, 30))
            if stop.is_set() or not admin_token:
                return
            phone = f"+6140000{7000 + i:04d}"
            ms, err = call(
                base,
                "/api/sms/simulate",
                "POST",
                {"from": phone, "body": "Flat white"},
                timeout=30,
                token=admin_token,
            )
            m_sms.record(ms, err)

        threads = [
            threading.Thread(target=delegate, args=(c, i), daemon=True)
            for i, c in enumerate(cids)
        ]
        threads += [
            threading.Thread(target=orderer, args=(i,), daemon=True)
            for i in range(args.orders)
        ]
        if admin_token:
            threads += [
                threading.Thread(target=texter, args=(i,), daemon=True)
                for i in range(args.sms)
            ]
        t0 = time.time()
        for t in threads:
            t.start()

        while time.time() - t0 < args.seconds:
            time.sleep(5)
            done = len(m_me.ms)
            print(
                f"  {time.time()-t0:>5.0f}s  {done:>6} polls  "
                f"p95 {m_me.pct(95):>6.0f}ms  "
                f"errors {sum(m_me.errors.values())}"
            )
        stop.set()
        for t in threads:
            t.join(timeout=15)

        print()
        print("=" * 78)
        print(m_menu.line())
        print(m_me.line())
        if m_order.ms:
            print(m_order.line())
        if m_sms.ms:
            print(m_sms.line())
        for name, metric in (
            ("poll", m_me),
            ("menu", m_menu),
            ("order", m_order),
            ("sms", m_sms),
        ):
            if metric.errors:
                print(f"    {name} errors: {metric.errors}")
        print("=" * 78)

        print("\nDid everything survive?")
        conn = psycopg2.connect(f"dbname={args.db}")
        cur = conn.cursor()
        cur.execute("SELECT count(*) FROM orders")
        orders_after = cur.fetchone()[0]
        conn.close()
        gained = orders_after - orders_before
        expected = len(placed)
        print(
            f"  orders before / after    : {orders_before} / {orders_after} "
            f"(+{gained})"
        )
        print(
            f"  accepted / actually saved: {expected} / {gained}"
            f"{'  <-- MISMATCH' if gained < expected else ''}"
        )
        # An order the system said yes to and then lost is the worst
        # outcome here: the customer is waiting and no barista can see it.
        if gained < expected:
            problems_extra = [
                f"{expected - gained} accepted order(s) never " f"reached the database"
            ]
        else:
            problems_extra = []
        problems = survival_checks(args.db, base) + problems_extra

        print()
        if problems:
            print("FAIL: " + "; ".join(problems))
            return 1
        err_rate = (sum(m_me.errors.values()) / max(1, len(m_me.ms))) * 100
        if err_rate > 1.0:
            print(f"FAIL: {err_rate:.1f}% of polls failed")
            return 1
        print(
            f"PASS: {len(cids)} delegates for {args.seconds}s, "
            f"p95 {m_me.pct(95):.0f}ms, {err_rate:.2f}% errors, "
            f"database clean afterwards."
        )
        return 0
    finally:
        if proc:
            proc.terminate()
            try:
                proc.wait(timeout=10)
            except Exception:
                proc.kill()


if __name__ == "__main__":
    sys.exit(main())
