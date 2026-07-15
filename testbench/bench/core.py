"""
Coffee Cue Test Bench — core framework.

A standalone tester for the Coffee Cue app. Suites (bench/suites.py) exercise
the live API surface — orders, SMS conversations, displays, stats, inventory,
abuse protection — and every run writes three artifacts under
testbench/reports/<stamp>/:

  report.json  — machine-readable results (feed to tooling / CI)
  feedback.md  — prioritised findings with evidence + likely source files,
                 written to be handed straight to a developer (or a Claude
                 Code session) to repair the main app
  report.html  — human dashboard

Design rules:
  - The bench NEVER sends a real SMS: SMS flows go through /api/sms/simulate
    (returns the bot reply; Twilio is not in the loop) using fake +6140000xxxx
    numbers, and lifecycle tests only use PHONELESS orders.
  - Test orders are named with the BENCH_TAG prefix and cancelled in teardown.
  - Anything that mutates beyond create+cancel (start/complete lifecycle,
    block/unblock) is OPT-IN via options.
"""
from __future__ import annotations

import html
import json
import os
import time
import uuid
from datetime import datetime

import requests

BENCH_VERSION = "1.0"
BENCH_TAG = "ZZBench"          # customer-name prefix for every bench order
FAKE_PHONE_PREFIX = "+6140000" # never a real customer's number
DEFAULT_TIMEOUT = 20


# ---------------------------------------------------------------- results

def result(suite, name, status, detail="", evidence="", suggestion="", refs=None, ms=0):
    """One check outcome. status: pass | fail | warn | skip."""
    return {
        "id": f"{suite}.{name}".replace(" ", "_").lower(),
        "suite": suite,
        "name": name,
        "status": status,
        "detail": detail,
        "evidence": (evidence or "")[:2000],
        "suggestion": suggestion,
        "refs": refs or [],
        "ms": int(ms),
    }


class Timer:
    def __enter__(self):
        self.t0 = time.time()
        return self

    def __exit__(self, *a):
        self.ms = int((time.time() - self.t0) * 1000)


# ---------------------------------------------------------------- API client

class ApiClient:
    """Thin authenticated client mirroring how the frontends call the API."""

    def __init__(self, base_url):
        self.base = base_url.rstrip("/")
        self.s = requests.Session()
        self.token = None
        self.login_error = None

    def login(self, username, password):
        try:
            r = self.s.post(
                f"{self.base}/api/auth/login",
                json={"username": username, "password": password},
                timeout=DEFAULT_TIMEOUT,
            )
            if r.status_code == 200:
                self.token = (r.json() or {}).get("token")
                if self.token:
                    return True
                self.login_error = "200 but no token in response"
                return False
            self.login_error = f"HTTP {r.status_code}"
            return False
        except Exception as e:
            self.login_error = str(e)
            return False

    def _headers(self, auth):
        h = {"Content-Type": "application/json"}
        if auth and self.token:
            h["Authorization"] = f"Bearer {self.token}"
        return h

    def req(self, method, path, auth=True, body=None, timeout=DEFAULT_TIMEOUT):
        """Returns (status_code, parsed_json_or_text, elapsed_ms)."""
        url = f"{self.base}{path}"
        t0 = time.time()
        try:
            r = self.s.request(method, url, headers=self._headers(auth),
                               json=body, timeout=timeout)
            ms = int((time.time() - t0) * 1000)
            try:
                data = r.json()
            except Exception:
                data = r.text[:500]
            return r.status_code, data, ms
        except Exception as e:
            return 0, f"request error: {e}", int((time.time() - t0) * 1000)

    def get(self, path, auth=True):
        return self.req("GET", path, auth=auth)

    def post(self, path, body=None, auth=True):
        return self.req("POST", path, auth=auth, body=body)


def fake_phone(seq):
    """Unique fake AU mobile per run+check; never a real customer."""
    return f"{FAKE_PHONE_PREFIX}{seq:03d}"


# ---------------------------------------------------------------- runner

