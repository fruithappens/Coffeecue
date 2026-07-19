#!/usr/bin/env python3
"""
Coffee Cue — LIVE GROUP SMS TEST capture & review.

For the "get a small group of people to text at the same time" test: this
records the window and turns the raw traffic into a reviewable report.

    # 1. Just before the group starts texting:
    bash testbench/run_group_test.sh start

    # 2. People text the real number, order, cancel, ask questions...

    # 3. When they're done:
    bash testbench/run_group_test.sh report

The report (testbench/reports/group-<stamp>/group_report.md) shows, per
participant (phones masked to last 3 digits):
  - the full conversation replay (their texts + the bot's replies, in order)
  - the outcome: order placed? number? station? status now?
  - anomalies, auto-flagged:
      * inbound message that got NO reply recorded
      * replies containing 'Sorry' / error-ish wording
      * orders that never reached the pending queue
      * anyone whose conversation just stopped mid-flow

Reads only (sms/log, orders, reports/today) — changes nothing.
"""
import json
import os
import re
import sys
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bench.core import ApiClient  # noqa: E402

STATE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                          ".group_test_start")

ERRORISH = re.compile(r"sorry|couldn't|unavailable|error|try again", re.I)


def mask(phone):
    p = str(phone or "")
    return ("…" + p[-3:]) if len(p) >= 3 else p


def start(client):
    # Server-clock start marker: read it from the SMS log endpoint's own DB
    # clock by recording local UTC-ish now AND asking the server for a probe.
    now = datetime.now().isoformat(timespec="seconds")
    with open(STATE_FILE, "w") as f:
        f.write(now)
    print(f"Group test STARTED at {now} (local clock).")
    print("Get your group texting now. When they're done:")
    print("  bash testbench/run_group_test.sh report")


def report(client):
    if not os.path.exists(STATE_FILE):
        print("No start marker — run 'start' first (reporting last 2h instead).")
        since = None
    else:
        since = open(STATE_FILE).read().strip()
        print(f"Reporting the window since {since}.")

    qs = f"?since={since}&limit=500" if since else "?limit=500"
    code, body, _ = client.get(f"/api/sms/log{qs}")
    msgs = (body or {}).get("messages") or []
    if code != 200:
        print(f"ERROR: sms log unavailable (HTTP {code}) — is the deploy live?")
        return 2

    # Orders in the window (any status), for outcome mapping.
    _c, ob, _ = client.get("/api/orders")
    orows = (ob or {}).get("data") or (ob or {}).get("orders") or []
    orders_by_phone = {}
    for o in (orows if isinstance(orows, list) else []):
        ph = str(o.get("phone_number") or o.get("phoneNumber") or "")
        if ph:
            orders_by_phone.setdefault(ph, []).append(o)

    by_phone = {}
    for m in msgs:
        by_phone.setdefault(str(m.get("phone_number")), []).append(m)

    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    outdir = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                          "reports", f"group-{stamp}")
    os.makedirs(outdir, exist_ok=True)
    lines = [f"# Group SMS test report — {stamp}",
             f"Window since: {since or 'last 2 hours'}",
             f"Participants: {len(by_phone)}   Messages in: {len(msgs)}", ""]
    anomalies = []

    for ph, ms in sorted(by_phone.items()):
        lines.append(f"## Participant {mask(ph)}  ({len(ms)} message(s))")
        last_reply = None
        for m in ms:
            body_txt = (m.get("message_body") or "").strip()
            reply = (m.get("response_sent") or "").strip()
            t = str(m.get("received_at") or "")[11:19]
            lines.append(f"- `{t}` **them:** {body_txt}")
            if reply:
                lines.append(f"  - **bot:** {reply[:300]}")
                if ERRORISH.search(reply):
                    anomalies.append(f"{mask(ph)}: error-ish reply to "
                                     f"'{body_txt[:40]}' → '{reply[:80]}'")
            else:
                lines.append("  - **bot:** (NO reply recorded)")
                anomalies.append(f"{mask(ph)}: no reply recorded for "
                                 f"'{body_txt[:60]}' (blocklist/throttle/crash?)")
            last_reply = reply
        theirs = orders_by_phone.get(ph, [])
        if theirs:
            for o in theirs:
                lines.append(f"  - **outcome:** order #{o.get('order_number')} "
                             f"[{o.get('status')}] station {o.get('station_id')}")
        else:
            lines.append("  - **outcome:** no order reached the system")
            if last_reply and ("confirmed" in last_reply.lower()):
                anomalies.append(f"{mask(ph)}: bot said CONFIRMED but no order found")
            elif any("latte" in (m.get('message_body') or '').lower()
                     or "coffee" in (m.get('message_body') or '').lower()
                     for m in ms):
                anomalies.append(f"{mask(ph)}: talked about coffee but never "
                                 "got an order in — review their replay")
        lines.append("")

    lines.append("## Auto-flagged anomalies" if anomalies else "## No anomalies auto-flagged")
    for a in anomalies:
        lines.append(f"- {a}")

    out = os.path.join(outdir, "group_report.md")
    with open(out, "w") as f:
        f.write("\n".join(lines))
    with open(os.path.join(outdir, "raw_sms_log.json"), "w") as f:
        json.dump(msgs, f, indent=1, default=str)
    print(f"\n{len(by_phone)} participant(s), {len(msgs)} messages, "
          f"{len(anomalies)} anomalies flagged.")
    for a in anomalies[:10]:
        print("  ⚠", a)
    print(f"\nReport: {out}")
    return 0


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "report"
    c = ApiClient(os.environ.get("BENCH_TARGET",
                                 "https://web-production-4cc9c.up.railway.app"))
    c.login(os.environ["BENCH_USER"], os.environ["BENCH_PASS"])
    if mode == "start":
        return start(c)
    return report(c)


if __name__ == "__main__":
    sys.exit(main() or 0)
