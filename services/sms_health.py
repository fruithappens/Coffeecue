"""Is SMS actually working? — answered in one glance.

WHY THIS EXISTS
---------------
Steve arrived at the National Wine Centre demo and SMS was dead. It
started working again a few minutes later with no intervention. Nobody
could tell, at the time or afterwards, whether the backend was down,
Twilio was failing to reach us, or the orders were arriving and simply
not being displayed.

That is the actual problem. A failure you can see is an inconvenience;
a failure you cannot see is the one that happens in front of 400 people.

THE BLIND SPOT THIS CLOSES
--------------------------
The inbound webhook validates Twilio's signature BEFORE it writes the
message to `sms_messages`. So a rejected webhook leaves no row, no
reply and no trace anywhere a human can reach. From inside the app,
"Twilio never called us" and "Twilio called and we turned it away" look
identical — both are simply silence.

So the counters below are incremented at the very TOP of the webhook,
before any validation, and the rejects are counted separately. That is
the difference between the two diagnoses, and it is the one number that
was missing when this happened.

WHY UPTIME IS REPORTED
----------------------
The leading theory is a Railway cold start: the container idles down,
the first webhook after the quiet period hits a booting app, Twilio
gives up (~15s), and the message is dropped. That fits the symptom
exactly, including the unaided recovery.

If someone opens this on arrival and sees an uptime of two minutes,
that is the cold start, caught in the act. It costs one integer to be
able to prove or kill the theory instead of arguing about it.

Counters are in-memory and reset on restart. That is deliberate — a
reset counter IS the signal that the container restarted.
"""
from __future__ import annotations

import os
import threading
import time
from datetime import datetime, timezone

_lock = threading.Lock()

# Set at import, i.e. at process boot.
_BOOT_AT = time.time()

_state = {
    # Every arrival at the inbound webhook, counted before validation.
    "webhook_hits": 0,
    "webhook_last_at": None,
    # Arrivals we turned away because the Twilio signature did not verify.
    # A non-zero value here with hits > 0 means Twilio IS reaching us and
    # we are refusing it — a completely different fix from "wrong URL".
    "webhook_rejected": 0,
    "webhook_rejected_last_at": None,
    # Outbound sends that reached the provider (a real SID came back).
    "outbound_ok": 0,
    "outbound_last_at": None,
    "outbound_failed": 0,
    "outbound_failed_last_at": None,
}


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


def note_webhook_hit(accepted: bool = True):
    """Record an arrival at the inbound webhook.

    Call this BEFORE signature validation, then again with
    accepted=False on the reject path. Never raises — a broken counter
    must not be able to break SMS itself.
    """
    try:
        with _lock:
            if accepted:
                _state["webhook_hits"] += 1
                _state["webhook_last_at"] = _now_iso()
            else:
                _state["webhook_rejected"] += 1
                _state["webhook_rejected_last_at"] = _now_iso()
    except Exception:
        pass


# Fired at most once per boot so a failing sender doesn't spam. Reset the
# moment a send succeeds, so a LATER outage still alerts.
_alerted_outbound_down = False


def _outbound_is_down():
    # Sends are being attempted and NONE are getting out. Two-plus failures
    # with zero successes = systemic (the 2026-09-05 eventlet-DNS outage was
    # exactly this), not one bad number.
    return _state["outbound_failed"] >= 2 and _state["outbound_ok"] == 0


def _maybe_alert_outbound_down():
    """Best-effort email when outbound goes dark. Gated + rate-limited.

    Honest limit: in a TOTAL egress/DNS outage the email can't send either
    (it needs the network that's down) — that case is caught by the in-app
    banner, which rides the inbound path. This email is for PARTIAL failures
    (e.g. a Twilio account problem) where the box still reaches the internet.
    """
    global _alerted_outbound_down
    if _alerted_outbound_down or not _outbound_is_down():
        return
    _alerted_outbound_down = True  # once per boot regardless of send outcome
    to = os.getenv("ADMIN_ALERT_EMAIL", "").strip()
    if not to:
        return
    failed = _state["outbound_failed"]

    def _send():
        try:
            from services.email_utils import send_html_email
            send_html_email(
                to,
                "⚠️ Coffee Cue: SMS sending is FAILING",
                f"<p><b>Outbound SMS is failing on the live system</b> — "
                f"{failed} attempts, 0 delivered since the last restart.</p>"
                "<p>Anyone who opted into a ready-text is NOT getting it. "
                "Check the barista screen banner and connectivity.</p>",
            )
        except Exception:
            pass

    try:
        threading.Thread(target=_send, name="outbound-down-alert",
                         daemon=True).start()
    except Exception:
        pass


def note_outbound(ok: bool = True):
    """Record an outbound send attempt. Never raises."""
    global _alerted_outbound_down
    try:
        with _lock:
            if ok:
                _state["outbound_ok"] += 1
                _state["outbound_last_at"] = _now_iso()
                _alerted_outbound_down = False  # recovered — re-arm the alert
            else:
                _state["outbound_failed"] += 1
                _state["outbound_failed_last_at"] = _now_iso()
                _maybe_alert_outbound_down()
    except Exception:
        pass


