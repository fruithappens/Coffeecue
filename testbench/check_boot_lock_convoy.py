#!/usr/bin/env python3
"""Can the server still boot while something holds a read lock?

This is the Railway shape, reproduced. On a deploy the new container
starts while the OLD one is still serving, so there is always a live
connection holding locks when the new instance runs its startup DDL.

The failure it looks for is not a crash. It is a lock convoy:

  1. Something holds ACCESS SHARE on `users` -- which an ordinary
     read-only request does, and holds across the idle gap until the
     next request rolls it back.
  2. The booting instance runs ALTER TABLE users ADD COLUMN IF NOT
     EXISTS ... . That takes ACCESS EXCLUSIVE *before* it checks
     whether the column exists, so a "no-op" migration still queues.
  3. Once an ACCESS EXCLUSIVE request is WAITING, Postgres queues every
     later lock request behind it -- including plain SELECTs. Login
     stops working across the whole system.

Nothing crashes, so nothing restarts. That is why it presents as
"it hangs and stays hung".

Runs against a THROWAWAY copy of the database (see --db), never the
real one: on unfixed code this test deliberately wedges the `users`
table, and doing that to a database a live server is using would take
that server down too.

Usage:
    createdb expresso_locktest
    /opt/homebrew/opt/postgresql@15/bin/pg_dump -d expresso --no-owner \
        --no-privileges -f /tmp/dump.sql && psql -d expresso_locktest -f /tmp/dump.sql
    python testbench/check_boot_lock_convoy.py

Exit 0 = the server booted and stayed usable. Exit 1 = convoy.
"""

import argparse
import os
import subprocess
import sys
import time
import urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, REPO)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default="expresso_locktest",
                    help="THROWAWAY database. Never point this at a real one.")
    ap.add_argument("--port", default="5097")
    ap.add_argument("--boot-timeout", type=int, default=75)
    ap.add_argument("--repo", default=REPO,
                    help="Checkout to boot. Lets one copy of this test "
                         "compare two branches without being copied around.")
    args = ap.parse_args()

    if args.db in ("expresso", "railway", "postgres"):
        print(f"refusing to run against '{args.db}' -- use a throwaway copy.")
        return 2

    import psycopg2

    dsn = f"dbname={args.db}"
    try:
        watcher = psycopg2.connect(dsn)
    except psycopg2.OperationalError as e:
        # The most likely cause by far is that the throwaway copy has
        # not been made yet. Say how to make it rather than dumping a
        # driver traceback.
        print(f"could not connect to '{args.db}': {str(e).strip()}\n")
        print("Make the throwaway copy first:")
        print(f"    createdb {args.db}")
        print(f"    pg_dump -d expresso --no-owner --no-privileges "
              f"| psql -q -d {args.db}")
        return 2
    watcher.autocommit = True

    # The name denylist above is not enough on its own -- it would wave
    # through 'expresso_prod' or a restored backup. On unfixed code this
    # test deliberately wedges `users`, so refuse any database something
    # else is already connected to, whatever it happens to be called.
    guard = watcher.cursor()
    guard.execute(
        "SELECT count(*) FROM pg_stat_activity "
        "WHERE datname = %s AND pid <> pg_backend_pid()", (args.db,))
    others = guard.fetchone()[0]
    if others:
        print(f"refusing: {others} other connection(s) are already using "
              f"'{args.db}'.")
        print("Something is live on that database. This test wedges the "
              "`users` table on unfixed code, which would take it down "
              "too. Use a database nobody else is on.")
        watcher.close()
        return 2

    # STEP 1 -- the holder. A plain SELECT and then nothing, which is
    # exactly the state a read-only request leaves its connection in
    # between requests.
    holder = psycopg2.connect(dsn)
    hc = holder.cursor()
    hc.execute("SELECT count(*) FROM users")
    hc.fetchone()
    print("holder: read `users`, now idle in transaction (ACCESS SHARE held)")
    print("        this is what a live old container looks like mid-deploy\n")

    # STEP 2 -- boot a second instance against the same database.
    env = dict(os.environ,
               PORT=args.port,
               TESTING_MODE="True",
               # The throwaway database is a copy of live data, so its
               # orders carry REAL phone numbers. TESTING_MODE should
               # already stub Twilio; belt and braces, don't even start
               # the reminder loop that would try to text them.
               PICKUP_REMINDER_MINUTES="0",
               DATABASE_URL=f"postgres:///{args.db}")
    print(f"booting a server on :{args.port} against {args.db}")
    print(f"        from {args.repo}")
    t0 = time.time()
    proc = subprocess.Popen(
        [sys.executable, "-u", "run_server.py"],
        cwd=args.repo, env=env,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )

    verdict = 1
    try:
        booted = False
        while time.time() - t0 < args.boot_timeout:
            try:
                urllib.request.urlopen(
                    f"http://localhost:{args.port}/api/health", timeout=3)
                booted = True
                break
            except Exception:
                time.sleep(2)

        boot_secs = time.time() - t0
        cur = watcher.cursor()
        cur.execute(
            "SELECT count(*) FROM pg_locks WHERE NOT granted AND relation IS NOT NULL")
        waiting = cur.fetchone()[0]

        if not booted:
            print(f"\nFAIL: never answered in {args.boot_timeout}s "
                  f"({waiting} connection(s) stuck in a lock queue)")
            print("      The boot is wedged behind the holder's read lock.")
            return 1

        print(f"booted in {boot_secs:.1f}s ({waiting} waiting on locks)")

        # STEP 3 -- the part that actually matters. Health can answer
        # without touching `users`; login cannot. If the convoy formed,
        # this is where the system is dead for real people.
        print("\nasking it to read `users` (a login attempt)...")
        t1 = time.time()
        try:
            req = urllib.request.Request(
                f"http://localhost:{args.port}/api/auth/login",
                data=b'{"username":"zz-nobody","password":"zz"}',
                headers={"Content-Type": "application/json"}, method="POST")
            urllib.request.urlopen(req, timeout=20)
        except urllib.error.HTTPError:
            pass                      # 401 is a fine answer -- it ANSWERED
        except Exception:
            print(f"FAIL: login never answered ({time.time()-t1:.1f}s) "
                  f"-- `users` is locked. This is the convoy.")
            return 1
        print(f"answered in {time.time()-t1:.2f}s")

        print("\nPASS: booted alongside a lock holder and `users` stayed readable.")
        verdict = 0
        return verdict
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except Exception:
            proc.kill()
        holder.rollback()
        holder.close()
        watcher.close()


if __name__ == "__main__":
    sys.exit(main())
