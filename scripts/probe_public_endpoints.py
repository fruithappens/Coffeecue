#!/usr/bin/env python3
"""Probe every /api route WITHOUT a login and flag what answers (roadmap X7-4).

ONLY against a local or test server: it sends write requests ({} bodies).
Run that server with texts forced off:
    TESTING_MODE=True TWILIO_ACCOUNT_SID= TWILIO_AUTH_TOKEN= PORT=5098 python run_server.py
Route list (from the app itself):
    python -c "from app import create_app; ..."  (see docs/PUBLIC_ENDPOINTS.md)
Then:
    PROBE_BASE=http://localhost:5098 PROBE_RULES=/tmp/cupq_rules.json python scripts/probe_public_endpoints.py
Results: /tmp/cupq_probe_results.json (status, and any phone numbers,
emails or secrets found in what came back).
"""
import json, re, urllib.request, urllib.error, time
import os, sys
S = os.path.dirname(os.path.abspath(__file__))
BASE = os.environ.get("PROBE_BASE", "http://localhost:5098")
RULES = os.environ.get("PROBE_RULES", "/tmp/cupq_rules.json")
rules = [r for r in json.load(open(RULES)) if r["rule"].startswith("/api")]
PHONE = re.compile(r"(\+614\d{8}|\b04\d{2}\s?\d{3}\s?\d{3}\b)")
EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+")
SECRET = re.compile(r"(password_hash|password\"\s*:|auth_token|api_key|secret\"\s*:|refresh_token|access_token)", re.I)
def fill(rule):
    return re.sub(r"<(?:int:|path:|string:)?([^>]+)>", lambda m: "1", rule)
def req(method, url):
    data = b"{}" if method in ("POST", "PUT", "PATCH", "DELETE") else None
    r = urllib.request.Request(url, data=data, method=method, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(r, timeout=20) as resp:
            return resp.status, resp.read(200000).decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read(20000).decode("utf-8", "replace")
    except Exception as e:
        return 0, str(e)
SKIP = {"/api/event-data/wipe", "/api/event-data/erase-attendees", "/api/demo/wipe"}  # guarded, but never fire a wipe even locally
out = []
for r in rules:
    url = BASE + fill(r["rule"])
    for m in r["methods"]:
        if r["rule"] in SKIP and m != "GET": continue
        st, body = req(m, url)
        f = {"rule": r["rule"], "method": m, "status": st, "len": len(body)}
        if 200 <= st < 300 or st in (400, 422, 500):
            f["phones"] = len(set(PHONE.findall(body)))
            f["emails"] = len(set(e for e in EMAIL.findall(body) if not e.endswith(("cupq.app", "example.com", "coffeecue.com"))))
            f["secrets"] = sorted(set(x.lower() for x in SECRET.findall(body)))[:4]
            f["sample"] = body[:160].replace("\n", " ")
        out.append(f)
json.dump(out, open(os.environ.get("PROBE_OUT", "/tmp/cupq_probe_results.json"), "w"), indent=1)
from collections import Counter
print("probed:", len(out), "| by status:", dict(Counter(x["status"] for x in out)))
