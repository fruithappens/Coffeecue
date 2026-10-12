"""Attendee details erased on a schedule (roadmap L6-2).

The organiser sets "erase attendee details N days after they order"
(settings 'attendee_retention_days'; 0 = never, the default). Once a day
everything older than N days loses its personal details: names, phone
numbers, emails, notes, text conversations. What the report counts stays:
each order's drink, times, station and status, the text counts, feedback
ratings. Same rules as Runner > Settings > Retire this event > Erase
attendee details (routes/event_data_routes.py), applied by age instead of
all at once.

Not the EventsAir attendee list: that's a copy of the client's own
system, refreshed while the integration is on; the Retire button clears it.
"""
import json
import logging
import os

logger = logging.getLogger(__name__)

SETTING = "attendee_retention_days"
LAST_RUN = "attendee_retention_last_run"


def _order_keys():
    from routes.event_data_routes import _PERSONAL_ORDER_KEYS

    return list(_PERSONAL_ORDER_KEYS)


# (what, SQL with %(cutoff)s, and %(keys)s for the order keys)
STEPS = [
    ("orders: phone, notes, history",
     "UPDATE orders SET phone = '', barista_notes = NULL, edit_history = NULL, ea_response_id = NULL, "
     "payment_link = NULL, qr_code_url = NULL, last_modified_by = NULL "
     "WHERE created_at < %(cutoff)s AND (phone <> '' OR barista_notes IS NOT NULL OR edit_history IS NOT NULL)"),
    ("orders: name and contact inside each order",
     "UPDATE orders SET order_details = order_details - %(keys)s::text[] "
     "WHERE created_at < %(cutoff)s AND order_details ?| %(keys)s::text[]"),
    ("text conversations", "DELETE FROM conversation_states WHERE last_interaction < %(cutoff)s"),
    ("texts received", "DELETE FROM sms_messages WHERE received_at < %(cutoff)s"),
    ("per-order messages", "DELETE FROM order_messages WHERE sent_at < %(cutoff)s"),
    ("customer questions", "DELETE FROM customer_questions WHERE created_at < %(cutoff)s"),
    ("half-finished orders", "DELETE FROM partial_orders WHERE saved_at < %(cutoff)s"),
    ("saved customer preferences", "DELETE FROM customer_preferences WHERE last_order_date < %(cutoff)s"),
    ("texts sent: number and wording (counts kept)",
     "UPDATE sms_outbound_log SET to_number = NULL, body = NULL "
     "WHERE sent_at < %(cutoff)s AND (to_number IS NOT NULL OR body IS NOT NULL)"),
    ("loyalty: phone and notes",
     "UPDATE loyalty_transactions SET phone = '', notes = NULL "
     "WHERE created_at < %(cutoff)s AND (phone <> '' OR notes IS NOT NULL)"),
    ("feedback comments (ratings kept)",
     "UPDATE feedback SET comments = NULL WHERE created_at < %(cutoff)s AND comments IS NOT NULL"),
]


def _setting(cur, key, default=None):
    cur.execute("SELECT value FROM settings WHERE key = %s", (key,))
    row = cur.fetchone()
    if not row:
        return default
    v = row[0] if not isinstance(row, dict) else row["value"]
    try:
        return json.loads(v)
    except (TypeError, ValueError):
        return v


def get_days(cur):
    try:
        return max(0, int(_setting(cur, SETTING, 0) or 0))
    except (TypeError, ValueError):
        return 0


def run(conn, days=None, now_sql="NOW()"):
    """Erase personal details older than `days` (the setting if None).
    Each step in its own savepoint. Returns [{what, rows}] or [] when off."""
    cur = conn.cursor()
    days = get_days(cur) if days is None else int(days)
    if days <= 0:
        conn.rollback()
        return []
    cur.execute(f"SELECT {now_sql} - (%s || ' days')::interval", (str(days),))
    cutoff = cur.fetchone()[0]
    params = {"cutoff": cutoff, "keys": _order_keys()}
    done = []
    for i, (what, sql) in enumerate(STEPS):
        cur.execute(f"SAVEPOINT r_{i}")
        try:
            cur.execute(sql, params)
            done.append({"what": what, "rows": cur.rowcount})
            cur.execute(f"RELEASE SAVEPOINT r_{i}")
        except Exception as e:
            cur.execute(f"ROLLBACK TO SAVEPOINT r_{i}")
            done.append({"what": what, "rows": None, "skipped": str(e).split("\n")[0][:80]})
    cur.execute(
        "INSERT INTO settings(key, value) VALUES(%s, %s) "
        "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
        (LAST_RUN, json.dumps({"at": str(cutoff), "days": days, "rows": sum(d["rows"] or 0 for d in done)})))
    conn.commit()
    changed = sum(d["rows"] or 0 for d in done)
    if changed:
        logger.warning("[retention] erased attendee details older than %s days: %s", days, done)
    return done


def run_daily_if_due(conn):
    """Called once a minute by the service watch; runs at most once a day."""
    cur = conn.cursor()
    if get_days(cur) <= 0:
        conn.rollback()
        return None
    last = _setting(cur, LAST_RUN, None)
    cur.execute("SELECT NOW()")
    now = cur.fetchone()[0]
    conn.rollback()
    if isinstance(last, dict) and last.get("ran_at"):
        try:
            from datetime import datetime

            if (now - datetime.fromisoformat(last["ran_at"])).total_seconds() < 23 * 3600:
                return None
        except Exception:
            pass
    done = run(conn)
    cur = conn.cursor()
    rec = _setting(cur, LAST_RUN, {}) or {}
    rec["ran_at"] = now.isoformat()
    cur.execute("UPDATE settings SET value = %s WHERE key = %s", (json.dumps(rec), LAST_RUN))
    conn.commit()
    return done
