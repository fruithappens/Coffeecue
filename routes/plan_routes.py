"""Runner > Settings > Plan: choose this instance's plan tier.

utils/plan_limits.py enforces the tiers (attendee cap, stations, VIP, group
orders, Square, badge scan, included texts), but until now nothing in the
app could SET the tier -- it was a settings row only reachable through the
database, so every instance ran with no tier (unlimited). This adds the
switch.

Manager roles only (support_role_required): a shared barista login must not
be able to lift its own event's limits.
"""
import logging

from flask import Blueprint, jsonify, request, g

from routes.support_api_routes import support_role_required
from utils.plan_limits import PLAN_LIMITS, _setting

logger = logging.getLogger("expresso.routes.plan")

bp = Blueprint("plan_api", __name__, url_prefix="/api/plan")

# The names on the pricing page, keyed by the stored value.
TIER_NAMES = {
    "lite": "Skim",
    "standard": "Flat White",
    "pro": "Double Shot",
    "urn": "The Urn",
}


def _db():
    from utils.database import get_db_connection

    return get_db_connection()


def _release(conn):
    try:
        from utils.database import close_connection

        close_connection(conn)
    except Exception:
        pass


def _tiers():
    return [
        {"key": k, "name": TIER_NAMES.get(k, k), "limits": v}
        for k, v in PLAN_LIMITS.items()
    ]


@bp.route("", methods=["GET"])
@support_role_required
def get_plan():
    conn = _db()
    try:
        tier = _setting(conn, "plan_tier")
        return jsonify(
            {
                "success": True,
                "status": "success",
                "data": {
                    "tier": tier if tier in PLAN_LIMITS else None,
                    "tiers": _tiers(),
                },
            }
        )
    finally:
        _release(conn)


@bp.route("", methods=["PUT"])
@support_role_required
def set_plan():
    """Body: {"tier": "lite" | "standard" | "pro" | "urn" | null}. null = no
    plan, i.e. no limits (how every instance ran before this)."""
    tier = (request.get_json(silent=True) or {}).get("tier")
    if tier not in (None, "") and tier not in PLAN_LIMITS:
        return (
            jsonify({"success": False, "status": "error", "message": "Unknown plan."}),
            400,
        )
    conn = _db()
    try:
        cur = conn.cursor()
        if tier:
            who = (
                str((getattr(g, "user", None) or {}).get("username") or "")[:50] or None
            )
            cur.execute(
                """
                INSERT INTO settings (key, value, description, updated_at, updated_by)
                VALUES ('plan_tier', %s, 'Plan tier: lite/standard/pro/urn', NOW(), %s)
                ON CONFLICT (key) DO UPDATE
                    SET value = EXCLUDED.value, updated_at = NOW(),
                        updated_by = EXCLUDED.updated_by
            """,
                (tier, who),
            )
        else:
            cur.execute("DELETE FROM settings WHERE key = 'plan_tier'")
        conn.commit()
        logger.info("plan tier set to %s", tier or "none")
        return jsonify(
            {
                "success": True,
                "status": "success",
                "data": {"tier": tier or None, "tiers": _tiers()},
            }
        )
    except Exception as e:
        conn.rollback()
        logger.error(f"plan save failed: {e}")
        return (
            jsonify(
                {
                    "success": False,
                    "status": "error",
                    "message": "Could not save the plan.",
                }
            ),
            500,
        )
    finally:
        _release(conn)
