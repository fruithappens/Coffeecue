#!/usr/bin/env python3
"""Does booting the app leave a transaction open?

WHY THIS EXISTS, AND WHY IT LOOKS WHERE IT DOES

psycopg2 is not autocommit, so a bare SELECT opens a transaction that
lives until someone commits or rolls back. Several startup checks read
and returned without doing either, on the connection that lives as long
as the process. The server then sat `idle in transaction` holding
ACCESS SHARE, and the next instance's ALTER TABLE queued behind it --
which in turn blocked every reader of that table. See
check_boot_lock_convoy.py for the full failure.

The obvious way to test this is to boot a server and grep
pg_stat_activity for an `idle in transaction` row. THAT DOES NOT WORK,
and the way it fails is worth knowing: it reports "fine" on code that
is definitely broken.

Two reasons:

  1. It is too late. Any check that waits for /api/health to answer has
     already caused a request, and the before_request hook rolls the
     connection back at the start of every request. The leak is real at
     BOOT -- exactly the window the startup DDL runs in -- and gone by
     the time a health check succeeds. The evidence clears itself.

  2. It is too specific. Grepping for one known query (the admin-count
     SELECT) recognises one spelling of the bug and passes for every
     other one. A leak from a different init path reads as a pass.

So this asks the connection directly, the moment create_app() returns
and before any request exists: psycopg2's get_transaction_status(). Any
table, any query, no server, no timing window. About two seconds.

Usage:
    python3 testbench/check_startup_transaction_leak.py
    python3 testbench/check_startup_transaction_leak.py --repo /path/to/other/checkout

Exit 0 = boot ended clean. Exit 1 = a transaction was left open.
"""

import argparse
import os
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Booted in the target checkout, so --repo can compare two branches.
# Prints one line: the transaction status name.
PROBE = r"""
import os, sys
sys.path.insert(0, os.getcwd())
import psycopg2.extensions as ext
from app import create_app
app, _ = create_app()
db = app.config['coffee_system'].db
names = {
    ext.TRANSACTION_STATUS_IDLE: 'IDLE',
    ext.TRANSACTION_STATUS_ACTIVE: 'ACTIVE',
    ext.TRANSACTION_STATUS_INTRANS: 'INTRANS',
    ext.TRANSACTION_STATUS_INERROR: 'INERROR',
    ext.TRANSACTION_STATUS_UNKNOWN: 'UNKNOWN',
}
sys.stderr.flush()
print('PROBE_RESULT=' + names.get(db.get_transaction_status(), '?'))
sys.stdout.flush()
os._exit(0)
"""

EXPLAIN = {
    'INTRANS': (
        "Boot left the connection IDLE IN TRANSACTION. Some init path "
        "read without committing. Left open, it holds ACCESS SHARE for "
        "the life of the process, and the next instance's ALTER TABLE "
        "queues behind it -- taking every reader of that table with it."
    ),
    'INERROR': (
        "Boot left the connection in an ABORTED transaction: a startup "
        "query failed and nothing rolled it back. Every later query on "
        "it fails with 'current transaction is aborted'."
    ),
    'ACTIVE': "Boot left a query still running on the connection.",
    'UNKNOWN': "The connection is in an unknown state -- likely broken.",
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default="expresso_locktest",
                    help="THROWAWAY database. Never point this at a real one.")
    ap.add_argument("--repo", default=REPO,
                    help="Checkout to boot. Lets one copy compare two branches.")
    args = ap.parse_args()

    # Same guard as check_boot_lock_convoy.py, for the same reason:
    # on unfixed code booting runs ALTER TABLE against whatever database
    # this points at, and a live server on it would be taken down too.
    if args.db in ("expresso", "railway", "postgres"):
        print(f"refusing to run against '{args.db}' -- use a throwaway copy.")
        return 2

    import psycopg2
    try:
        watcher = psycopg2.connect(f"dbname={args.db}")
    except psycopg2.OperationalError as e:
        print(f"could not connect to '{args.db}': {str(e).strip()}\n")
        print("Make the throwaway copy first:")
        print(f"    createdb {args.db}")
        print(f"    pg_dump -d expresso --no-owner --no-privileges "
              f"| psql -q -d {args.db}")
        return 2

    # A name denylist alone would wave through 'expresso_prod' or a
    # restored backup, so refuse anything already in use.
    cur = watcher.cursor()
    cur.execute("SELECT count(*) FROM pg_stat_activity "
                "WHERE datname = %s AND pid <> pg_backend_pid()", (args.db,))
    others = cur.fetchone()[0]
    watcher.close()
    if others:
        print(f"refusing: {others} other connection(s) are already using "
              f"'{args.db}'.")
        print("Booting against it runs schema changes. Use a database "
              "nobody else is on.")
        return 2

    print(f"booting {args.repo}\n     against {args.db}")
    env = dict(
        os.environ,
        TESTING_MODE="True",
        # The throwaway database is a copy of live data, so its orders
        # carry REAL phone numbers. Don't start the reminder loop that
        # would try to text them.
        PICKUP_REMINDER_MINUTES="0",
        DATABASE_URL=f"postgres:///{args.db}",
    )
    proc = subprocess.run(
        [sys.executable, "-c", PROBE],
        cwd=args.repo, env=env, capture_output=True, text=True, timeout=180,
    )

    status = None
    for line in proc.stdout.splitlines():
        if line.startswith("PROBE_RESULT="):
            status = line.split("=", 1)[1].strip()

    if status is None:
        print("\nCOULD NOT TELL: the app did not finish booting.")
        print((proc.stderr or "").strip()[-1500:])
        return 2

    if status == "IDLE":
        print("\nPASS: boot ended with no transaction open.")
        return 0

    print(f"\nFAIL: transaction status after create_app() is {status}.")
    print("      " + EXPLAIN.get(status, ""))
    return 1


if __name__ == "__main__":
    sys.exit(main())
