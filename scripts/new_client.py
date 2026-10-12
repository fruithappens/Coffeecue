#!/usr/bin/env python3
"""Plan a new client copy of CupQ -- DRY RUN ONLY (roadmap C3-2).

    python scripts/new_client.py demo
    python scripts/new_client.py virgin --event-file ~/cupq-demo-events/virgin-australia-lounge.cupq-event.json
    python scripts/new_client.py demo --json

Prints everything a client's own copy needs and what a real run would
create: the Railway project, web service and Postgres, its settings, the
subdomain, the text number, the first admin, the saved event. It CHANGES
NOTHING. The only things it touches are read-only: whether the Railway CLI
is logged in, which project names already exist, whether the subdomain
already resolves, and which tokens are present in this shell (presence
only -- values are never read or printed).

The real run is C3-3 (Cloudflare subdomain), C3-4 (Railway server and
database) and C3-5 (text number), each waiting on a token from Steve.

The settings list is built from the CODE (every os.getenv the backend
reads), sorted into what to generate, what to set per client, and what
must never be copied from production. Nothing is read from the live
server's settings.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import socket
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOMAIN = "cupq.app"
REPO = "fruithappens/Coffeecue"
SLUG_RE = re.compile(r"^[a-z][a-z0-9-]{1,28}[a-z0-9]$")
# Never a client's name: these are ours.
RESERVED = {"www", "api", "app", "admin", "staging", "next", "mail", "status", "cupq"}

# --- settings, by what a new copy does with them ----------------------------
GENERATE = {  # fresh random value per copy, never shared between clients
    "JWT_SECRET_KEY": "signs logins; a copy sharing it would accept another copy's logins",
    "SECRET_KEY": "Flask session secret",
    "PIN_PEPPER": "hashes unlock PINs",
    "CLOUDPRNT_SHARED_SECRET": "locks the printer endpoint to this client's printers",
}
PER_CLIENT = {  # value comes from the client / the plan
    "DATABASE_URL": "${{Postgres.DATABASE_URL}}  (Railway reference to this copy's own database)",
    "CORS_ALLOWED_ORIGINS": "https://{host}",
    "PUBLIC_BASE_URL": "https://{host}",
    "EVENT_NAME": "{event_name}",
    "TESTING_MODE": "False (texts really send)",
    "FLEET_STATUS_TOKEN": "the fleet's shared value, the SAME on every copy (lets System > Fleet read its numbers)",
    "ADMIN_ALERT_ENABLED": "true",
    "ADMIN_ALERT_PHONE": "the client's on-call mobile",
    "ADMIN_ALERT_EMAIL": "the client's on-call email",
}
FIRST_ADMIN = {  # ensure_admin_user.py makes the first admin at first boot
    "DEFAULT_ADMIN_USERNAME": "{slug}admin",
    "DEFAULT_ADMIN_EMAIL": "{slug}admin@cupq.app",
    "DEFAULT_ADMIN_PASSWORD": "leave UNSET: first boot picks a random one and prints it once in the deploy log",
}
SMS = {  # C3-5: a Twilio sub-account and number per client
    "TWILIO_ACCOUNT_SID": "the client's Twilio SUB-account (not ours)",
    "TWILIO_AUTH_TOKEN": "that sub-account's token",
    "TWILIO_PHONE_NUMBER": "the number bought for this client",
    "TWILIO_PHONE_NUMBER_SID": "that number's SID",
}
OPTIONAL_PREFIXES = {  # only if this client has the integration
    "EVENTSAIR_": "EventsAir (client's own tenant)",
    "EA_": "EventsAir (client's own tenant)",
    "SQUARE_": "Square payments",
    "STRIPE_": "Stripe payments",
    "CLICKSEND_": "ClickSend instead of Twilio",
    "CELLCAST_": "Cellcast instead of Twilio",
    "SMTP_": "email sending",
}
NEVER_COPY = {  # production's own; copying them leaks one client into another
    "DEMO_FORM_ORIGINS": "the cupq.com.au demo form posts to cupq.app only",
    "SHEET_WEBHOOK_URL": "Steve's sheet",
}
NEVER_COPY_PREFIXES = ("BENCH_", "SIEGE_", "SMS_SCEN_", "COFFEECUE_")  # test tools
RAILWAY_SETS = ("RAILWAY_", "PORT")  # Railway fills these in itself


def code_env_vars() -> list[str]:
    """Every environment variable the backend reads, from the code itself."""
    pat = re.compile(
        r"os\.(?:getenv|environ\.get)\(\s*['\"]([A-Z][A-Z0-9_]{2,})['\"]"
        r"|os\.environ\[['\"]([A-Z][A-Z0-9_]{2,})['\"]\]")
    found = set()
    for path in ROOT.rglob("*.py"):
        rel = path.relative_to(ROOT).as_posix()
        # The app only: tools, tests and backups read their own variables.
        if rel.startswith(("_archive", "venv", "node_modules", "tests/", "testbench/", "scripts/",
                           "backend_backup", "test_")) or "/_archive" in rel:
            continue
        try:
            for a, b in pat.findall(path.read_text(errors="ignore")):
                found.add(a or b)
        except OSError:
            continue
    return sorted(found)


def classify(names):
    groups = {"generate": [], "per_client": [], "first_admin": [], "sms": [], "optional": {}, "never_copy": [],
              "railway": [], "defaults": []}
    for n in names:
        if n in GENERATE:
            groups["generate"].append(n)
        elif n in PER_CLIENT:
            groups["per_client"].append(n)
        elif n in FIRST_ADMIN:
            groups["first_admin"].append(n)
        elif n in ("ADMIN_USER", "ADMIN_PASS"):
            groups["never_copy"].append(n)  # test-tool logins, not the app's
        elif n in SMS:
            groups["sms"].append(n)
        elif n in NEVER_COPY or n.startswith(NEVER_COPY_PREFIXES):
            groups["never_copy"].append(n)
        elif n.startswith(RAILWAY_SETS):
            groups["railway"].append(n)
        else:
            pref = next((p for p in OPTIONAL_PREFIXES if n.startswith(p)), None)
            if pref:
                groups["optional"].setdefault(OPTIONAL_PREFIXES[pref], []).append(n)
            else:
                groups["defaults"].append(n)
    # Make sure the must-haves appear even if the code scan missed one.
    for k in GENERATE:
        if k not in groups["generate"]:
            groups["generate"].append(k)
    for k in PER_CLIENT:
        if k not in groups["per_client"]:
            groups["per_client"].append(k)
    for k in FIRST_ADMIN:
        if k not in groups["first_admin"]:
            groups["first_admin"].append(k)
    return groups


def _run(cmd):
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.TimeoutExpired):
        return None


def prerequisites(slug, host):
    """Read-only look at what a real run would need. Changes nothing."""
    out = []
    if shutil.which("railway"):
        who = _run(["railway", "whoami"])
        ok = bool(who and who.returncode == 0)
        out.append(("Railway CLI logged in", ok, (who.stdout.strip().splitlines() or [""])[0] if ok else "run: railway login"))
        lst = _run(["railway", "list", "--json"])
        names = []
        if lst and lst.returncode == 0:
            try:
                names = [p.get("name") for p in json.loads(lst.stdout)]
            except ValueError:
                pass
        taken = f"cupq-{slug}" in names
        out.append((f"Railway project name cupq-{slug} is free", not taken,
                    "already exists" if taken else "free"))
    else:
        out.append(("Railway CLI installed", False, "brew install railway"))
    out.append(("Railway API token (for the real run, C3-4)", bool(os.environ.get("RAILWAY_API_TOKEN")),
                "set" if os.environ.get("RAILWAY_API_TOKEN") else "missing: Steve creates one in Railway > Account > Tokens"))
    out.append(("Cloudflare API token (subdomain, C3-3)", bool(os.environ.get("CLOUDFLARE_API_TOKEN")),
                "set" if os.environ.get("CLOUDFLARE_API_TOKEN") else "missing: Steve creates one limited to DNS on cupq.app"))
    twilio = bool(os.environ.get("TWILIO_MASTER_ACCOUNT_SID") and os.environ.get("TWILIO_MASTER_AUTH_TOKEN"))
    out.append(("Twilio master credentials (sub-account + number, C3-5)", twilio,
                "set" if twilio else "missing: and Steve approves the number spend"))
    try:
        socket.getaddrinfo(host, 443)
        out.append((f"{host} is unused", False, "already resolves: pick another name or retire the old copy"))
    except socket.gaierror:
        out.append((f"{host} is unused", True, "free"))
    return out


def plan(slug, event_name, event_file):
    host = f"{slug}.{DOMAIN}"
    groups = classify(code_env_vars())
    steps = [
        ("Railway project", f"create project cupq-{slug}"),
        ("Web service", f"deploy {REPO} @ main with the Dockerfile; start: python run_server.py; restart on failure"),
        ("Database", "add Postgres to the project; DATABASE_URL references it"),
        ("Volume", "attach a 1 GB volume to the web service (backups, uploads)"),
        ("Settings", f"{len(groups['generate'])} generated, {len(groups['per_client'])} per client, "
                     f"{len(groups['sms'])} for texts; the other {len(groups['defaults'])} keep code defaults"),
        ("Subdomain", f"Cloudflare CNAME {host} -> the service's Railway domain; add {host} as a custom domain in Railway"),
        ("Text number", "Twilio sub-account cupq-" + slug + ", buy an AU mobile number, point its webhook at "
                        f"https://{host}/sms"),
        ("First admin", f"{slug}admin, made at first boot with a random password printed once in the deploy log"),
        ("Saved event", f"import {event_file}" if event_file else "none given (--event-file to load one)"),
        ("Plan tier", "set in Runner > Settings > Plan"),
        ("Check", f"open https://{host}/run#live/readiness and work it to green"),
    ]
    return host, groups, steps


def main(argv=None):
    ap = argparse.ArgumentParser(description="Plan a new client copy of CupQ (dry run: changes nothing).")
    ap.add_argument("slug", help="short client name, becomes <slug>.cupq.app (lowercase, letters/digits/-)")
    ap.add_argument("--event-name", help="the event's name (default: the slug, capitalised)")
    ap.add_argument("--event-file", help="a saved event (.cupq-event.json) to load into the new copy")
    ap.add_argument("--json", action="store_true", help="print the plan as JSON")
    a = ap.parse_args(argv)

    slug = a.slug.strip().lower()
    if not SLUG_RE.match(slug) or slug in RESERVED:
        print(f"'{a.slug}' can't be a client name: 3-30 lowercase letters, digits or '-', "
              f"starting with a letter{'; and it is reserved' if slug in RESERVED else ''}.", file=sys.stderr)
        return 2
    event_file = a.event_file
    if event_file:
        p = Path(os.path.expanduser(event_file))
        if not p.is_file():
            print(f"No saved event at {p}", file=sys.stderr)
            return 2
        try:
            d = json.loads(p.read_text())
            if not isinstance(d.get("payload"), dict):
                raise ValueError("no payload")
        except (ValueError, OSError) as e:
            print(f"{p} is not a CupQ saved event ({e})", file=sys.stderr)
            return 2
        event_file = f"{p} (\"{d.get('name', '?')}\")"
    event_name = a.event_name or slug.replace("-", " ").title()

    host, groups, steps = plan(slug, event_name, event_file)
    pre = prerequisites(slug, host)

    if a.json:
        print(json.dumps({
            "dry_run": True, "slug": slug, "host": host, "event_name": event_name,
            "steps": [{"what": w, "detail": d} for w, d in steps],
            "settings": groups,
            "prerequisites": [{"check": c, "ok": ok, "note": n} for c, ok, n in pre],
        }, indent=2))
        return 0

    fill = {"host": host, "event_name": event_name, "slug": slug}
    sub = lambda t: t.replace("{host}", host).replace("{event_name}", event_name).replace("{slug}", slug)
    print(f"\nDRY RUN: nothing is created or changed.\n\nNew client copy: {host}  ({event_name})\n")
    print("What a real run would do:")
    for i, (what, detail) in enumerate(steps, 1):
        print(f"  {i:>2}. {what:<13} {detail}")
    print("\nSettings for the new copy (from the code; no values read from production):")
    print("  Generated fresh for this client:")
    for k in groups["generate"]:
        print(f"    {k:<26} {GENERATE.get(k, '')}")
    print("  Set for this client:")
    for k in groups["per_client"]:
        print(f"    {k:<26} {sub(PER_CLIENT.get(k, ''))}")
    print("  First admin:")
    for k in groups["first_admin"]:
        print(f"    {k:<26} {sub(FIRST_ADMIN.get(k, ''))}")
    print("  Texts (C3-5):")
    for k in groups["sms"]:
        print(f"    {k:<26} {SMS.get(k, '')}")
    print("  Only if this client uses them:")
    for what, keys in sorted(groups["optional"].items()):
        print(f"    {what}: {', '.join(keys)}")
    print("  Never copied from production:")
    print(f"    {', '.join(groups['never_copy'])}")
    print(f"  Filled in by Railway: {', '.join(groups['railway'])}")
    print(f"  Left at the code's defaults ({len(groups['defaults'])}): {', '.join(groups['defaults'])}")
    print("\nBefore a real run:")
    for check, ok, note in pre:
        print(f"  [{'x' if ok else ' '}] {check}: {note}")
    blockers = [c for c, ok, _ in pre if not ok]
    print(f"\n{'Ready for a real run.' if not blockers else f'{len(blockers)} thing(s) to sort out before a real run.'}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
