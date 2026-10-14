#!/usr/bin/env python3
"""Go back to an earlier version of a CupQ copy, and forward again (S1-5).

    python scripts/rollback.py --copy demo                 # list versions
    python scripts/rollback.py --copy demo --to <id> --yes # go back to one
    python scripts/rollback.py --copy live --to <id> --yes # cupq.app

Lists the copy's recent deployments with their commit and message, newest
first, and marks the one serving now. Rolling back makes Railway run that
deployment's image again (no rebuild, about a minute); it doesn't change
the code on GitHub, so the next merge to main deploys as normal. To go
forward again, roll "back" to the newest deployment.

Checks the copy's /api/app-version afterwards and says whether it is now
serving the commit you asked for. Uses the Railway token in ~/.zshrc via
scripts/railway_api.py and never prints it.
"""
import argparse
import json
import os
import sys
import time
import urllib.request

sys.path.insert(0, os.path.dirname(__file__))
from railway_api import call  # noqa: E402

COPIES = {
    "live": {
        "host": "cupq.app",
        "project": "1b1cd06b",
        "service": "bfffe2df-3c0a-4ffd-be65-9d717847737a",
    },
    "demo": {
        "host": "demo.cupq.app",
        "project": "4d7c7cc6-8be3-472d-89e8-51f796f889b7",
        "service": "9194c65a-f7c8-48d0-8067-246c9cfb414c",
    },
}


def deployments(service_id, n=10):
    q = """query($s:String!,$n:Int!){ deployments(first:$n, input:{serviceId:$s}){ edges{ node{
             id status createdAt meta } } } }"""
    r = call(q, {"s": service_id, "n": n})
    if not r.get("data"):
        raise SystemExit(f"Railway said: {str(r)[:300]}")
    out = []
    for e in r["data"]["deployments"]["edges"]:
        d = e["node"]
        m = d.get("meta") or {}
        out.append(
            {
                "id": d["id"],
                "status": d["status"],
                "at": d["createdAt"][:16].replace("T", " "),
                "commit": (m.get("commitHash") or "")[:7],
                "message": (m.get("commitMessage") or "").split("\n")[0][:70],
            }
        )
    return out


def serving(host):
    try:
        req = urllib.request.Request(
            f"https://{host}/api/app-version", headers={"User-Agent": "CupQ-rollback"}
        )
        with urllib.request.urlopen(req, timeout=15) as r:
            return (json.loads(r.read()).get("commit") or "")[:7]
    except Exception:
        return ""


def healthy(host):
    try:
        req = urllib.request.Request(
            f"https://{host}/api/health", headers={"User-Agent": "CupQ-rollback"}
        )
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status == 200
    except Exception:
        return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--copy", choices=sorted(COPIES), required=True)
    ap.add_argument("--to", help="deployment id to go back (or forward) to")
    ap.add_argument("--yes", action="store_true", help="really do it")
    a = ap.parse_args()
    c = COPIES[a.copy]
    now = serving(c["host"])
    deps = deployments(c["service"])
    print(f"{c['host']} is serving {now or '?'}\n")
    running = next((d["id"] for d in deps if d["status"] == "SUCCESS"), None)
    for d in deps:
        mark = "  <- running" if d["id"] == running else ""
        print(
            f"  {d['id']}  {d['at']}  {d['status']:9} {d['commit']}  {d['message']}{mark}"
        )
    if not a.to:
        return 0
    target = next((d for d in deps if d["id"] == a.to), None)
    if not target:
        print("\nThat id isn't in the list above.")
        return 2
    if not a.yes:
        print(
            f"\nWould switch {c['host']} to {target['commit']} ({target['message']}). Add --yes to do it."
        )
        return 0
    r = call("mutation($id:String!){ deploymentRollback(id:$id) }", {"id": a.to})
    if not r.get("data"):
        print(f"\nRailway refused: {str(r)[:300]}")
        return 1
    print(f"\nSwitching {c['host']} to {target['commit']}...")
    # A rollback appears as a NEW deployment carrying the old commit. Done
    # when that is the newest successful one and the copy answers. (Builds
    # from before 15 Oct 2026 don't report their commit at /api/app-version
    # after a rollback; newer ones do, from BUILD_COMMIT.)
    for _ in range(40):
        time.sleep(10)
        newest_ok = next(
            (d for d in deployments(c["service"], 5) if d["status"] == "SUCCESS"), None
        )
        if newest_ok and newest_ok["commit"] == target["commit"] and healthy(c["host"]):
            seen = serving(c["host"])
            print(
                f"Done: {c['host']} is running {target['commit']}"
                + (
                    f" (it reports {seen})."
                    if seen
                    else " (its version check predates BUILD_COMMIT)."
                )
            )
            return 0
    print(
        f"Not running {target['commit']} after ~7 minutes; check the Railway dashboard."
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
