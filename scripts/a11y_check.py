#!/usr/bin/env python3
"""Accessibility check of the customer pages (roadmap A7-2).

    python scripts/a11y_check.py http://127.0.0.1:5001 [--write-baseline]

Opens each page a customer sees in headless Chromium, runs axe-core
(WCAG 2.0/2.1 A and AA rules) and fails on any violation that is not in
scripts/a11y_baseline.json. The baseline holds what was already there when
the check started; it can only shrink. Fix one, take it out of the file.
A NEW problem fails CI, which is the point.

axe-core comes from the frontend's own node_modules (npm ci installs it).
"""

import json
import os
import sys

from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
AXE = os.path.join(ROOT, "Barista Front End", "node_modules", "axe-core", "axe.min.js")
BASELINE = os.path.join(os.path.dirname(__file__), "a11y_baseline.json")

# Every page a customer (not staff) can land on.
PAGES = ["/", "/my", "/order", "/start", "/status", "/try", "/login",
         "/display", "/display/menu", "/display/order"]
SIZES = {"phone": (390, 844), "screen": (1920, 1080)}
TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]


def run(base):
    found = {}
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for size, (w, h) in SIZES.items():
            # bypass_csp: the page rules (rightly) refuse injected scripts, axe included.
            ctx = browser.new_context(viewport={"width": w, "height": h}, bypass_csp=True)
            page = ctx.new_page()
            for path in PAGES:
                page.goto(base + path, wait_until="networkidle", timeout=60000)
                page.wait_for_timeout(1500)  # let React settle after data
                page.add_script_tag(path=AXE)
                res = page.evaluate(
                    "tags => axe.run(document, {runOnly: {type: 'tag', values: tags}})", TAGS)
                for v in res["violations"]:
                    key = f"{path} [{size}] {v['id']}"
                    found[key] = {
                        "impact": v.get("impact"),
                        "help": v.get("help"),
                        "nodes": len(v.get("nodes", [])),
                        "example": (v.get("nodes") or [{}])[0].get("target"),
                    }
            ctx.close()
        browser.close()
    return found


def main():
    base = (sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith("--")
            else "http://127.0.0.1:5001").rstrip("/")
    found = run(base)
    if "--write-baseline" in sys.argv:
        with open(BASELINE, "w") as f:
            json.dump(sorted(found), f, indent=1)
            f.write("\n")
        print(f"Baseline written: {len(found)} known problem(s)")
        return
    known = set(json.load(open(BASELINE))) if os.path.exists(BASELINE) else set()
    new = {k: v for k, v in found.items() if k not in known}
    gone = sorted(known - set(found))
    for k, v in sorted(found.items()):
        tag = "NEW " if k in new else "known"
        print(f"{tag}  {k}: {v['help']} ({v['impact']}, {v['nodes']} element(s), e.g. {v['example']})")
    if gone:
        print("\nFixed since the baseline (take these out of scripts/a11y_baseline.json):")
        for k in gone:
            print("  " + k)
    if new:
        print(f"\nFAIL: {len(new)} new accessibility problem(s).")
        sys.exit(1)
    print(f"\nOK: no new problems ({len(found)} known, {len(gone)} fixed).")


if __name__ == "__main__":
    main()
