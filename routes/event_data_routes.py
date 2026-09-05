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
import json as _json
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


def build_snapshot(db, include_messages=True):
    """The snapshot itself, with no request and no Flask around it.

    Pulled out of the endpoint so the scheduled server-side backup builds
    the SAME thing an operator gets from Export. Two implementations of
    "what is a backup" would drift, and the day you find out is the day
    you are restoring one.
    """
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
            # A table that does not exist is not a failed backup -- it is
            # a feature this install never set up. Roll back so the failed
            # statement cannot poison the rest of the export.
            logger.warning(f"export: skipping {table}: {te}")
            try:
                db.rollback()
            except Exception:
                pass
    cursor.close()
    return snapshot


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
        snapshot = build_snapshot(db, include_messages)
        from flask import Response
        body = _json.dumps({"status": "success", "snapshot": snapshot}, default=str)
        return Response(body, mimetype="application/json")
    except Exception as e:
        logger.error(f"export_event_data error: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500


@bp.route("/api/event-data/backups", methods=["GET"])
@jwt_required_with_demo()
@role_required_with_demo(["admin"])
def list_backups():
    """What the server has backed up on its own.

    `on_volume` is the field that matters: false means these are on
    ephemeral container storage and the next deploy takes them with it.
    Reported rather than hidden, so "we have backups" can be checked
    instead of assumed.
    """
    import os
    from services.backup_scheduler import backup_dir, on_volume
    path = backup_dir()
    out = []
    try:
        for name in sorted(os.listdir(path), reverse=True):
            if not (name.startswith("auto-") and name.endswith(".json.gz")):
                continue
            full = os.path.join(path, name)
            try:
                out.append({"name": name, "bytes": os.path.getsize(full),
                            "taken_at": datetime.fromtimestamp(
                                os.path.getmtime(full)).isoformat()})
            except OSError:
                continue
    except Exception as e:
        logger.warning(f"list_backups: {e}")
    return jsonify({"status": "success", "on_volume": on_volume(),
                    "directory": path, "count": len(out), "backups": out})


@bp.route("/api/event-data/backups/<path:name>", methods=["GET"])
@jwt_required_with_demo()
@role_required_with_demo(["admin"])
def download_backup(name):
    """Hand one back, so the laptop can pull down what it missed.

    The name is matched against the directory listing rather than joined
    onto a path -- a downloadable filename from a URL is the classic way
    to read /etc/passwd, and an allowlist cannot be talked into it.
    """
    import os
    from flask import Response
    from services.backup_scheduler import backup_dir
    path = backup_dir()
    try:
        allowed = {n for n in os.listdir(path)
                   if n.startswith("auto-") and n.endswith(".json.gz")}
    except Exception:
        allowed = set()
    if name not in allowed:
        return jsonify({"status": "error", "message": "no such backup"}), 404
    try:
        with open(os.path.join(path, name), "rb") as fh:
            body = fh.read()
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500
    return Response(body, mimetype="application/gzip", headers={
        "Content-Disposition": f'attachment; filename="{name}"'})


@bp.route("/api/event-data/backups/run", methods=["POST"])
@jwt_required_with_demo()
@role_required_with_demo(["admin"])
def run_backup_now():
    """Take one immediately. For 'is this actually working?', which is a
    question worth being able to answer without waiting an hour."""
    from flask import current_app
    from services.backup_scheduler import take_backup
    msg = take_backup(current_app)
    return jsonify({"status": "success",
                    "message": msg or "no change since the last backup - skipped",
                    "wrote": bool(msg)})


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

    # BACK UP FIRST, ALWAYS.
    #
    # The wipe used to run straight into the DELETEs. On 25 Aug it
    # removed 1,114 rows immediately after the scheduled backup had said
    # "no change since the last backup - skipped" -- so there was no
    # copy of the moment before. Nothing was lost that time because the
    # data was disposable, which is exactly the kind of luck you cannot
    # plan around.
    #
    # forced, because the change-detection that keeps the hourly
    # schedule tidy is precisely wrong here: the point is a copy of THIS
    # moment, whether or not it differs from an hour ago.
    #
    # And it REFUSES if the backup fails. Deleting a client's event
    # without a copy is not a thing to do on a best-effort basis. Pass
    # allow_without_backup:true to override, for the case where backups
    # are genuinely unavailable and the operator has decided anyway.
    backup_note = "no backup taken"
    if not data.get("allow_without_backup"):
        try:
            from flask import current_app
            from services.backup_scheduler import take_backup
            written = take_backup(current_app, force=True)
            if not written:
                return jsonify({
                    "status": "error",
                    "message": ("Could not take a backup before wiping, so nothing "
                                "was deleted. Fix the backup, or send "
                                '"allow_without_backup": true to wipe anyway.'),
                    "code": "BACKUP_FAILED",
                }), 503
            backup_note = written
        except Exception as be:
            logger.error(f"wipe: pre-wipe backup failed: {be}")
            return jsonify({
                "status": "error",
                "message": (f"Could not take a backup before wiping ({str(be)[:80]}), "
                            "so nothing was deleted. Send "
                            '"allow_without_backup": true to wipe anyway.'),
                "code": "BACKUP_FAILED",
            }), 503

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

        # START THE NEW EVENT AT #1.
        #
        # Order numbers come from a Postgres sequence, and the wipe never
        # touched it -- so Treenet opened on #1556, carrying on from
        # where CTN26 stopped (Steve). A new client's first coffee being
        # order one thousand five hundred and fifty six is a small thing
        # that makes the whole system look like someone else's.
        #
        # Safe precisely because this runs AFTER the orders are deleted:
        # there is nothing left for a restarted sequence to collide with.
        # Pass keep_order_numbers:true to carry on where you left off,
        # for a wipe done mid-event to clear a mess rather than to hand
        # over to the next client.
        # CLEAR THE PREVIOUS EVENT'S VIP CODE.
        #
        # Steve, after handing CTN26 over to Treenet: "looks liek on wipe
        # and recrate the vip did not get wied or remade". It did not --
        # the wipe clears transactional tables and never touches
        # `settings`, so CTNVIP was still the live code at Treenet's event
        # while the code Treenet had been told did nothing.
        #
        # That is not just untidy. A code learned at the LAST client's
        # event still skips the queue at this one, and the operator has no
        # reason to suspect it: the Quick Setup box shows the new code
        # they typed. A code is as client-specific as the schedule, which
        # this wipe already clears.
        #
        # Removed rather than replaced, so the failure mode is "no VIP
        # code works until you set one" rather than "an old one still
        # does". Quick Setup writes the new one. keep_vip_code:true
        # overrides, for a mid-event wipe clearing a mess rather than
        # handing over.
        vip_note = "VIP code kept"
        if not data.get("keep_vip_code"):
            try:
                vip_cur = db.cursor()
                vip_cur.execute(
                    "DELETE FROM settings WHERE key IN ('vip_code', 'vip_codes')")
                removed = vip_cur.rowcount or 0
                db.commit()
                vip_note = (
                    f"VIP code cleared - set a new one in Quick Setup"
                    if removed else "no VIP code was set")
            except Exception as vip_err:
                logger.warning(f"wipe: could not clear vip_code: {vip_err}")
                try:
                    db.rollback()
                except Exception:
                    pass
                vip_note = f"VIP code unchanged ({str(vip_err)[:60]})"

        numbering = "order numbers kept"
        if not data.get("keep_order_numbers"):
            try:
                seq_cur = db.cursor()
                seq_cur.execute("ALTER SEQUENCE order_number_seq RESTART WITH 1")
                db.commit()
                numbering = "order numbers restart at 1"
            except Exception as seq_err:
                # A missing sequence means this install uses the legacy
                # order-number format, which has nothing to reset. Not a
                # failed wipe.
                logger.warning(f"wipe: could not reset order_number_seq: {seq_err}")
                numbering = f"order numbers unchanged ({str(seq_err)[:60]})"
                try:
                    db.rollback()
                except Exception:
                    pass

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

        # Optionally reset event IDENTITY to defaults — branding (company /
        # event name, logo, colours), sponsor, and pricing. Without this the
        # wipe keeps config, so the NEXT client would see the previous one's
        # name/logo until manually changed. Clearing these KV rows makes the
        # app fall back to its built-in defaults ("Coffee Cue System", no
        # logo, no pricing) until reconfigured via Quick Setup. (Requested:
        # "needs to be a new-event reset, not just people's details.")
        identity_msg = "branding/pricing kept"
        if data.get("reset_branding"):
            identity_keys = (
                "branding_settings", "pricing_settings", "event_name",
                "sponsor_display_enabled", "sponsor_name", "sponsor_message",
                # Clear the SMS welcome too — otherwise a wipe leaves the
                # previous event's name in the welcome text. Deleting it makes
                # the bot fall back to the {event_name} placeholder default.
                "sms_welcome_message",
            )
            try:
                cursor.execute("DELETE FROM settings WHERE key IN %s", (identity_keys,))
                deleted["identity_settings"] = cursor.rowcount
                db.commit()
                # refresh in-memory caches so the reset is immediate
                cs = current_app.config.get("coffee_system")
                if cs and hasattr(cs, "_load_sponsor_info"):
                    try:
                        cs._load_sponsor_info()
                    except Exception:
                        pass
                identity_msg = "branding, logo & pricing reset to default"
            except Exception as be:
                try:
                    db.rollback()
                except Exception:
                    pass
                deleted["identity_settings"] = f"skipped ({str(be)[:50]})"
                identity_msg = "branding reset failed"

        cursor.close()
        # Clear the in-process conversation cache so a wiped customer
        # isn't still mid-conversation in memory.
        try:
            coffee_system = current_app.config.get("coffee_system")
            if coffee_system and hasattr(coffee_system, "_invalidate_unlimited_stock_cache"):
                coffee_system._invalidate_unlimited_stock_cache()
        except Exception:
            pass
        logger.warning(f"EVENT DATA WIPED: {total} rows across {len(deleted)} tables; "
                       f"{staff_msg}; {identity_msg}")
        return jsonify({
            "status": "success",
            "message": f"Wiped {total} rows of customer/transactional data. "
                       f"Inventory config kept; {staff_msg}; {identity_msg}; "
                       f"{numbering}; {vip_note}. Backed up first: {backup_note}.",
            "deleted": deleted,
            "total_rows": total,
            "numbering": numbering,
            "vip_code": vip_note,
            "backup": backup_note,
        })
    except Exception as e:
        logger.error(f"wipe_event_data error: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500


@bp.route("/api/event-data/reset-order-numbers", methods=["POST"])
@jwt_required_with_demo()
@role_required_with_demo(["admin"])
def reset_order_numbers():
    """Restart order numbering without wiping anything.

    For an event already under way on the wrong numbers -- Treenet opened
    on #1556 because the wipe that handed it over never reset the
    sequence. Wiping again to fix the numbering would be a heavy way to
    solve a cosmetic problem, and would throw away real orders.

    Refuses while orders numbered at or above the new start still exist:
    two coffees carrying the same number on a busy morning is a genuinely
    bad afternoon. Clear those first, or pick a higher start.
    """
    data = request.get_json(silent=True) or {}
    try:
        start = int(data.get("start") or 1)
    except (TypeError, ValueError):
        start = 1
    if start < 1:
        return jsonify({"status": "error", "message": "start must be 1 or more"}), 400

    try:
        db = get_db_connection()
        cursor = db.cursor()
        # Compare on the DIGITS of the number. Postgres does not promise to
        # evaluate the regex guard before the CAST, and once group rounds are
        # lettered (336a) a bare CAST(order_number AS BIGINT) can error on a
        # row the guard was meant to skip. Stripping to digits makes the cast
        # always valid, and correctly counts 336a as using number 336.
        cursor.execute(
            "SELECT COUNT(*) FROM orders "
            "WHERE CAST(NULLIF(regexp_replace(order_number, '[^0-9]', '', 'g'), '') "
            "          AS BIGINT) >= %s", (start,))
        row = cursor.fetchone()
        clash = (row[0] if not isinstance(row, dict) else list(row.values())[0]) or 0
        if clash:
            return jsonify({
                "status": "error",
                "message": (f"{clash} existing order(s) are already numbered {start} "
                            f"or above. Clear them first, or choose a higher start."),
                "conflicts": clash,
            }), 409
        cursor.execute("ALTER SEQUENCE order_number_seq RESTART WITH %s" % int(start))
        db.commit()
        return jsonify({"status": "success",
                        "message": f"The next order will be #{start}."})
    except Exception as e:
        logger.error(f"reset_order_numbers error: {e}")
        try:
            db.rollback()
        except Exception:
            pass
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

            # --- catalog_items: THE MENU. Exported all along but never
            #     restored, so reloading a saved event brought back the
            #     branding and lost what was actually on offer — the part
            #     an operator most wants back when reusing an event.
            #     (category, item_id) is a real unique key, so this is a
            #     clean upsert: existing rows update, new ones insert,
            #     nothing is duplicated on a repeat import.
            catalog_rows = tables.get("catalog_items") or []
            cat_cols = ["category", "item_id", "display_name", "short_name",
                        "subcategory", "properties", "sort_order",
                        "is_active", "is_custom"]
            catalog_done = 0
            for row in catalog_rows:
                if not row.get("category") or not row.get("item_id"):
                    continue
                vals = []
                for col in cat_cols:
                    v = row.get(col)
                    # properties is jsonb; psycopg needs a string, and a
                    # dict arrives here after the JSON round trip.
                    if col == "properties" and isinstance(v, (dict, list)):
                        v = _json.dumps(v)
                    vals.append(v)
                updates = ", ".join(f"{c} = EXCLUDED.{c}" for c in cat_cols
                                    if c not in ("category", "item_id"))
                try:
                    cursor.execute(
                        f"INSERT INTO catalog_items ({', '.join(cat_cols)}) "
                        f"VALUES ({', '.join(['%s'] * len(cat_cols))}) "
                        f"ON CONFLICT (category, item_id) DO UPDATE SET {updates}",
                        vals)
                    catalog_done += 1
                except Exception as ce:
                    logger.warning(f"import catalog {row.get('item_id')}: {ce}")
                    try:
                        db.rollback()
                    except Exception:
                        pass
            if catalog_done:
                result["config_restored"].append(f"menu items ({catalog_done})")

            # --- inventory_items: what each station stocks. No unique
            #     constraint exists, so match on the natural key by hand
            #     rather than blind-inserting, which would duplicate every
            #     item on a second import.
            inv_rows = tables.get("inventory_items") or []
            inv_cols = ["amount", "unit", "capacity", "minimum_threshold", "notes"]
            inv_done = 0
            for row in inv_rows:
                name, cat = row.get("name"), row.get("category")
                if not name:
                    continue
                station = row.get("station_id")
                try:
                    cursor.execute(
                        "SELECT id FROM inventory_items WHERE name = %s "
                        "AND category IS NOT DISTINCT FROM %s "
                        "AND station_id IS NOT DISTINCT FROM %s",
                        (name, cat, station))
                    hit = cursor.fetchone()
                    if hit:
                        sets = ", ".join(f"{c} = %s" for c in inv_cols)
                        cursor.execute(
                            f"UPDATE inventory_items SET {sets} WHERE id = %s",
                            [row.get(c) for c in inv_cols]
                            + [hit[0] if not isinstance(hit, dict) else hit.get("id")])
                    else:
                        cols = ["name", "category", "station_id"] + inv_cols
                        cursor.execute(
                            f"INSERT INTO inventory_items ({', '.join(cols)}) "
                            f"VALUES ({', '.join(['%s'] * len(cols))})",
                            [name, cat, station] + [row.get(c) for c in inv_cols])
                    inv_done += 1
                except Exception as ie:
                    logger.warning(f"import inventory {name}: {ie}")
                    try:
                        db.rollback()
                    except Exception:
                        pass
            if inv_done:
                result["config_restored"].append(f"stock items ({inv_done})")
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
