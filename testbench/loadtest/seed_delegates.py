#!/usr/bin/env python3
"""Put N fake delegates into a THROWAWAY database for load testing.

A 400-person event is not 400 requests. Everyone who orders leaves the
/my page open on their phone, and that page polls every 8 seconds -- so
400 delegates is a sustained ~50 requests/second on one database-backed
endpoint, all day. That is the number worth knowing before the day, and
you cannot find it out with seven test rows.

Every seeded delegate is unmistakably fake:

  ea_contact_id   local:ZZLOAD-000001
  first_name      Loadtest
  mobile_e164     +61400000001

The +6140000 prefix is the bench range the SMS layer hard-blocks, so
even a mistake cannot text a real person. That is the LAST line of
defence, not the first -- the harness also refuses to run against a
database anything else is connected to, and the server it drives runs
with TESTING_MODE=True and PICKUP_REMINDER_MINUTES=0.
"""

import argparse
import sys

# 'local:' on purpose, not decoration.
#
# _find_attendee blanks any cid that is NOT 'local:'-prefixed unless the
# attendee-lookup setting is on -- a real safety gate that stops a stale
# EventsAir mirror greeting someone by the wrong name. Seeded WITHOUT the
# prefix, every single poll 404s, and the load test then reports a very
# convincing 6ms p50 for an endpoint that is doing no work at all.
#
# 'local:' ids are what /guest mints for someone who just gave their own
# name and number, which is also the normal path at an event that is not
# wired to EventsAir -- i.e. all of Steve's so far. So this is both the
# working id and the realistic one.
PREFIX = "local:ZZLOAD-"
BENCH_PHONE_BASE = 61400000000  # +6140000xxxx -- blocked from real sending
PROTECTED = {"expresso", "postgres", "railway", "template0", "template1"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", required=True, help="THROWAWAY database name")
    ap.add_argument("--count", type=int, default=400)
    ap.add_argument("--clean", action="store_true", help="remove seeded rows instead")
    args = ap.parse_args()

    if args.db in PROTECTED:
        print(
            f"REFUSED: '{args.db}' is protected. Use a throwaway copy "
            f"(see testbench/dbsnapshot.py)."
        )
        return 2

    import psycopg2

    conn = psycopg2.connect(f"dbname={args.db}")
    conn.autocommit = True
    cur = conn.cursor()

    if args.clean:
        cur.execute(
            "DELETE FROM ea_attendees WHERE ea_contact_id LIKE %s", (PREFIX + "%",)
        )
        print(f"removed {cur.rowcount} seeded delegate(s)")
        return 0

    rows = []
    for i in range(1, args.count + 1):
        rows.append(
            (
                f"{PREFIX}{i:06d}",
                "Loadtest",
                f"Delegate{i:04d}",
                f"+{BENCH_PHONE_BASE + i}",
                900000 + i,
            )
        )

    cur.executemany(
        """
        INSERT INTO ea_attendees
            (ea_contact_id, first_name, last_name, mobile_e164, internal_number)
        VALUES (%s, %s, %s, %s, %s)
        ON CONFLICT (ea_contact_id) DO NOTHING
        """,
        rows,
    )
    cur.execute(
        "SELECT count(*) FROM ea_attendees WHERE ea_contact_id LIKE %s", (PREFIX + "%",)
    )
    print(f"{cur.fetchone()[0]} loadtest delegates in {args.db}")
    print(
        f"phones {PREFIX}… run +{BENCH_PHONE_BASE+1} upward "
        f"(the blocked bench range)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
