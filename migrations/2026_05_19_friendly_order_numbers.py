"""
Migration: friendly order numbers.

Creates the `order_number_seq` Postgres sequence used by
`services/coffee_system.py::_confirm_order` to produce "#42" style
customer-facing order numbers. Without this migration the system falls
back to the legacy timestamp format ("A1402153"), so this is a soft
upgrade — safe to run any time, safe to defer.

Idempotent: re-running is a no-op.

Usage:
    python3 migrations/2026_05_19_friendly_order_numbers.py            # use DATABASE_URL
    python3 migrations/2026_05_19_friendly_order_numbers.py --start 1  # explicit starting value
    python3 migrations/2026_05_19_friendly_order_numbers.py --reset    # restart the sequence

`--reset` is intended for between-event use: a fresh event starts the
counter back at 1 so customers see "#1", "#2", "#3" rather than
"#318", "#319", "#320".
"""
import argparse
import os
import sys

# Make the project root importable so we can use the existing helpers.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import psycopg2  # noqa: E402


def get_db_url():
    url = os.getenv('DATABASE_URL', 'postgresql://localhost/expresso')
    return url


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--start', type=int, default=1,
                        help="Starting value for the sequence (default: 1).")
    parser.add_argument('--reset', action='store_true',
                        help="Reset an existing sequence back to --start. "
                             "Use this between events.")
    args = parser.parse_args()

    conn = psycopg2.connect(get_db_url())
    conn.autocommit = True
    cur = conn.cursor()

    cur.execute("""
        SELECT 1 FROM pg_class WHERE relkind = 'S' AND relname = 'order_number_seq'
    """)
    exists = cur.fetchone() is not None

    if exists and args.reset:
        cur.execute("ALTER SEQUENCE order_number_seq RESTART WITH %s", (args.start,))
        print(f"Reset order_number_seq to start at {args.start}.")
    elif exists:
        print("order_number_seq already exists. Use --reset to restart it for a new event.")
    else:
        cur.execute(f"CREATE SEQUENCE order_number_seq START {int(args.start)}")
        print(f"Created order_number_seq starting at {args.start}.")

    cur.close()
    conn.close()


if __name__ == '__main__':
    main()
