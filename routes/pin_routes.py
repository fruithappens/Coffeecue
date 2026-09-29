"""Runner > People > Unlock PINs: who has a PIN, who unlocked what, and the
shared event PIN. The checking itself is utils/pins.py, reached through
POST /api/kiosk/verify-pin; this file only manages the PINs.

Access mirrors the rest of People (support_role_required): every manager and
admin role, never a shared barista, customer or display login -- a barista
able to set PINs could simply give themselves the padlock.
"""
import logging

from flask import Blueprint, jsonify, request, g

from routes.support_api_routes import support_role_required
from utils import pins

logger = logging.getLogger("expresso.routes.pins")

bp = Blueprint("pin_api", __name__, url_prefix="/api/pins")


def _db():
    from utils.database import get_db_connection

    return get_db_connection()


def _release(conn):
    try:
        from utils.database import close_connection

        close_connection(conn)
    except Exception:
        pass


def _rows(cur):
    cols = [d[0] for d in cur.description]
    return [
        dict(r) if isinstance(r, dict) else dict(zip(cols, r)) for r in cur.fetchall()
    ]


def _iso(v):
    return v.isoformat() + "Z" if v else None


def _err(msg, code=400):
    return jsonify({"success": False, "status": "error", "message": msg}), code


def _actor():
    try:
        u = getattr(g, "user", None) or {}
        return str(u.get("username") or u.get("id") or "")[:50] or None
    except Exception:
        return None


@bp.route("", methods=["GET"])
@support_role_required
def pin_status():
    conn = _db()
    try:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT u.id, u.username, u.full_name, u.role,
                   COALESCE(u.is_active, TRUE) AS is_active,
                   u.pin_hash IS NOT NULL AS has_pin, u.pin_set_at,
                   (SELECT MAX(at) FROM pin_unlocks p
                     WHERE p.user_id = u.id AND p.ok) AS last_unlock_at
            FROM users u
            ORDER BY LOWER(COALESCE(NULLIF(u.full_name, ''), u.username))
        """
        )
        people = _rows(cur)
        for p in people:
            p["pin_set_at"] = _iso(p["pin_set_at"])
            p["last_unlock_at"] = _iso(p["last_unlock_at"])
        ev = pins.event_pin_state(cur)
        return jsonify(
            {
                "success": True,
                "status": "success",
                "data": {
                    "people": people,
                    "event_pin": {
                        "is_default": ev["is_default"],
                        "enabled": ev["enabled"],
                    },
                },
            }
        )
    except Exception as e:
        logger.error(f"pin status failed: {e}")
        return _err("Could not load PINs.", 500)
    finally:
        _release(conn)


@bp.route("/users/<int:user_id>", methods=["PUT"])
@support_role_required
def set_user_pin(user_id):
    pin = str((request.get_json(silent=True) or {}).get("pin") or "").strip()
    problem = pins.pin_problem(pin)
    if problem:
        return _err(problem)
    conn = _db()
    try:
        cur = conn.cursor()
        ev = pins.event_pin_state(cur)
        if pin == ev["pin"]:
            return _err("That's the shared event PIN - pick a different one.")
        h = pins.pin_hash(pin)
        cur.execute(
            "SELECT id FROM users WHERE pin_hash = %s AND id <> %s", (h, user_id)
        )
        if cur.fetchone():
            # Say it's taken without saying by whom.
            return _err("That PIN is already in use - pick a different one.")
        cur.execute(
            "UPDATE users SET pin_hash = %s, pin_set_at = (NOW() AT TIME ZONE 'UTC') "
            "WHERE id = %s",
            (h, user_id),
        )
        if cur.rowcount == 0:
            conn.rollback()
            return _err("No such person.", 404)
        conn.commit()
        logger.info("PIN set for user %s by %s", user_id, _actor())
        return jsonify({"success": True, "status": "success"})
    except Exception as e:
        conn.rollback()
        logger.error(f"set pin failed: {e}")
        return _err("Could not save the PIN.", 500)
    finally:
        _release(conn)


@bp.route("/users/<int:user_id>", methods=["DELETE"])
@support_role_required
def clear_user_pin(user_id):
    conn = _db()
    try:
        cur = conn.cursor()
        cur.execute(
            "UPDATE users SET pin_hash = NULL, pin_set_at = NULL WHERE id = %s",
            (user_id,),
        )
        conn.commit()
        logger.info("PIN cleared for user %s by %s", user_id, _actor())
        return jsonify({"success": True, "status": "success"})
    except Exception as e:
        conn.rollback()
        logger.error(f"clear pin failed: {e}")
        return _err("Could not remove the PIN.", 500)
    finally:
        _release(conn)


@bp.route("/unlocks", methods=["GET"])
@support_role_required
def unlocks():
    try:
        limit = max(1, min(int(request.args.get("limit", 100)), 500))
    except ValueError:
        limit = 100
    conn = _db()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT at, ok, who, surface FROM pin_unlocks ORDER BY at DESC LIMIT %s",
            (limit,),
        )
        rows = _rows(cur)
        for r in rows:
            r["at"] = _iso(r["at"])
        return jsonify(
            {"success": True, "status": "success", "data": {"unlocks": rows}}
        )
    except Exception as e:
        logger.error(f"pin unlocks failed: {e}")
        return _err("Could not load the unlock log.", 500)
    finally:
        _release(conn)


@bp.route("/event", methods=["PUT"])
@support_role_required
def set_event_pin():
    """Body: {"pin": "...."} to change it, and/or {"enabled": bool}."""
    data = request.get_json(silent=True) or {}
    conn = _db()
    try:
        cur = conn.cursor()

        def put(key, value, desc):
            cur.execute(
                """
                INSERT INTO settings (key, value, description, updated_at, updated_by)
                VALUES (%s, %s, %s, NOW(), %s)
                ON CONFLICT (key) DO UPDATE
                    SET value = EXCLUDED.value, updated_at = NOW(),
                        updated_by = EXCLUDED.updated_by
            """,
                (key, value, desc, _actor()),
            )

        if "pin" in data:
            pin = str(data.get("pin") or "").strip()
            problem = pins.pin_problem(pin)
            if problem:
                return _err(problem)
            cur.execute(
                "SELECT 1 FROM users WHERE pin_hash = %s", (pins.pin_hash(pin),)
            )
            if cur.fetchone():
                return _err(
                    "Someone already uses that as their own PIN - pick a different one."
                )
            put("kiosk_pin", pin, "Shared event PIN for the barista padlock and kiosk")
        if "enabled" in data:
            put(
                "event_pin_disabled",
                "false" if data.get("enabled") else "true",
                "true = only personal PINs open the padlock and kiosk",
            )
        conn.commit()
        ev = pins.event_pin_state(cur)
        return jsonify(
            {
                "success": True,
                "status": "success",
                "data": {"is_default": ev["is_default"], "enabled": ev["enabled"]},
            }
        )
    except Exception as e:
        conn.rollback()
        logger.error(f"event pin save failed: {e}")
        return _err("Could not save the event PIN.", 500)
    finally:
        _release(conn)
