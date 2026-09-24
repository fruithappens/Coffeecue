"""The SMS meter: every text this event sends, counted the way it is billed.

Why this exists. Steve's buyers are afraid of an open-ended text bill ("what
if it's $10,000?"). The answer he chose on 22 Sep: texts are INCLUDED in each
plan up to an allowance, the organiser can set a HARD CAP, and the runner can
see a meter. Before this file there was no honest count to show -- the only
counters were inbound-only or in-memory, and nothing wrote down what was
actually sent.

Three jobs, all here so there is one answer to "how many texts?":

  record()   -- one row in sms_outbound_log per text, with its segment
                count. Called from the one function every proactive send
                passes through (MessagingService.send_message) and from the
                inbound webhooks, whose TwiML replies are billed texts too.
  decide()   -- before an automatic text, may it go? As the cap nears the
                nice-to-have texts stop first, then the rest; see LADDER.
  snapshot() -- the numbers the runner's Text meter shows.

Units. The meter counts SEGMENTS, because that is what the provider bills: a
plain-ASCII text up to 160 characters is one; an emoji or a curly quote
turns the whole message into UCS-2 and halves the room (see
[[expresso-sms-cost]]). Almost every CupQ text is one segment, so for the
organiser "texts" and "segments" read the same -- until someone pastes an
emoji into a broadcast, which is exactly when the difference matters.

Fail-open throughout. A broken meter must never be the reason a customer
does not hear their coffee is ready: any error in decide() says "send", and
any error in record() is logged and swallowed. It opens its own pooled
connection for every call because send_message runs on a background thread
for ready texts, where the shared singleton connection is not safe.
"""
import json
import logging
import os
from datetime import datetime, timezone

logger = logging.getLogger("expresso.sms_meter")

SETTING_KEY = "sms_meter"

# What each kind of text is, and where on the ladder it stops.
#
#   AT_WARN  -- stops once the event has used WARN_AT of its cap. The texts
#               a customer barely notices missing: "we've started your
#               coffee", the pickup nudge, the post-coffee survey.
#   AT_CAP   -- stops at the cap. Everything else automatic: ready texts,
#               confirmations, broadcasts, notices. The customer still has
#               the board and the phone page -- that is the fallback Steve
#               signed off, not silence.
#   NEVER    -- a person deliberately chose to send this one text (answering
#               a customer's question, a manual message, a test). Counted,
#               never blocked: a cap that stops staff talking to a customer
#               would be worse than the bill it saves.
#
# Replies inside the text-ordering conversation are also NEVER: they answer
# a customer who texted in, mid-order. Refusing them would leave someone
# half-way through ordering with no answer. They are counted, so the meter
# is honest about them, and the abuse gate already bounds how many one
# number can cause.
AT_WARN = "warn"
AT_CAP = "cap"
NEVER = "never"

KINDS = {
    "started": AT_WARN,
    "reminder": AT_WARN,
    "survey": AT_WARN,
    "ready": AT_CAP,
    "confirmation": AT_CAP,
    "broadcast": AT_CAP,
    "notice": AT_CAP,
    "other": AT_CAP,
    "reply": NEVER,
    "manual": NEVER,
    "question_reply": NEVER,
    "test": NEVER,
}

# Plain words for the runner. Kept beside KINDS so a new kind cannot be
# added without a name a person can read.
KIND_LABELS = {
    "started": "We've started your coffee",
    "reminder": "Pickup reminders",
    "survey": "Survey follow-ups",
    "ready": "Your coffee is ready",
    "confirmation": "Order confirmations",
    "broadcast": "Text blasts",
    "notice": "Tell everyone (by text)",
    "other": "Other automatic texts",
    "reply": "Replies while ordering by text",
    "manual": "Sent by staff",
    "question_reply": "Answers to customer questions",
    "test": "Test texts",
}

WARN_AT = 0.9

# Statuses. Only SENT and SIMULATED count toward the meter: a text the
# provider refused was not billed, and a held one was never sent.
SENT = "sent"
SIMULATED = "simulated"  # TESTING_MODE: would have been sent
FAILED = "failed"
HELD = "held"  # stopped by the cap
COUNTED = (SENT, SIMULATED)

# GSM 03.38. Characters in BASIC cost one septet; EXTENDED cost two (an
# escape plus the character). Anything outside both forces UCS-2.
_GSM_BASIC = set(
    "@£$¥èéùìòÇ\nØø\rÅå"
    "Δ_ΦΓΛΩΠΨΣΘΞÆæßÉ"
    " !\"#¤%&'()*+,-./0123456789:;<=>?"
    "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§"
    "¿abcdefghijklmnopqrstuvwxyzäöñüà"
)
_GSM_EXTENDED = set("^{}\\[~]|€\f")