class Runner:
    def __init__(self, base_url, username=None, password=None, options=None):
        self.client = ApiClient(base_url)
        self.username = username or ""
        self.password = password or ""
        self.options = options or {}
        self.results = []
        self.meta = {
            "bench_version": BENCH_VERSION,
            "target": base_url,
            "started": datetime.now().isoformat(timespec="seconds"),
            "options": {k: v for k, v in self.options.items()},
            "run_id": uuid.uuid4().hex[:8],
        }
        # Fake-phone generator. Numbers must be VIRGIN every run: a reused
        # number is a "returning customer" to the app (saved name, old
        # conversation state) and contaminates conversation tests — run 3's
        # routing fail traced back to exactly that. uuid-derived digits give
        # ~10^9 space, so cross-run reuse is effectively impossible.
        self._phone_base = int(uuid.uuid4().int % 10**9)
        self.phone_seq = 0

    def next_phone(self):
        self.phone_seq += 1
        return f"+614{(self._phone_base + self.phone_seq) % 10**8:08d}"

    def authenticate(self):
        """Login if creds provided. Returns True/False/None(no creds)."""
        if not self.username or not self.password:
            return None
        return self.client.login(self.username, self.password)

    def run(self, suites):
        """suites: list of (name, fn) — fn(runner) -> list[result]."""
        authed = self.authenticate()
        if authed is False:
            self.results.append(result(
                "auth", "login", "fail",
                f"Login as '{self.username}' failed: {self.client.login_error}",
                suggestion="Check the username/password given to the bench; "
                           "auth-dependent suites were skipped.",
                refs=["routes/auth_routes.py", "auth.py"],
            ))
        for name, fn, needs_auth in suites:
            if needs_auth and not self.client.token:
                self.results.append(result(
                    name, "suite", "skip",
                    "Skipped: needs login credentials"
                    + ("" if authed is None else " (login failed)"),
                ))
                continue
            try:
                self.results.extend(fn(self) or [])
            except Exception as e:
                self.results.append(result(
                    name, "suite_crash", "fail",
                    f"Suite raised an exception: {e}",
                    suggestion="This is a bench bug or a hard API failure — "
                               "check the target is reachable.",
                ))
        self.meta["finished"] = datetime.now().isoformat(timespec="seconds")
        return self.results

    def summary(self):
        c = {"pass": 0, "fail": 0, "warn": 0, "skip": 0}
        for r in self.results:
            c[r["status"]] = c.get(r["status"], 0) + 1
        return c


# ---------------------------------------------------------------- reports

