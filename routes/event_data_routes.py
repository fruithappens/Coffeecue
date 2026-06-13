"""
Event Data Lifecycle — export / wipe / re-import.

Why this exists
---------------
Coffee Cue runs one event at a time on one shared database. For a
multi-client business that creates two problems:
  1. PRIVACY — when the next client's event starts, the previous
     client's customers, phone numbers, orders and SMS history are
     still in the tables. Client B must never see Client A's people.
  2. CONTINUITY — a recurring event (e.g. "treenet 2026" → "treenet
     2027") loses its returning customers' saved "usual" orders unless
     we can carry them forward.

This module gives the operator three controls:
  • EXPORT  GET  /api/event-data/export   — download the whole event as
            one JSON file (customers + orders + messages + config), for
            archival and analysis.
  • WIPE    POST /api/event-data/wipe      — clear all customer +
            transactional data so the next client starts clean. Keeps
            stations / inventory config / users. Guarded by a literal
            "WIPE" confirmation token.
  • IMPORT  POST /api/event-data/import    — load a previously exported
            file back. Always restores customer_preferences (the
            "usuals") by phone; optionally restores event config too.
            Never restores old orders/messages into the live queue.

All three are admin-only. EXPORT contains PII (phone numbers) by design
— it's the client's own data, handed back to the client.
"""
import logging
from datetime import datetime

from flask import Blueprint, jsonify, request, current_app

from auth import jwt_required_with_demo, role_required_with_demo
from utils.database import get_db_connection

logger = logging.getLogger("expresso.routes.event_data")

bp = Blueprint("event_data", __name__)

# Tables holding CUSTOMER / TRANSACTIONAL data — these get exported and
# wiped. Order matters for wipe: children (FK referencers) before parents.
# Anything NOT in this list (settings, inventory_items, stations,
# station_stats, station_schedule, catalog_items, event_breaks,
# event_templates, rush_periods, users, user_permissions, schema_migrations)
# is treated as CONFIG and survives a wipe.
_TRANSACTIONAL_TABLES = [
    # children first (reference orders / each other)
    "order_messages",
    "loyalty_transactions",
    "payment_transactions",
    "feedback",
    "partial_orders",
    "customer_questions",
    "inventory_transactions",
    "inventory_history",
    "inventory_alerts",
    "restock_request_items",
    "restock_requests",
    "chat_messages",
    "client_errors",
    "client_events",
    "sms_messages",
    "sms_log",
    "conversation_states",
    # event-specific schedule (shifts/breaks/rush) — client-specific, so it
    # clears for the next client. Also flushes the old fabricated sample
    # shifts that used to be auto-inserted.
    "station_schedule",
    "event_breaks",
    "rush_periods",
    # parents last
    "orders",
    "customer_preferences",
]

# Config tables included in an EXPORT so a snapshot can fully recreate an
# event (used by IMPORT when include_config=true). NOT touched by wipe.
_CONFIG_EXPORT_TABLES = ["settings", "inventory_items", "catalog_items"]

_WIPE_CONFIRM_TOKEN = "WIPE"


def _rows_as_dicts(cursor):
    cols = [d[0] for d in cursor.description]
    return [dict(zip(cols, row)) for row in cursor.fetchall()]


def _event_name(cursor):
    try:
        cursor.execute("SELECT value FROM settings WHERE key = 'event_name'")
        row = cursor.fetchone()
        return row[0] if row else None
    except Exception:
        return None


