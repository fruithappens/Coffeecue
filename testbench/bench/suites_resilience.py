"""
Coffee Cue Test Bench — RESILIENCE.

Everything here exists because of one incident (2026-08-18 04:33 UTC): a
customer's confirmed order was lost when a redeploy killed the request
mid-flight. Three things were wrong, and only the first was an accident:

  1. the deploy (process — do not ship while people are ordering)
  2. the reply was a dead end: "our system is experiencing issues" told
     the customer nothing about what to send, so the order never landed
  3. NOTHING surfaced the loss — the row sat at processed=false and no
     screen, alert or endpoint mentioned it

The bench cannot restart the server mid-request, so it cannot reproduce
(1). What it CAN pin down is that a dropped message stays visible and
that the customer is told how to resume — the parts that turn an
inevitable blip into a lost customer.
"""
from __future__ import annotations

from .core import result as R


def suite_resilience(rn):
    c, out = rn.client, []

    # 1. Dropped messages must be reportable. Without this endpoint the
    #    only evidence of a lost order was a boolean nobody could see.
    code, body, _ = c.get("/api/sms/dropped?hours=24")
    ok = code == 200 and isinstance(body, dict) and body.get("success")
    out.append(R("resilience", "dropped inbound messages are reportable",
                 "pass" if ok else "fail",
                 f"HTTP {code}, count={(body or {}).get('count') if isinstance(body, dict) else body!r}",
                 suggestion="" if ok else
                 "Without this, a customer whose message failed mid-processing "
                 "is invisible: the row sits at processed=false forever.",
                 refs=[] if ok else ["routes/consolidated_api_routes.py"]))

    if ok:
        # Anything sitting here right now is a real customer who never got
        # served. Warn rather than fail — it is a live-data observation,
        # not a code defect.
        n = body.get("count") or 0
        out.append(R("resilience", "no customer messages currently dropped",
                     "pass" if n == 0 else "warn",
                     f"{n} unprocessed inbound message(s) in the last 24h"
                     + ("" if n == 0 else f": {[d.get('phone') for d in body.get('dropped', [])][:5]}"),
                     suggestion="" if n == 0 else
                     "Each of these is someone whose order did not land. "
                     "Check whether they need contacting.",
                     refs=[]))

        # The grace window must exist, or a message being processed RIGHT
        # NOW would be reported as dropped and cause false alarms.
        gcode, gbody, _ = c.get("/api/sms/dropped?grace=3600&hours=24")
        graced = gcode == 200 and isinstance(gbody, dict) and \
            (gbody.get("count") or 0) <= (body.get("count") or 0)
        out.append(R("resilience", "grace window excludes in-flight messages",
                     "pass" if graced else "fail",
                     f"grace=3600 -> {(gbody or {}).get('count')} vs default -> {body.get('count')}",
                     suggestion="" if graced else
                     "A wider grace window must never report MORE dropped "
                     "messages, or the report will cry wolf during normal load.",
                     refs=[] if graced else ["routes/consolidated_api_routes.py"]))
    # 2. Diagnostics must not INVENT data. The logs endpoint used to
    #    synthesise "Sample log message 0".."9"; during the 04:33 incident
    #    that looked like a working log viewer and wasted an hour. A lying
    #    diagnostic is worse than an absent one.
    lcode, lbody, _ = c.get("/api/diagnostics/logs?limit=20")
    raw = str(lbody)
    fabricated = "Sample log message" in raw
    out.append(R("resilience", "diagnostics logs are real, not fabricated",
                 "fail" if fabricated else "pass",
                 f"HTTP {lcode}, "
                 + ("FABRICATED sample data returned" if fabricated
                    else f"available={(lbody or {}).get('available') if isinstance(lbody, dict) else 'n/a'}"),
                 suggestion="" if not fabricated else
                 "The endpoint is generating placeholder entries and "
                 "presenting them as system logs. During an incident this "
                 "sends the operator hunting in the wrong place.",
                 refs=[] if not fabricated else ["routes/support_api_routes.py"]))

    # An empty buffer is legitimate (it resets on redeploy) but the response
    # must SAY so, or an operator reads "no logs" as "nothing went wrong".
    if lcode == 200 and isinstance(lbody, dict):
        honest = bool(lbody.get("note"))
        out.append(R("resilience", "empty log window is explained, not implied",
                     "pass" if honest else "fail",
                     f"note={(lbody.get('note') or '')[:80]!r}",
                     suggestion="" if honest else
                     "Without a note, an empty list reads as 'nothing broke' "
                     "when it actually means 'nothing captured since deploy'.",
                     refs=[] if honest else ["routes/support_api_routes.py"]))
    # 3. CORS: an arbitrary site must not be handed access to the API.
    #    The app used to append '*' to the allowed origins on every Railway
    #    boot "for same-origin requests" — but same-origin never consults
    #    CORS, so that only ever granted OTHER sites access, and it silently
    #    overrode whatever CORS_ALLOWED_ORIGINS was set to.
    evil = "https://evil.example.com"
    hdrs = {}
    try:
        r = c.s.get(f"{c.base}/api/health", headers={"Origin": evil}, timeout=20)
        hdrs = {k.lower(): v for k, v in r.headers.items()}
    except Exception as e:
        out.append(R("resilience", "CORS headers readable", "warn", str(e)))
        return out

    echoed = hdrs.get("access-control-allow-origin", "")
    leaks = echoed == evil or echoed == "*"
    out.append(R("resilience", "API does not grant CORS to arbitrary origins",
                 "fail" if leaks else "pass",
                 f"Origin: {evil} -> Allow-Origin: {echoed!r}",
                 suggestion="" if not leaks else
                 "Any website can call this API from a visitor's browser. "
                 "Same-origin requests never use CORS, so a wildcard buys "
                 "the app's own UI nothing.",
                 refs=[] if not leaks else ["app.py"]))

    # Duplicated CORS headers are invalid and some browsers reject the
    # response outright — which would break a white-label frontend served
    # from its own domain. Two writers (Flask-CORS + a manual after_request)
    # were emitting one each.
    try:
        raw = c.s.get(f"{c.base}/api/health", headers={"Origin": evil}, timeout=20).raw
        dupes = [h for h in ("Access-Control-Allow-Credentials", "Access-Control-Allow-Methods")
                 if len(raw.headers.getlist(h)) > 1]
    except Exception:
        dupes = []
    out.append(R("resilience", "CORS headers are not sent twice",
                 "pass" if not dupes else "fail",
                 "no duplicates" if not dupes else f"duplicated: {dupes}",
                 suggestion="" if not dupes else
                 "Duplicate CORS headers are invalid; some browsers reject "
                 "the response, breaking cross-origin frontends.",
                 refs=[] if not dupes else ["app.py"]))
    return out


RESILIENCE_SUITES = [
    ("resilience", suite_resilience, True),
]