def write_reports(runner, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    summary = runner.summary()
    payload = {"meta": runner.meta, "summary": summary, "results": runner.results}

    with open(os.path.join(out_dir, "report.json"), "w") as f:
        json.dump(payload, f, indent=2)

    _write_feedback_md(payload, os.path.join(out_dir, "feedback.md"))
    _write_html(payload, os.path.join(out_dir, "report.html"))
    return payload


def _write_feedback_md(payload, path):
    m, s = payload["meta"], payload["summary"]
    lines = [
        "# Coffee Cue Test Bench — development feedback",
        "",
        f"- Target: {m['target']}",
        f"- Run: {m['started']} → {m.get('finished', '?')} (id {m['run_id']}, bench v{m['bench_version']})",
        f"- Result: **{s['pass']} pass / {s['fail']} FAIL / {s['warn']} warn / {s['skip']} skipped**",
        "",
        "This file is written to be handed to a developer or a Claude Code",
        "session working on the Coffee Cue repo. Each finding includes what was",
        "observed, the evidence, and the likely source files to start from.",
        "",
    ]
    fails = [r for r in payload["results"] if r["status"] == "fail"]
    warns = [r for r in payload["results"] if r["status"] == "warn"]

    def block(r):
        b = [f"### {r['suite']} · {r['name']}", "", r["detail"] or "(no detail)"]
        if r["evidence"]:
            b += ["", "Evidence:", "```", r["evidence"], "```"]
        if r["suggestion"]:
            b += ["", f"**Suggested next step:** {r['suggestion']}"]
        if r["refs"]:
            b += ["", "Likely files: " + ", ".join(f"`{x}`" for x in r["refs"])]
        b += [""]
        return b

    if fails:
        lines += ["## 🔴 Failures (fix first)", ""]
        for r in fails:
            lines += block(r)
    if warns:
        lines += ["## 🟡 Warnings (worth a look)", ""]
        for r in warns:
            lines += block(r)
    if not fails and not warns:
        lines += ["## ✅ No failures or warnings — all checks passed.", ""]

    skipped = [r for r in payload["results"] if r["status"] == "skip"]
    if skipped:
        lines += ["## ⏭ Skipped", ""]
        for r in skipped:
            lines += [f"- {r['suite']} · {r['name']}: {r['detail']}"]
        lines += [""]

    with open(path, "w") as f:
        f.write("\n".join(lines))


def _write_html(payload, path):
    m, s = payload["meta"], payload["summary"]
    colors = {"pass": "#16a34a", "fail": "#dc2626", "warn": "#d97706", "skip": "#6b7280"}
    rows = []
    for r in payload["results"]:
        ev = html.escape(r["evidence"] or "")
        sug = html.escape(r["suggestion"] or "")
        refs = ", ".join(html.escape(x) for x in r["refs"])
        extra = ""
        if ev or sug or refs:
            inner = ""
            if ev:
                inner += f"<pre>{ev}</pre>"
            if sug:
                inner += f"<div class='sug'>💡 {sug}</div>"
            if refs:
                inner += f"<div class='refs'>📁 {refs}</div>"
            extra = f"<details><summary>detail</summary>{inner}</details>"
        rows.append(
            f"<tr><td><span class='dot' style='background:{colors[r['status']]}'></span>"
            f"{r['status'].upper()}</td><td>{html.escape(r['suite'])}</td>"
            f"<td>{html.escape(r['name'])}</td>"
            f"<td>{html.escape(r['detail'] or '')}{extra}</td>"
            f"<td>{r['ms'] or ''}</td></tr>"
        )
    doc = f"""<!doctype html><html><head><meta charset="utf-8">
<title>Coffee Cue Test Bench — {html.escape(m['started'])}</title>
<style>
 body{{font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;margin:24px;color:#1f2937}}
 h1{{color:#7c3a06}} .tiles{{display:flex;gap:12px;margin:14px 0}}
 .tile{{border-radius:10px;padding:10px 18px;color:#fff;font-weight:700;font-size:20px}}
 .meta{{color:#6b7280;font-size:13px}}
 table{{border-collapse:collapse;width:100%;margin-top:14px;font-size:14px}}
 td,th{{border-bottom:1px solid #e5e7eb;padding:7px 9px;text-align:left;vertical-align:top}}
 .dot{{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px}}
 pre{{background:#f8f8f6;padding:8px;border-radius:6px;white-space:pre-wrap;font-size:12px}}
 details{{margin-top:4px}} .sug{{color:#92400e;margin-top:4px}} .refs{{color:#6b7280;font-size:12px;margin-top:2px}}
</style></head><body>
<h1>☕ Coffee Cue Test Bench</h1>
<div class="meta">Target {html.escape(m['target'])} · {html.escape(m['started'])} → {html.escape(m.get('finished','?'))} · run {m['run_id']} · bench v{m['bench_version']}</div>
<div class="tiles">
 <div class="tile" style="background:{colors['pass']}">{s['pass']} pass</div>
 <div class="tile" style="background:{colors['fail']}">{s['fail']} fail</div>
 <div class="tile" style="background:{colors['warn']}">{s['warn']} warn</div>
 <div class="tile" style="background:{colors['skip']}">{s['skip']} skipped</div>
</div>
<table><tr><th>Status</th><th>Suite</th><th>Check</th><th>Detail</th><th>ms</th></tr>
{''.join(rows)}
</table></body></html>"""
    with open(path, "w") as f:
        f.write(doc)
