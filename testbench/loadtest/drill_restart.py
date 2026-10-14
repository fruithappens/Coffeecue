#!/usr/bin/env python3
"""Failure drill: restart a service mid-service (roadmap X7-2).

Runs a small rush against a TEST copy (remote_siege.py --public), restarts
one of that copy's services (Postgres, or the web server itself) through
Railway's API part-way through, and probes
one order's tracking page every second to time the outage exactly.

The questions:
  - how long are orders unreadable while it restarts?
  - does the app come back BY ITSELF (no web restart)?
  - is any order the server said yes to lost?

Only for a copy you can lose. Refuses cupq.app.

    python testbench/loadtest/drill_restart.py --base https://demo.cupq.app \
        --service <service id> --label Postgres|web [--environment <id>]

Results from demo.cupq.app (15 Oct 2026) are in docs/FAILURE_DRILLS.md.
"""
import argparse
import json
import os
import subprocess
import sys
import threading
import time
import urllib.request

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "scripts"))
from railway_api import call as railway  # noqa: E402

UA = {"User-Agent": "CupQ-loadtest/1.0", "Content-Type": "application/json"}


def get(url, timeout=10):
    t0 = time.time()
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
            return r.status, (time.time() - t0) * 1000
    except urllib.error.HTTPError as e:
        return e.code, (time.time() - t0) * 1000
    except Exception:
        return 0, (time.time() - t0) * 1000


def place_probe_order(base):
    body = json.dumps({"name": "DRILL-probe", "coffee_type": "Cappuccino", "milk": "Full Cream",
                       "size": "Regular", "phone": "+61400008888"}).encode()
    req = urllib.request.Request(base + "/api/display/order", data=body, headers=UA, method="POST")
    with urllib.request.urlopen(req, timeout=30) as r:
        b = json.loads(r.read())
    return str(b.get("order_number") or (b.get("data") or {}).get("order_number"))


def latest_deployment(service_id, env_id):
    q = """query($s:String!){ service(id:$s){ serviceInstances{ edges{ node{ environmentId latestDeployment{ id } } } } } }"""
    r = railway(q, {"s": service_id})
    for e in r["data"]["service"]["serviceInstances"]["edges"]:
        if not env_id or e["node"]["environmentId"] == env_id:
            return e["node"]["latestDeployment"]["id"]
    raise SystemExit("no deployment found")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", required=True)
    ap.add_argument("--service", required=True, help="the copy's service to restart")
    ap.add_argument("--label", default="Postgres", help="what it is, for the output")
    ap.add_argument("--environment", default=None)
    ap.add_argument("--at", type=int, default=60, help="seconds into the rush to restart")
    ap.add_argument("--seconds", type=int, default=240)
    args = ap.parse_args()
    base = args.base.rstrip("/")
    if "://cupq.app" in base or "web-production-4cc9c" in base:
        print("REFUSED: that is the live copy.")
        return 2

    probe = place_probe_order(base)
    print(f"probe order #{probe}")
    dep = latest_deployment(args.service, args.environment)

    siege = subprocess.Popen(
        [sys.executable, os.path.join(os.path.dirname(__file__), "remote_siege.py"),
         "--base", base, "--public", "--delegates", "50", "--seconds", str(args.seconds),
         "--orders", "60", "--yes-this-is-production", "--tag", f"DRILL-{args.label}"],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    out = []
    threading.Thread(target=lambda: out.extend(siege.stdout), daemon=True).start()

    t0 = time.time()
    timeline = []
    restarted_at = None
    while time.time() - t0 < args.seconds:
        el = time.time() - t0
        if restarted_at is None and el >= args.at:
            r = railway("mutation($id:String!){ deploymentRestart(id:$id) }", {"id": dep})
            restarted_at = el
            print(f"{el:6.1f}s  RESTARTED {args.label} ({'ok' if r.get('data') else r})")
        code, ms = get(f"{base}/api/orders/{probe}/track", timeout=5)
        timeline.append((el, code, ms))
        time.sleep(max(0, 1 - (time.time() - t0 - el)))
    siege.wait(timeout=120)

    bad = [(t, c) for t, c, _ in timeline if c != 200]
    print()
    if restarted_at is not None and bad:
        first, last = bad[0][0], bad[-1][0]
        print(f"probe failed from {first - restarted_at:+.0f}s to {last - restarted_at:+.0f}s "
              f"after the restart ({len(bad)} of {len(timeline)} probes; codes "
              f"{sorted(set(c for _, c in bad))})")
        recovered = timeline[-1][1] == 200
        print(f"recovered by itself: {'YES' if recovered else 'NO'}")
    else:
        print(f"probe never failed ({len(timeline)} probes)")
    print()
    print("".join(out[-14:]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