def _minutes_since(iso_str):
    if not iso_str:
        return None
    try:
        then = datetime.fromisoformat(iso_str)
        if then.tzinfo is None:
            then = then.replace(tzinfo=timezone.utc)
        return round((datetime.now(timezone.utc) - then).total_seconds() / 60.0, 1)
    except Exception:
        return None


def _last_inbound_from_db(db):
    """Newest row in sms_messages, plus a 24h count.

    Read-only and cheap. Wrapped tightly: a health check that can crash
    or hang is worse than no health check, because it becomes one more
    thing to debug at the exact moment everything is already on fire.
    """
    out = {"last_at": None, "minutes_ago": None, "count_24h": None}
    try:
        cur = db.cursor()
        cur.execute("SELECT MAX(received_at) FROM sms_messages")
        row = cur.fetchone()
        val = (
            row[0]
            if row and not isinstance(row, dict)
            else (list(row.values())[0] if row else None)
        )
        if val is not None:
            out["last_at"] = val.isoformat() if hasattr(val, "isoformat") else str(val)
            out["minutes_ago"] = _minutes_since(out["last_at"])
        cur.execute(
            "SELECT COUNT(*) FROM sms_messages "
            "WHERE received_at >= NOW() - INTERVAL '24 hours'"
        )
        row = cur.fetchone()
        out["count_24h"] = (
            row[0]
            if row and not isinstance(row, dict)
            else (list(row.values())[0] if row else None)
        )
    except Exception as e:
        out["error"] = str(e)[:120]
    return out


def snapshot(db=None, messaging_service=None):
    """One dict answering 'is SMS working?'.

    Returns facts first and a verdict second, so a reader who distrusts
    the verdict can still see what it was based on.
    """
    with _lock:
        s = dict(_state)

    uptime_s = int(time.time() - _BOOT_AT)
    inbound = _last_inbound_from_db(db) if db is not None else {}

    testing_mode = None
    from_number = None
    if messaging_service is not None:
        testing_mode = bool(getattr(messaging_service, "testing_mode", False))
        from_number = getattr(messaging_service, "phone_number", None)

    # The verdict. Ordered most-alarming first, and each one names the
    # thing to go and do — a status word with no next action just makes
    # the reader ask us what it means.
    problems = []
    if testing_mode:
        problems.append(
            "TEST MODE: messages are being swallowed, not sent. "
            "Set TESTING_MODE=False and redeploy."
        )
    if s["webhook_rejected"] and s["webhook_rejected"] >= max(1, s["webhook_hits"]):
        problems.append(
            "Twilio is reaching us but EVERY webhook is being rejected as "
            "unsigned. Check TWILIO_AUTH_TOKEN matches the account that "
            "owns the number."
        )
    if inbound.get("error"):
        # Reporting "ok" while the database is unreachable is how a
        # health check becomes another thing that lies to you.
        problems.append(
            "Cannot read the message log: "
            + str(inbound["error"])
            + " — inbound figures below are unknown, not zero."
        )
    if uptime_s < 180:
        problems.append(
            f"App started {uptime_s}s ago — it is cold. A webhook that "
            "arrived during boot was dropped by Twilio and that order "
            "does not exist."
        )

    # The one an operator must see DURING service: texts are not going out.
    # Front of the list because it's the most urgent, and surfaced as its own
    # boolean so the barista banner can trip on it without parsing prose.
    outbound_down = _outbound_is_down()
    if outbound_down:
        problems.insert(
            0,
            f"SMS SENDING IS FAILING — {s['outbound_failed']} attempts since "
            "restart, 0 delivered. Anyone who asked for a text is NOT getting "
            "it. Call names / point people to the board.",
        )

    if problems:
        status = "warn"
    elif testing_mode is False and (s["webhook_hits"] or inbound.get("count_24h")):
        status = "ok"
    else:
        # Live, but nothing has come in yet, so nothing is proven either way.
        status = "unproven"

    return {
        "status": status,
        "outbound_down": outbound_down,
        "problems": problems,
        "testing_mode": testing_mode,
        "from_number": from_number,
        "uptime_seconds": uptime_s,
        "boot_at": datetime.fromtimestamp(_BOOT_AT, timezone.utc).isoformat(),
        "inbound": {
            "last_at": inbound.get("last_at"),
            "minutes_ago": inbound.get("minutes_ago"),
            "count_24h": inbound.get("count_24h"),
            "error": inbound.get("error"),
        },
        "webhook": {
            "hits_since_boot": s["webhook_hits"],
            "last_hit_at": s["webhook_last_at"],
            "last_hit_minutes_ago": _minutes_since(s["webhook_last_at"]),
            "rejected_since_boot": s["webhook_rejected"],
            "rejected_last_at": s["webhook_rejected_last_at"],
        },
        "outbound": {
            "sent_since_boot": s["outbound_ok"],
            "last_at": s["outbound_last_at"],
            "last_minutes_ago": _minutes_since(s["outbound_last_at"]),
            "failed_since_boot": s["outbound_failed"],
            "failed_last_at": s["outbound_failed_last_at"],
        },
        "public_url": os.getenv("RAILWAY_PUBLIC_DOMAIN")
        or os.getenv("PUBLIC_URL")
        or None,
    }
