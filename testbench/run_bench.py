#!/usr/bin/env python3
"""
Coffee Cue Test Bench — CLI.

Examples:
    # everything that needs no login (health + display), against prod
    python3 testbench/run_bench.py --base-url https://web-production-4cc9c.up.railway.app

    # full run (credentials via env or flags)
    BENCH_USER=xxx BENCH_PASS=yyy python3 testbench/run_bench.py \
        --base-url https://web-production-4cc9c.up.railway.app --suites all

    # include the opt-in mutating checks
    ... --allow-lifecycle --allow-blocklist

Exit code: 0 = no failures, 1 = failures found, 2 = couldn't run.
Reports land in testbench/reports/<timestamp>/ (json + md + html).
"""
import argparse
import os
import sys
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from bench.core import Runner, write_reports          # noqa: E402
from bench.registry import ALL_SUITES                   # noqa: E402


def main():
    ap = argparse.ArgumentParser(description="Coffee Cue Test Bench")
    ap.add_argument("--base-url", default=os.environ.get("BENCH_TARGET", "http://localhost:5001"))
    ap.add_argument("--username", default=os.environ.get("BENCH_USER", ""))
    ap.add_argument("--password", default=os.environ.get("BENCH_PASS", ""))
    ap.add_argument("--suites", default="all",
                    help="comma list of: " + ",".join(n for n, _, _ in ALL_SUITES) + " (or 'all')")
    ap.add_argument("--allow-lifecycle", action="store_true",
                    help="run start→complete on a phoneless bench order (stays in stats)")
    ap.add_argument("--allow-blocklist", action="store_true",
                    help="run the block/unblock roundtrip with a fake number")
    ap.add_argument("--allow-settings", action="store_true",
                    help="run the settings round-trip (mutates then restores a setting)")
    ap.add_argument("--allow-station-lifecycle", action="store_true",
                    help="create + delete a temporary real station (self-cleaning)")
    ap.add_argument("--out", default=None, help="report directory (default: testbench/reports/<stamp>)")
    a = ap.parse_args()

    wanted = [s.strip() for s in a.suites.split(",")] if a.suites != "all" else None
    suites = [t for t in ALL_SUITES if wanted is None or t[0] in wanted]
    if not suites:
        print(f"No matching suites in {a.suites!r}")
        return 2

    rn = Runner(a.base_url, a.username, a.password, {
        "allow_lifecycle": a.allow_lifecycle,
        "allow_blocklist": a.allow_blocklist,
        "allow_settings": a.allow_settings,
        "allow_station_lifecycle": a.allow_station_lifecycle,
        "suites": [t[0] for t in suites],
    })
    print(f"Coffee Cue Test Bench → {a.base_url}")
    print(f"Suites: {', '.join(t[0] for t in suites)}"
          + ("" if a.username else "   (no credentials — auth suites will skip)"))
    rn.run(suites)

    out_dir = a.out or os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                    "reports", datetime.now().strftime("%Y%m%d-%H%M%S"))
    write_reports(rn, out_dir)

    s = rn.summary()
    for r in rn.results:
        mark = {"pass": "\033[32mPASS\033[0m", "fail": "\033[31mFAIL\033[0m",
                "warn": "\033[33mWARN\033[0m", "skip": "\033[90mSKIP\033[0m"}[r["status"]]
        print(f"  {mark}  {r['suite']:<10} {r['name']}: {r['detail'][:100]}")
    print(f"\n{s['pass']} pass / {s['fail']} fail / {s['warn']} warn / {s['skip']} skipped")
    print(f"Reports: {out_dir}/report.html  (+ feedback.md, report.json)")
    return 1 if s["fail"] else 0


if __name__ == "__main__":
    sys.exit(main())
