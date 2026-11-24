"""The event report, emailed to the client the morning after (roadmap U4-11).

Runner > Report: the organiser enters the client's email and the first and
last event day. From 9 am (event time) the day after the last day, the
report is emailed once, with a link to a 3-question feedback form whose
answers land in System > Enquiries. Off until it's set up: nothing guesses
which days were the event.

The client's version leaves out what is ours (app errors, text costs,
suggestions); Print shows the full one.
"""
import json
import logging
import secrets
from datetime import datetime, timedelta, timezone
from html import escape

from utils import event_time

logger = logging.getLogger("expresso.client_report")

KV_KEY = "client_report"
LINKS_KEY = "client_feedback_links"
SEND_HOUR = 9
MAX_TRIES = 3
GIVE_UP_DAYS = 7  # a copy switched on weeks later doesn't email an old event
LINK_DAYS = 60
MAX_LINKS = 20


def _now():
    return datetime.now(timezone.utc)


def _iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def is_due(cfg, local_now):
    """True when the report should go out now. local_now: event-time datetime."""
    if not cfg or not cfg.get("on") or cfg.get("sent_at") or not cfg.get("email"):
        return False
    if int(cfg.get("tries") or 0) >= MAX_TRIES:
        return False
    last = event_time.parse_date(cfg.get("to"))
    if not last or not event_time.parse_date(cfg.get("from")):
        return False
    day_after = last + timedelta(days=1)
    today = local_now.date()
    if today < day_after or today > last + timedelta(days=GIVE_UP_DAYS):
        return False
    return today > day_after or local_now.hour >= SEND_HOUR


def report_data(app, first, last):
    """The same numbers the Report screen shows, for any days."""
    import inspect

    from routes.api.reports import get_today_report

    with app.test_request_context(f"/api/reports/today?from={first}&to={last}"):
        resp = inspect.unwrap(get_today_report)()
        if isinstance(resp, tuple):
            resp = resp[0]
        data = resp.get_json() or {}
    if not data.get("success"):
        raise RuntimeError(data.get("error") or "the report could not be built")
    return data


def _hour(h):
    return f"{h % 12 or 12} {'am' if h < 12 else 'pm'}"


def _day(d):
    return f"{d.day} {d.strftime('%B %Y')}"


def _when(first, last):
    a, b = event_time.parse_date(first), event_time.parse_date(last)
    return _day(a) if a == b else f"{_day(a)} to {_day(b)}"


def served(data):
    """Coffees that weren't cancelled."""
    status = data.get("status_breakdown") or {}
    return max(0, int(data.get("total_orders") or 0) - int(status.get("cancelled") or 0))


def render(data, event_name, first, last, feedback_link=None):
    """The client's email. Tables and inline styles: mail apps drop the rest."""
    cell = "padding:8px 12px;border-bottom:1px solid #eee;text-align:left"

    def table(head, rows):
        if not rows:
            return ""
        body = "".join(
            f"<tr><td style='{cell}'>{escape(str(a))}</td>"
            f"<td style='{cell};text-align:right'>{escape(str(b))}</td></tr>"
            for a, b in rows
        )
        return f"<h2 style='font-size:16px;margin:28px 0 6px'>{head}</h2>" \
               f"<table style='width:100%;border-collapse:collapse'>{body}</table>"

    wait, peak = data.get("avg_wait_min"), data.get("peak_hour") or {}
    top = [("Coffees ordered", served(data))]
    if wait is not None:
        top.append(("Average wait until ready", f"{wait} min"))
    if peak.get("hour") is not None:
        top.append(("Busiest hour", f"from {_hour(int(peak['hour']))} ({peak.get('orders', 0)} coffees)"))
    stations = data.get("per_station") or []
    if stations:
        top.append(("Stations", len(stations)))
    drinks = [(str(x["drink"] or "other").title(), x["orders"]) for x in data.get("top_drinks") or []]
    milks = [(str(x["milk"] or "other").title(), x["orders"])
             for x in ((data.get("milk") or {}).get("by_milk") or [])[:7]]
    ask = ""
    if feedback_link:
        ask = (
            "<p style='margin:32px 0 8px'>How did it go? Three short questions:</p>"
            f"<p><a href='{escape(feedback_link, quote=True)}' style='display:inline-block;padding:12px 20px;"
            "background:#3B2A20;color:#fff;border-radius:8px;text-decoration:none;font-weight:bold'>"
            "Tell us how it went</a></p>"
        )
    return (
        "<div style=\"font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;max-width:600px;"
        "margin:0 auto;padding:16px;color:#222\">"
        f"<h1 style='font-size:22px;margin:0'>{escape(event_name)}</h1>"
        f"<p style='color:#666;margin:4px 0 0'>Coffee report, {escape(_when(first, last))}</p>"
        + table("At a glance", top) + table("Most popular drinks", drinks) + table("Milk", milks) + ask
        + "<p style='color:#888;font-size:12px;margin-top:32px'>Sent by CupQ. Reply to this email with any questions.</p></div>"
    )


