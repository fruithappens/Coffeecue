#!/usr/bin/env python3
"""
Coffee Cue — LOAD TEST (sized for a 400-person event, with headroom).

A 400-person event peaks around 2-4 orders/minute with bursts when a
session breaks. This test pushes WELL past that so the answer carries
margin:

  Phase R  read storm     — 20 concurrent pollers × 5 rounds of the
                            surfaces every screen hits (pending board,
                            display orders, menu)
  Phase W  order burst    — 48 phoneless kiosk orders (ZZBenchLoad*)
                            from 8 concurrent workers ≈ a whole session
                            break's worth of walk-ups in ~1 minute
  Phase S  SMS burst      — 12 concurrent simulate conversations
                            (one-shot orders, distinct virgin phones)
  Phase V  integrity      — every accepted order is actually in pending,
                            exactly once, then everything is cancelled
                            (concurrently) and verified gone

Reports p50/p95/max latency + error rate per phase to stdout and
testbench/reports/load-<stamp>/load_report.md. Self-cleaning.
"""
import json
import os
import statistics
import sys
import threading
import time
import uuid
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bench.core import ApiClient  # noqa: E402

BASE = os.environ.get("BENCH_TARGET", "https://web-production-4cc9c.up.railway.app")
TAG = "ZZBenchLoad"


def pct(xs, p):
    if not xs:
        return 0.0
    xs = sorted(xs)
    k = min(len(xs) - 1, int(round((p / 100.0) * (len(xs) - 1))))
    return xs[k]


class Phase:
    def __init__(self, name):
        self.name = name
        self.lat = []
        self.errors = []
        self.lock = threading.Lock()

    def record(self, ms, err=None):
        with self.lock:
            self.lat.append(ms)
            if err:
                self.errors.append(str(err)[:160])

    def summary(self):
        return {
            "name": self.name, "n": len(self.lat),
            "p50_ms": round(pct(self.lat, 50)), "p95_ms": round(pct(self.lat, 95)),
            "max_ms": round(max(self.lat) if self.lat else 0),
            "errors": len(self.errors), "error_samples": self.errors[:5],
        }


def new_client():
    c = ApiClient(BASE)
    c.login(os.environ["BENCH_USER"], os.environ["BENCH_PASS"])
    return c


def timed(client, method, path, body=None, auth=True):
    t0 = time.time()
    try:
        if method == "GET":
            code, resp, _ = client.get(path, auth=auth)
        else:
            code, resp, _ = client.post(path, body or {}, auth=auth)
        ms = (time.time() - t0) * 1000
        return ms, code, resp
    except Exception as e:
        return (time.time() - t0) * 1000, 0, {"error": str(e)}


def run_threads(n, fn):
    ts = [threading.Thread(target=fn, args=(i,)) for i in range(n)]
    t0 = time.time()
    for t in ts:
        t.start()
    for t in ts:
        t.join()
    return time.time() - t0


