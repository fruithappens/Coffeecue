#!/usr/bin/env python3
"""
Coffee Cue Test Bench — local web UI.

A small Flask app (localhost only, port 5055) with a Run form and a report
browser. Start it with ./start_testbench.sh, open http://localhost:5055,
enter the target + your admin login, tick the suites, hit Run.

Credentials are used in-memory for the run only — never stored or logged.
"""
import html
import os
import sys
from datetime import datetime

from flask import Flask, redirect, request, send_from_directory

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from bench.core import Runner, write_reports          # noqa: E402
from bench.suites import ALL_SUITES                   # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
REPORTS = os.path.join(HERE, "reports")
DEFAULT_TARGET = os.environ.get("BENCH_TARGET",
                                "https://web-production-4cc9c.up.railway.app")

app = Flask(__name__)


def _past_runs():
    if not os.path.isdir(REPORTS):
        return []
    runs = sorted((d for d in os.listdir(REPORTS)
                   if os.path.isdir(os.path.join(REPORTS, d))), reverse=True)
    return runs[:25]


@app.route("/")
def index():
    suite_boxes = "".join(
        f"<label class='cb'><input type='checkbox' name='suites' value='{n}' checked> "
        f"{n}{' 🔐' if needs_auth else ''}</label>"
        for n, _, needs_auth in ALL_SUITES
    )
    past = "".join(
        f"<li><a href='/reports/{html.escape(d)}/report.html'>{html.escape(d)}</a>"
        f" &middot; <a href='/reports/{html.escape(d)}/feedback.md'>feedback.md</a></li>"
        for d in _past_runs()
    ) or "<li class='dim'>No runs yet</li>"
    return f"""<!doctype html><html><head><meta charset="utf-8">
<title>Coffee Cue Test Bench</title>
<style>
 body{{font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;margin:0;background:#faf7f2;color:#1f2937}}
 .hdr{{background:#7c3a06;color:#fff;padding:16px 26px;font-size:22px;font-weight:800}}
 .wrap{{max-width:720px;margin:24px auto;padding:0 16px}}
 .card{{background:#fff;border:1px solid #e7ddd0;border-radius:12px;padding:18px 22px;margin-bottom:18px}}
 label{{display:block;font-weight:600;margin:10px 0 4px}}
 input[type=text],input[type=password]{{width:100%;padding:9px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box}}
 .cb{{display:inline-block;font-weight:500;margin:4px 14px 4px 0}}
 .opt{{background:#fff7ed;border:1px solid #f0c489;border-radius:8px;padding:8px 12px;margin-top:10px;font-size:14px}}
 button{{margin-top:16px;background:#b45309;color:#fff;border:none;border-radius:10px;padding:12px 26px;font-size:16px;font-weight:700;cursor:pointer}}
 button:hover{{background:#92400e}} .dim{{color:#9ca3af}}
 .note{{font-size:13px;color:#6b7280;margin-top:8px}}
 ul{{padding-left:20px}} li{{margin-bottom:4px}}
</style></head><body>
<div class="hdr">☕ Coffee Cue Test Bench</div>
<div class="wrap">
 <form class="card" method="post" action="/run">
  <label>Target app URL</label>
  <input type="text" name="base_url" value="{html.escape(DEFAULT_TARGET)}">
  <label>Username (admin/staff — for 🔐 suites)</label>
  <input type="text" name="username" autocomplete="off">
  <label>Password</label>
  <input type="password" name="password" autocomplete="off">
  <div class="note">Used in-memory for this run only — never stored or logged.
  Leave blank to run just the public suites.</div>
  <label style="margin-top:14px">Suites</label>
  {suite_boxes}
  <div class="opt">
   <label class="cb"><input type="checkbox" name="allow_lifecycle" value="1">
    order lifecycle start→complete (phoneless; the completed order stays in today's stats)</label><br>
   <label class="cb"><input type="checkbox" name="allow_blocklist" value="1">
    blocklist block/unblock roundtrip (fake number, auto-undone)</label>
  </div>
  <button type="submit">▶ Run tests</button>
  <div class="note">SMS checks use the simulate harness — <b>no real SMS is ever sent</b>.
  Bench orders are named ZZBench and cancelled afterwards.</div>
 </form>
 <div class="card">
  <b>Past runs</b>
  <ul>{past}</ul>
 </div>
</div></body></html>"""


@app.route("/run", methods=["POST"])
def run():
    base_url = (request.form.get("base_url") or DEFAULT_TARGET).strip()
    username = (request.form.get("username") or "").strip()
    password = request.form.get("password") or ""
    wanted = request.form.getlist("suites") or [n for n, _, _ in ALL_SUITES]
    suites = [t for t in ALL_SUITES if t[0] in wanted]
    rn = Runner(base_url, username, password, {
        "allow_lifecycle": bool(request.form.get("allow_lifecycle")),
        "allow_blocklist": bool(request.form.get("allow_blocklist")),
        "suites": [t[0] for t in suites],
    })
    rn.run(suites)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    write_reports(rn, os.path.join(REPORTS, stamp))
    return redirect(f"/reports/{stamp}/report.html")


@app.route("/reports/<path:sub>")
def reports(sub):
    return send_from_directory(REPORTS, sub)


if __name__ == "__main__":
    print("Coffee Cue Test Bench UI → http://localhost:5055")
    app.run(host="127.0.0.1", port=5055, debug=False)