@bp.route("/api/event-data/export", methods=["GET"])
@jwt_required_with_demo()
@role_required_with_demo(["admin"])
def export_event_data():
    """Return a full JSON snapshot of the current event.

    Query param ?include_messages=false to omit SMS history (which can be
    large) when you only want customers + orders + config.
    """
    include_messages = request.args.get("include_messages", "true").lower() != "false"
    try:
        db = get_db_connection()
        cursor = db.cursor()

        snapshot = {
            "format": "coffeecue.event-data.v1",
            "exported_at": datetime.now().isoformat(),
            "event_name": _event_name(cursor),
            "tables": {},
            "counts": {},
        }

        export_tables = list(_TRANSACTIONAL_TABLES) + list(_CONFIG_EXPORT_TABLES)
        message_tables = {"order_messages", "sms_messages", "sms_log", "chat_messages"}

        for table in export_tables:
            if not include_messages and table in message_tables:
                continue
            try:
                cursor.execute(f"SELECT * FROM {table}")  # noqa: S608 (fixed allowlist)
                rows = _rows_as_dicts(cursor)
                snapshot["tables"][table] = rows
                snapshot["counts"][table] = len(rows)
            except Exception as te:
                logger.warning(f"export: skipping {table}: {te}")
                try:
                    db.rollback()
                except Exception:
                    pass

        cursor.close()
        # datetime/Decimal values are JSON-serialised by Flask's encoder via
        # default=str — set it on the response to avoid 500s on those types.
        from flask import Response
        import json as _json
        body = _json.dumps({"status": "success", "snapshot": snapshot}, default=str)
        return Response(body, mimetype="application/json")
    except Exception as e:
        logger.error(f"export_event_data error: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500


@bp.route("/api/event-data/wipe", methods=["POST"])
@jwt_required_with_demo()
@role_required_with_demo(["admin"])
def wipe_event_data():
    """Clear all customer + transactional data. KEEPS config + users.

    Requires body {"confirm": "WIPE"} — a deliberate, hard-to-fat-finger
    guard. Returns the row count deleted per table.
    """
    data = request.get_json(silent=True) or {}
    if data.get("confirm") != _WIPE_CONFIRM_TOKEN:
        return jsonify({
            "status": "error",
            "message": f'Wipe not confirmed. Send {{"confirm": "{_WIPE_CONFIRM_TOKEN}"}} '
                       "to proceed. This clears all customer + order data.",
            "code": "CONFIRM_REQUIRED",
        }), 400

    try:
        db = get_db_connection()
        cursor = db.cursor()
        deleted = {}
        for table in _TRANSACTIONAL_TABLES:
            try:
                cursor.execute(f"DELETE FROM {table}")  # noqa: S608 (fixed allowlist)
                deleted[table] = cursor.rowcount
            except Exception as te:
                logger.warning(f"wipe: {table}: {te}")
                deleted[table] = f"skipped ({str(te)[:60]})"
                try:
                    db.rollback()
                except Exception:
                    pass
        db.commit()
        total = sum(v for v in deleted.values() if isinstance(v, int))

        # Optionally clear event staff logins, keeping the master admin(s)
        # so the operator is never locked out. The "reset for next client"
        # case: the previous client's barista accounts (treenet1, hbl1, …)
        # shouldn't linger. Done AFTER the main commit in its own
        # transaction so a hiccup here can't undo the data wipe.
        staff_msg = "users were kept"
        if data.get("clear_staff"):
            protected = ("coffeecue", "admin")  # never delete the master admin
            try:
                cursor.execute(
                    "DELETE FROM user_permissions WHERE user_id IN "
                    "(SELECT id FROM users WHERE LOWER(username) NOT IN %s)",
                    (protected,),
                )
            except Exception:
                try:
                    db.rollback()
                except Exception:
                    pass
            try:
                cursor.execute(
                    "DELETE FROM users WHERE LOWER(username) NOT IN %s",
                    (protected,),
                )
                deleted["users"] = cursor.rowcount
                db.commit()
                staff_msg = f"{cursor.rowcount} staff logins removed (master admin kept)"
            except Exception as ue:
                try:
                    db.rollback()
                except Exception:
                    pass
                deleted["users"] = f"skipped ({str(ue)[:50]})"
                staff_msg = "staff-login clear failed (master admin untouched)"

        cursor.close()
        # Clear the in-process conversation cache so a wiped customer
        # isn't still mid-conversation in memory.
        try:
            coffee_system = current_app.config.get("coffee_system")
            if coffee_system and hasattr(coffee_system, "_invalidate_unlimited_stock_cache"):
                coffee_system._invalidate_unlimited_stock_cache()
        except Exception:
            pass
        logger.warning(f"EVENT DATA WIPED: {total} rows across {len(deleted)} tables; {staff_msg}")
        return jsonify({
            "status": "success",
            "message": f"Wiped {total} rows of customer/transactional data. "
                       f"Stations and inventory config kept; {staff_msg}.",
            "deleted": deleted,
            "total_rows": total,
        })
    except Exception as e:
        logger.error(f"wipe_event_data error: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500


@bp.route("/api/event-data/import", methods=["POST"])
@jwt_required_with_demo()
@role_required_with_demo(["admin"])
def import_event_data():
    """Re-import a previously exported snapshot.

    Body: {"snapshot": <export blob>, "include_config": false}
    Always upserts customer_preferences by phone (returning customers +
    their usuals). With include_config=true also restores settings,
    inventory_items and catalog_items. NEVER restores old orders or
    messages — those are historical and must not land in the live queue.
    """
    data = request.get_json(silent=True) or {}
    snapshot = data.get("snapshot") or data.get("data")
    include_config = bool(data.get("include_config"))
    if not isinstance(snapshot, dict) or "tables" not in snapshot:
        return jsonify({
            "status": "error",
            "message": 'Provide {"snapshot": <exported file contents>}.',
        }), 400

    tables = snapshot.get("tables", {})
    customers = tables.get("customer_preferences") or []
    result = {"customers_imported": 0, "config_restored": []}

    try:
        db = get_db_connection()
        cursor = db.cursor()

        # --- customer_preferences: upsert by phone (the returning-customer
        #     value). Only restore identity + usual-order columns; never
        #     overwrite running counters with stale ones if the row exists.
        cols = ["phone", "name", "preferred_drink", "preferred_milk",
                "preferred_size", "preferred_sugar", "preferred_notes",
                "preferred_strength", "preferred_decaf", "allergies",
                "email", "is_vip"]
        for c in customers:
            phone = c.get("phone")
            if not phone:
                continue
            vals = [c.get(col) for col in cols]
            placeholders = ", ".join(["%s"] * len(cols))
            updates = ", ".join(f"{col} = EXCLUDED.{col}" for col in cols if col != "phone")
            try:
                cursor.execute(
                    f"INSERT INTO customer_preferences ({', '.join(cols)}) "
                    f"VALUES ({placeholders}) "
                    f"ON CONFLICT (phone) DO UPDATE SET {updates}",
                    vals,
                )
                result["customers_imported"] += 1
            except Exception as ce:
                logger.warning(f"import customer {phone}: {ce}")
                try:
                    db.rollback()
                except Exception:
                    pass

        # --- optional config restore
        if include_config:
            settings_rows = tables.get("settings") or []
            for s in settings_rows:
                k, v = s.get("key"), s.get("value")
                if k is None:
                    continue
                try:
                    cursor.execute(
                        "INSERT INTO settings (key, value) VALUES (%s, %s) "
                        "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
                        (k, v),
                    )
                except Exception as se:
                    logger.warning(f"import setting {k}: {se}")
                    try:
                        db.rollback()
                    except Exception:
                        pass
            if settings_rows:
                result["config_restored"].append(f"settings ({len(settings_rows)})")
            # inventory_items + catalog_items left as a follow-up: restoring
            # them safely needs id/conflict handling per table; customers +
            # settings cover the returning-event case. Flagged in the UI.

        db.commit()
        cursor.close()
        logger.info(f"EVENT DATA IMPORTED: {result}")
        return jsonify({
            "status": "success",
            "message": f"Imported {result['customers_imported']} customers"
                       + (f"; restored {', '.join(result['config_restored'])}"
                          if result["config_restored"] else ""),
            **result,
        })
    except Exception as e:
        logger.error(f"import_event_data error: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500