def main():
    print(f"Coffee Cue load test → {BASE}")
    master = new_client()
    phases = []

    # ---- Phase R: read storm -------------------------------------------
    R = Phase("R read storm (20 pollers × 5 rounds × 3 endpoints)")

    def reader(i):
        c = new_client()
        for _ in range(5):
            for path, auth in (("/api/orders/pending", True),
                               ("/api/display/orders", False),
                               ("/api/display/menu", False)):
                ms, code, _ = timed(c, "GET", path, auth=auth)
                R.record(ms, None if code == 200 else f"{path} HTTP {code}")
    wall = run_threads(20, reader)
    phases.append((R, wall))
    print(f"  R done in {wall:.1f}s: {R.summary()}")

    # ---- Phase W: order burst ------------------------------------------
    W = Phase("W kiosk order burst (48 orders, 8 workers)")
    created = []
    clock = threading.Lock()

    def orderer(i):
        c = new_client()
        for j in range(6):
            ms, code, resp = timed(c, "POST", "/api/display/order", {
                "name": f"{TAG}{i}x{j}", "coffee_type": "latte",
                "milk": "full cream", "size": "medium",
                "sugar": "No sugar", "phone": "",
            }, auth=False)
            no = (resp or {}).get("order_number") if isinstance(resp, dict) else None
            W.record(ms, None if (code == 200 and no) else f"HTTP {code} {str(resp)[:80]}")
            if no:
                with clock:
                    created.append(str(no))
    wall = run_threads(8, orderer)
    phases.append((W, wall))
    print(f"  W done in {wall:.1f}s: {W.summary()} (created {len(created)})")

    # ---- Phase S: SMS conversation burst -------------------------------
    S = Phase("S SMS burst (12 concurrent one-shot conversations)")
    sms_orders = []

    def texter(i):
        c = new_client()
        ph = "+614" + str(int(uuid.uuid4().int % 10**8)).zfill(8)
        ms, code, resp = timed(c, "POST", "/api/sms/simulate", {
            "from": ph, "body": f"{TAG}S{i} medium latte with skim"})
        reply = (resp or {}).get("reply") or ""
        ok = code == 200 and ("confirmed" in reply.lower() or "order #" in reply.lower())
        S.record(ms, None if ok else f"HTTP {code} reply={reply[:80]}")
        import re as _re
        m = _re.search(r"#([A-Za-z]{0,3}\d+)", reply)
        if m:
            with clock:
                sms_orders.append(m.group(1))
    wall = run_threads(12, texter)
    phases.append((S, wall))
    print(f"  S done in {wall:.1f}s: {S.summary()} (confirmed {len(sms_orders)})")

    # ---- Phase V: integrity + concurrent cleanup -----------------------
    V = Phase("V integrity + concurrent cancel")
    _c, pb, _ = master.get("/api/orders/pending")
    rows = pb.get("orders") or pb.get("data") or []
    pend = [str(o.get("order_number")) for o in rows if isinstance(o, dict)]
    missing = [n for n in created + sms_orders if n not in pend]
    dupes = len(pend) != len(set(pend))
    print(f"  V: {len(created) + len(sms_orders)} accepted, "
          f"{len(missing)} missing from pending, dupes={dupes}")

    all_nums = created + sms_orders

    def canceller(i):
        c = new_client()
        for n in all_nums[i::8]:
            ms, code, _ = timed(c, "POST", f"/api/orders/{n}/cancel")
            V.record(ms, None if code == 200 else f"cancel {n} HTTP {code}")
    wall = run_threads(8, canceller)
    _c, pb2, _ = master.get("/api/orders/pending")
    left = [o for o in (pb2.get("orders") or pb2.get("data") or [])
            if TAG.lower() in str(o.get("customerName") or "").lower()]
    phases.append((V, wall))
    print(f"  V done in {wall:.1f}s: {V.summary()} (leftovers {len(left)})")

    # ---- Report ---------------------------------------------------------
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    outdir = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                          "reports", f"load-{stamp}")
    os.makedirs(outdir, exist_ok=True)
    # Per-phase p95 bars: screens poll every 15s so reads must be snappy;
    # a kiosk tap should feel instant-ish; an SMS conversation turn does
    # full order processing AND the medium itself takes seconds to deliver,
    # so its bar is looser (observed ~3.5s under a 12-way simultaneous
    # burst — imperceptible to a texting customer).
    bars = {"R": 3000, "W": 4000, "S": 6000, "V": 4000}
    verdict = []
    for ph_obj, wall in phases:
        s = ph_obj.summary()
        ok = s["errors"] == 0 and s["p95_ms"] < bars.get(s["name"][0], 3000)
        verdict.append((s, wall, ok))
    integrity_ok = not missing and not dupes and not left
    all_ok = all(ok for _, _, ok in verdict) and integrity_ok

    lines = [f"# Load test — {stamp}", f"Target: {BASE}",
             f"Sized for: 400-person event with headroom "
             f"(48-order burst ≈ a session break's walk-ups in ~1 min)", ""]
    for s, wall, ok in verdict:
        lines.append(f"## {'✅' if ok else '❌'} {s['name']}")
        lines.append(f"- {s['n']} requests in {wall:.1f}s — p50 {s['p50_ms']}ms, "
                     f"p95 {s['p95_ms']}ms, max {s['max_ms']}ms, errors {s['errors']}")
        for e in s["error_samples"]:
            lines.append(f"  - error: {e}")
    lines.append(f"## {'✅' if integrity_ok else '❌'} Integrity")
    lines.append(f"- accepted orders all present exactly once: missing={len(missing)}, "
                 f"dupes={dupes}, leftovers after cleanup={len(left)}")
    lines.append("")
    lines.append(f"**VERDICT: {'PASS — comfortable for a 400-person event' if all_ok else 'ISSUES FOUND — see above'}**")
    out = os.path.join(outdir, "load_report.md")
    with open(out, "w") as f:
        f.write("\n".join(lines))
    with open(os.path.join(outdir, "load_report.json"), "w") as f:
        json.dump([s for s, _, _ in verdict], f, indent=1)
    print(f"\nVERDICT: {'PASS' if all_ok else 'ISSUES FOUND'}   Report: {out}")
    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main())