def segments(body):
    """How many billed segments `body` is.

    GSM-7: 160 septets fit in one, 153 per segment once it splits.
    UCS-2: 70 characters in one, 67 per segment once it splits, counted in
    UTF-16 code units (so an emoji is two).
    """
    text = str(body or "")
    if not text:
        return 0
    if all(c in _GSM_BASIC or c in _GSM_EXTENDED for c in text):
        units = sum(2 if c in _GSM_EXTENDED else 1 for c in text)
        single, multi = 160, 153
    else:
        units = len(text.encode("utf-16-le")) // 2
        single, multi = 70, 67
    if units <= single:
        return 1
    return -(-units // multi)


def is_gsm(body):
    return all(c in _GSM_BASIC or c in _GSM_EXTENDED for c in str(body or ""))


# ---------------------------------------------------------------------------
# Connection handling -- one pooled connection per call, always returned.
# ---------------------------------------------------------------------------


def _conn():
    from utils.database import get_db_connection

    return get_db_connection()


def _release(conn):
    try:
        from utils.database import close_connection

        close_connection(conn)
    except Exception:
        pass


def _one(cur):
    row = cur.fetchone()
    if row is None:
        return None
    return list(row.values())[0] if isinstance(row, dict) else row[0]


def _utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)


# ---------------------------------------------------------------------------
# Settings: {"cap": int | null, "since": "ISO UTC" | null}
# ---------------------------------------------------------------------------


def _read_config(cur):
    cur.execute("SELECT value FROM settings WHERE key = %s", (SETTING_KEY,))
    raw = _one(cur)
    try:
        cfg = json.loads(raw) if raw else {}
    except (TypeError, ValueError):
        cfg = {}
    return cfg if isinstance(cfg, dict) else {}


