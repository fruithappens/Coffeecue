"""
Coffee Cue Test Bench — EventsAir Survey Channel guards (BETA).

Read-only, always safe. The channel ships behind EA_SURVEY_CHANNEL_ENABLED
(default off), so these checks assert the HONEST state either way:

  - /api/ea/status responds and reports the flag truthfully
  - the webhook NEVER accepts an unsigned request:
      flag off  -> 503 (channel refuses work)
      flag on   -> 401 (signature required)
    A 2xx here in any state means unsigned order injection — the spec's
    hardest do-not — so that's an immediate fail.
"""
from __future__ import annotations

from .core import result

R = result


def suite_ea_channel(rn):
    c, out = rn.client, []

    code, body, _ = c.get("/api/ea/status")
    ok = code == 200 and isinstance(body, dict) and body.get("success") is True
    enabled = bool(isinstance(body, dict) and body.get("channel_enabled"))
    out.append(R("ea_channel", "status endpoint reports channel state",
                 "pass" if ok else "fail",
                 f"HTTP {code}, channel_enabled={enabled}",
                 refs=[] if ok else ["routes/ea_survey_routes.py"]))
    if not ok:
        return out

    wcode, wbody, _ = c.req(
        "POST", "/api/ea/webhook", auth=False,
        body={"correlationId": "zzbench-unsigned",
              "surveyResponseId": "zzbench-unsigned"})
    expected = 503 if not enabled else 401
    refused = wcode == expected
    out.append(R("ea_channel",
                 "unsigned webhook refused "
                 + ("(503: flag off)" if not enabled else "(401: bad signature)"),
                 "pass" if refused else "fail",
                 f"HTTP {wcode} (expected {expected})",
                 suggestion="" if refused else
                 "An unsigned webhook got through — anyone on the internet "
                 "could inject orders. Fix before enabling the channel.",
                 refs=[] if refused else ["routes/ea_survey_routes.py",
                                          "services/eventsair/survey.py"]))

    if not enabled:
        out.append(R("ea_channel", "beta channel end-to-end", "skip",
                     "EA_SURVEY_CHANNEL_ENABLED is off — test-order and "
                     "webhook-log checks activate when the flag goes on"))
        return out

    # Flag on: the log endpoint should answer (content may be empty).
    lcode, lbody, _ = c.get("/api/ea/webhook-log")
    lok = lcode == 200 and isinstance(lbody, dict) and "rows" in lbody
    out.append(R("ea_channel", "webhook log readable",
                 "pass" if lok else "fail", f"HTTP {lcode}",
                 refs=[] if lok else ["routes/ea_survey_routes.py"]))
    return out


EA_SUITES = [
    ("ea_channel", suite_ea_channel, True),
]
