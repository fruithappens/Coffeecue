#!/usr/bin/env python3
"""Fail if two handlers are registered for the same method and address.

Roadmap X7-10. When two files register the same route, Flask quietly runs
one and the other never does. That is how the unguarded "login optional"
inventory reads slipped past the guarded ones (X7-4): a fix went into the
copy that never ran. 36 addresses had two or three handlers; all are now
down to one, and this check keeps it that way.

Builds the real app (needs a database: CI gives this job its own empty
Postgres) and reads its routing table, so it sees exactly what the server
serves, including blueprints registered conditionally.

    DATABASE_URL=postgresql://... python scripts/check_route_shadowing.py
"""
import collections
import inspect
import os
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


def main():
    from app import create_app

    app, _ = create_app()
    pairs = collections.defaultdict(list)
    for rule in app.url_map.iter_rules():
        for method in sorted((rule.methods or set()) - {"HEAD", "OPTIONS"}):
            pairs[(method, rule.rule)].append(rule.endpoint)
    dups = {k: v for k, v in pairs.items() if len(v) > 1}
    print(f"{len(pairs)} method+address pairs, {len(dups)} with more than one handler")
    if not dups:
        return 0
    adapter = app.url_map.bind("localhost")
    for (method, path), endpoints in sorted(dups.items()):
        import re

        try:
            served, _ = adapter.match(re.sub(r"<[^>]+>", "X1", path), method=method)
        except Exception:
            served = "?"
        print(f"\n{method} {path}")
        for e in endpoints:
            print(f"  {'SERVES' if e == served else 'never runs'}: {e} ({where(app, e)})")
    print("\nOne handler per address. Remove the route line from the copy that never runs,"
          " or give the new one a different address.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