def _write_config(conn, cfg, by=None):
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO settings (key, value, description, updated_at, updated_by)
        VALUES (%s, %s, %s, NOW(), %s)
        ON CONFLICT (key) DO UPDATE
            SET value = EXCLUDED.value,
                updated_at = NOW(),
                updated_by = EXCLUDED.updated_by
        """,
        (
            SETTING_KEY,
            json.dumps(cfg),
            "SMS meter: organiser's cap and when this count started",
            by,
        ),
    )
    conn.commit()


def _since(cfg):
    raw = cfg.get("since")
    if not raw:
        return None
    try:
        return datetime.fromisoformat(str(raw).replace("Z", ""))
    except ValueError:
        return None


def _allowance(conn):
    try:
        from utils.plan_limits import get_limits

        return get_limits(conn).get("sms")
    except Exception as e:
        logger.debug("sms_meter: allowance read failed: %s", e)
        return None


def _effective_cap(cfg, allowance):
    """The organiser's cap if they set one, else the plan's allowance, else
    none. No tier and no cap -- every instance today -- means the meter
    counts and never stops anything."""
    cap = cfg.get("cap")
    if cap is not None:
        try:
            cap = int(cap)
            return cap if cap >= 0 else None
        except (TypeError, ValueError):
            pass
    return allowance


def _used(cur, since):
    if since is not None:
        cur.execute(
            "SELECT COALESCE(SUM(segments), 0) FROM sms_outbound_log "
            "WHERE status IN %s AND sent_at >= %s",
            (COUNTED, since),
        )
    else:
        cur.execute(
            "SELECT COALESCE(SUM(segments), 0) FROM sms_outbound_log "
            "WHERE status IN %s",
            (COUNTED,),
        )
    return int(_one(cur) or 0)


# ---------------------------------------------------------------------------
# The three jobs
# ---------------------------------------------------------------------------


def decide(kind, body=None):
    """(allowed, reason). `reason` is a short plain-English line when a text
    is held, for the log and the barista's per-order Messages view.

    A text that would cross the line is held too: a 3-segment broadcast
    with 2 segments left would otherwise overshoot the cap.
    """
    tier = KINDS.get(kind, AT_CAP)
    if tier == NEVER:
        return True, None
    conn = None
    try:
        conn = _conn()
        cur = conn.cursor()
        cfg = _read_config(cur)
        cap = _effective_cap(cfg, _allowance(conn))
        if cap is None:
            return True, None
        used = _used(cur, _since(cfg))
        cost = segments(body) if body else 1
        line = cap * WARN_AT if tier == AT_WARN else cap
        if used + cost > line:
            if tier == AT_WARN:
                return False, (
                    f"held: text meter past {int(WARN_AT * 100)}% " f"({used} of {cap})"
                )
            return False, f"held: text limit reached ({used} of {cap})"
        return True, None
    except Exception as e:
        logger.warning("sms_meter: decide failed, sending anyway: %s", e)
        return True, None
    finally:
        if conn is not None:
            _release(conn)


def record(to, body, kind, status, provider_id=None):
    """One row per text. Never raises."""
    conn = None
    try:
        conn = _conn()
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO sms_outbound_log
                (to_number, kind, status, segments, chars, gsm, provider_id, body)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                str(to or "")[:32],
                (kind or "other")[:32],
                status,
                segments(body) if status != HELD else 0,
                len(str(body or "")),
                is_gsm(body),
                (str(provider_id)[:64] if provider_id else None),
                str(body or "")[:1600],
            ),
        )
        conn.commit()
    except Exception as e:
        logger.warning("sms_meter: could not record a %s text: %s", kind, e)
        try:
            conn.rollback()
        except Exception:
            pass
    finally:
        if conn is not None:
            _release(conn)


def snapshot():
    """Everything the runner's Text meter shows."""
    conn = _conn()
    try:
        cur = conn.cursor()
        cfg = _read_config(cur)
        since = _since(cfg)
        allowance = _allowance(conn)
        cap = _effective_cap(cfg, allowance)
        tier = None
        try:
            from utils.plan_limits import _setting

            tier = _setting(conn, "plan_tier")
        except Exception:
            pass

        where, params = "", ()
        if since is not None:
            where, params = "WHERE sent_at >= %s", (since,)
        cur.execute(
            f"""
            SELECT kind, status, COUNT(*), COALESCE(SUM(segments), 0),
                   COUNT(*) FILTER (WHERE NOT gsm)
            FROM sms_outbound_log {where}
            GROUP BY kind, status
            """,
            params,
        )
        by_kind = {}
        totals = {
            "segments": 0,
            "texts": 0,
            "held": 0,
            "failed": 0,
            "simulated": 0,
            "not_plain": 0,
        }
        for row in cur.fetchall():
            vals = list(row.values()) if isinstance(row, dict) else list(row)
            kind, status, n, segs, not_plain = vals
            k = by_kind.setdefault(
                kind,
                {
                    "kind": kind,
                    "label": KIND_LABELS.get(kind, kind),
                    "stops": KINDS.get(kind, AT_CAP),
                    "texts": 0,
                    "segments": 0,
                    "held": 0,
                    "failed": 0,
                },
            )
            if status in COUNTED:
                k["texts"] += n
                k["segments"] += int(segs)
                totals["texts"] += n
                totals["segments"] += int(segs)
                totals["not_plain"] += not_plain
                if status == SIMULATED:
                    totals["simulated"] += n
            elif status == HELD:
                k["held"] += n
                totals["held"] += n
            elif status == FAILED:
                k["failed"] += n
                totals["failed"] += n

        cur.execute(
            f"SELECT MIN(sent_at), MAX(sent_at) FROM sms_outbound_log {where}",
            params,
        )
        row = cur.fetchone()
        first, last = (
            (list(row.values()) if isinstance(row, dict) else list(row))
            if row
            else (None, None)
        )

        used = totals["segments"]
        if cap is None:
            state = "uncapped"
        elif used >= cap:
            state = "capped"
        elif used >= cap * WARN_AT:
            state = "warn"
        else:
            state = "ok"

        return {
            "plan_tier": tier,
            "allowance": allowance,
            "cap": cap,
            "cap_is_custom": cfg.get("cap") is not None,
            "warn_at": WARN_AT,
            "state": state,
            "used": used,
            "remaining": (max(cap - used, 0) if cap is not None else None),
            "since": since.isoformat() + "Z" if since else None,
            "first_at": first.isoformat() + "Z" if first else None,
            "last_at": last.isoformat() + "Z" if last else None,
            "totals": totals,
            "by_kind": sorted(
                by_kind.values(), key=lambda k: (-k["segments"], -k["held"])
            ),
            "testing_mode": os.environ.get("TESTING_MODE", "").lower()
            in ("1", "true", "yes"),
        }
    finally:
        _release(conn)


def set_cap(cap, by=None):
    """cap: a whole number of segments, or None to follow the plan."""
    conn = _conn()
    try:
        cur = conn.cursor()
        cfg = _read_config(cur)
        cfg["cap"] = cap
        _write_config(conn, cfg, by)
    finally:
        _release(conn)


def start_new_count(by=None):
    """Start the meter from zero -- for the next event on this instance.
    Keeps every logged row; only moves the line the meter counts from."""
    conn = _conn()
    try:
        cur = conn.cursor()
        cfg = _read_config(cur)
        cfg["since"] = _utcnow().isoformat()
        _write_config(conn, cfg, by)
    finally:
        _release(conn)


def record_twiml(to, twiml, kind="reply"):
    """Log each <Message> in a TwiML reply. The provider sends these on our
    behalf and bills them like any other text, but they never pass through
    send_message, so without this the meter would miss most of an SMS
    order's cost."""
    try:
        import xml.etree.ElementTree as ET

        root = ET.fromstring(twiml)
    except Exception:
        return
    for msg in root.iter("Message"):
        body = "".join(msg.itertext())
        if body.strip():
            record(to, body, kind, SENT)
