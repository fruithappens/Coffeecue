#!/usr/bin/env python3
"""Fail if two handlers are registered for the same method and address.

Roadmap X7-10. When two files register the same route, Flask quietly runs
one and the other never does. That is how the unguarded "login optional"
inventory reads slipped past the guarded ones (X7-4): a fix went into the
copy that never ran. 36 addresses had two or three handlers; all are now
down to one, and this check keeps it that way.

Placeholders count as the same address whatever their converter or name:
/inventory/<int:item_id> and /inventory/<item_id> clash. Flask sends
numeric ids to the int one and everything else to the string one, so the
string copy only runs for odd input and nobody notices it is broken (that
is how five dead /inventory/<item_id> handlers survived until 23 Nov 2026).

Builds the real app (needs a database: CI gives this job its own empty
Postgres) and reads its routing table, so it sees exactly what the server
serves, including blueprints registered conditionally.

    DATABASE_URL=postgresql://... python scripts/check_route_shadowing.py
"""
import collections
import inspect
import os
import re
import sys

os.environ.setdefault("TESTING_MODE", "True")
for k in ("TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER"):
    os.environ.setdefault(k, "")
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))


def where(app, endpoint):
    f = app.view_functions.get(endpoint)
    try:
        f = inspect.unwrap(f)
        return f"{os.path.relpath(inspect.getsourcefile(f))}:{inspect.getsourcelines(f)[1]}"
    except Exception:
        return "?"


# Clashes that were already there when placeholder shapes started counting
# (23 Nov 2026), all cleared 24 Nov 2026. If one ever has to be tolerated,
# add ("METHOD", "/shape/<>") here with a comment saying why. Anything not
# on this list fails.
KNOWN = set()


def shape(path):
    """The address with every placeholder blanked: <int:a>, <b>, <path:c> -> <>."""
    return re.sub(r"<[^>]+>", "<>", path)


def main():
    from app import create_app

    app, _ = create_app()
    pairs = collections.defaultdict(list)
    rules = {}
    for rule in app.url_map.iter_rules():
        for method in sorted((rule.methods or set()) - {"HEAD", "OPTIONS"}):
            pairs[(method, shape(rule.rule))].append(rule.endpoint)
            rules[(method, rule.endpoint)] = rule.rule
    dups = {k: v for k, v in pairs.items() if len(v) > 1}
    new = {k: v for k, v in dups.items() if k not in KNOWN}
    print(f"{len(pairs)} method+address pairs, {len(dups)} with more than one handler"
          f" ({len(dups) - len(new)} known, {len(new)} new)")
    gone = sorted(KNOWN - set(dups))
    for method, path in gone:
        print(f"  cleared, delete from KNOWN: {method} {path}")
    if not dups:
        return 0
    adapter = app.url_map.bind("localhost")
    for (method, path), endpoints in sorted(dups.items()):
        # Probe with a number and a word: converters split them differently.
        served = set()
        for probe in ("1", "x"):
            try:
                served.add(adapter.match(path.replace("<>", probe), method=method)[0])
            except Exception:
                pass
        print(f"\n{method} {path}")
        for e in endpoints:
            how = "SERVES" if served == {e} else "serves some ids" if e in served else "never runs"
            print(f"  {how}: {e} {rules[(method, e)]} ({where(app, e)})")
        if (method, path) in KNOWN:
            print("  (known, on the KNOWN list)")
    if not new:
        return 0
    print("\nOne handler per address. Remove the route line from the copy that never runs,"
          " or give the new one a different address.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