# -- feedback links ---------------------------------------------------------

def new_link(links, event_name, email, now=None):
    """(token, links with it added), oldest dropped."""
    token = secrets.token_urlsafe(18)
    row = {"token": token, "event": event_name, "email": email, "made": _iso(now or _now())}
    return token, ([row] + list(links or []))[:MAX_LINKS]


def find_link(links, token, now=None):
    cutoff = _iso((now or _now()) - timedelta(days=LINK_DAYS))
    for row in links or []:
        if secrets.compare_digest(str(row.get("token") or "").encode(), str(token or "").encode()):
            return row if str(row.get("made") or "") >= cutoff else None
    return None


# -- sending ----------------------------------------------------------------

def _get(cur, key):
    cur.execute("SELECT value FROM settings WHERE key = %s", (key,))
    row = cur.fetchone()
    raw = (row.get("value") if isinstance(row, dict) else row[0]) if row else None
    try:
        return json.loads(raw) if isinstance(raw, str) else raw
    except ValueError:
        return raw


def _put(cur, key, value):
    cur.execute(
        "INSERT INTO settings (key, value) VALUES (%s, %s) "
        "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
        (key, json.dumps(value)),
    )


def event_name_of(cur):
    b = _get(cur, "branding_settings")
    name = b.get("event_name") if isinstance(b, dict) else None
    return str(name or _get(cur, "event_name") or "CupQ")


def send(app, conn, to, first, last, base_url=None, subject=None):
    """Build and email the report. Returns the EmailResult. Raises if the
    report can't be built."""
    from services.email_utils import email_enabled, send_html_email

    cur = conn.cursor()
    event = event_name_of(cur)
    conn.rollback()
    data = report_data(app, first, last)
    link = None
    if base_url and email_enabled():
        token, links = new_link(_get(cur, LINKS_KEY) or [], event, to)
        _put(cur, LINKS_KEY, links)
        conn.commit()
        link = f"{base_url}/event-feedback/{token}"
    html = render(data, event, first, last, link)
    return send_html_email(
        to=to, subject=subject or f"{event}: coffee report", html_body=html,
        text_fallback=f"{event}: coffee report, {_when(first, last)}. {served(data)} coffees ordered."
        + (f" How did it go? {link}" if link else ""),
    )


def run_if_due(app, conn, now=None):
    """Called hourly. Sends at most once; three tries if sending fails.
    Returns True when it was sent."""
    cur = conn.cursor()
    try:
        tz = event_time.resolve_zone(lambda k, d: _get(cur, k) or d)
        local = (now or _now()).astimezone(event_time.zone_of(tz))
        cur.execute("SELECT value FROM settings WHERE key = %s FOR UPDATE", (KV_KEY,))
        cfg = _get(cur, KV_KEY)
        if not isinstance(cfg, dict) or not is_due(cfg, local):
            conn.rollback()
            return False
        # Counted before sending, so a crash mid-send can't repeat for ever.
        cfg["tries"] = int(cfg.get("tries") or 0) + 1
        _put(cur, KV_KEY, cfg)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    try:
        result = send(app, conn, cfg["email"], cfg["from"], cfg["to"], cfg.get("base_url"))
        sent, why = bool(result.ok and result.sent), result.detail
    except Exception as e:
        conn.rollback()
        sent, why = False, str(e)
    # Only the fields this owns, and only if it's still the same event.
    fresh = _get(cur, KV_KEY)
    if isinstance(fresh, dict) and all(fresh.get(k) == cfg.get(k) for k in ("email", "from", "to")):
        fresh["sent_at"] = _iso(_now()) if sent else None
        fresh["error"] = None if sent else str(why)[:200]
        _put(cur, KV_KEY, fresh)
    conn.commit()
    if sent:
        logger.info("[client-report] sent for %s to %s", cfg["from"], cfg["to"])
    else:
        logger.warning("[client-report] not sent (try %s): %s", cfg["tries"], why)
        if cfg["tries"] >= MAX_TRIES:
            from services.admin_alerts import send_admin_alert

            send_admin_alert("CLIENT_REPORT_FAILED", "critical",
                             "CupQ: the event report couldn't be emailed to the client. Send it from Runner > Report.")
    return sent
