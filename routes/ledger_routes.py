"""The per-event ledger: what this event was, and what to charge (L6-3).

GET /api/ledger   facts read from this copy + the inputs typed in + the bill
PUT /api/ledger   save the inputs (hardware, hours, travel, extra lines)

Facts come from the data: the plan, the days that had orders (in the
event's own time zone), stations used, orders, texts sent. Prices come from
utils/pricing.py. Runner > Report > Ledger shows it as one printable page.
"""
import logging

from flask import Blueprint, current_app, jsonify, request

from auth import jwt_required_with_demo, role_required_with_demo
from utils import pricing

logger = logging.getLogger("expresso.routes.ledger")

bp = Blueprint("ledger", __name__, url_prefix="/api/ledger")

KV_KEY = "event_ledger"
MANAGERS = ["admin", "staff", "organizer", "organiser", "event_organizer"]


def _db():
    return current_app.config.get("coffee_system").db


def _scalar(cur):
    r = cur.fetchone()
    if not r:
        return None
    return list(r.values())[0] if isinstance(r, dict) else r[0]


def facts(db):
    from routes.consolidated_api_routes import _event_timezone, _kv_get
    from utils.event_time import local_date_sql
    from utils.plan_limits import PLAN_LIMITS

    tz = _event_timezone()
    tier = str(_kv_get(db, "plan_tier", default="") or "").strip().lower() or None
    db.rollback()
    cur = db.cursor()
    day = local_date_sql("created_at")
    cur.execute(
        f"SELECT {day} AS d, COUNT(*) FROM orders WHERE status <> 'cancelled' "
        f"GROUP BY 1 ORDER BY 1",
        {"tz": tz},
    )
    by_day = [
        {
            "date": str(r[0] if not isinstance(r, dict) else r["d"]),
            "orders": int(r[1] if not isinstance(r, dict) else list(r.values())[1]),
        }
        for r in cur.fetchall()
    ]
    cur.execute(
        "SELECT COUNT(DISTINCT station_id) FROM orders WHERE status <> 'cancelled' AND station_id IS NOT NULL"
    )
    stations = int(_scalar(cur) or 0)
    texts = 0
    try:
        # Billed segments actually sent (not the simulated ones test mode logs).
        from services.sms_meter import SENT

        cur.execute(
            "SELECT COALESCE(SUM(segments), 0) FROM sms_outbound_log WHERE status = %s",
            (SENT,),
        )
        texts = int(_scalar(cur) or 0)
    except Exception:
        db.rollback()
        cur = db.cursor()
    linked_ea = False
    try:
        cur.execute("SELECT EXISTS (SELECT 1 FROM ea_attendees)")
        linked_ea = bool(_scalar(cur))
    except Exception:
        db.rollback()
    db.rollback()
    included = (PLAN_LIMITS.get(tier) or {}).get("sms") if tier else None
    return {
        "tier": tier,
        "tier_name": (pricing.TIERS.get(tier) or {}).get("name") if tier else None,
        "days": len(by_day),
        "by_day": by_day,
        "orders": sum(d["orders"] for d in by_day),
        "stations_used": stations,
        "texts_sent": texts,
        "texts_included": included,
        "eventsair_linked": linked_ea,
        "timezone": tz,
    }


def _inputs(db):
    from routes.consolidated_api_routes import _kv_get

    v = _kv_get(db, KV_KEY, default={}) or {}
    return v if isinstance(v, dict) else {}


def _num(v, default=0.0):
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def bill(f, inp):
    days = int(_num(inp.get("days_override"), 0)) or f["days"] or 1
    addons = [a for a in (inp.get("addons") or []) if a in pricing.ADDONS]
    hardware = {
        k: int(_num(v))
        for k, v in (inp.get("hardware") or {}).items()
        if k in pricing.HARDWARE
    }
    other = [
        (str(o[0]), _num(o[1]))
        for o in (inp.get("other") or [])
        if isinstance(o, (list, tuple)) and len(o) == 2
    ]
    override = inp.get("texts_charge_override")
    return pricing.build(
        f["tier"],
        days,
        addons=addons,
        hardware=hardware,
        operator_hours=_num(inp.get("operator_hours")),
        remote_setup=bool(inp.get("remote_setup")),
        texts_used=f["texts_sent"],
        texts_included=f["texts_included"],
        texts_charge_override=None if override in (None, "") else _num(override),
        travel=_num(inp.get("travel")),
        other=other,
    )


@bp.route("", methods=["GET"])
@jwt_required_with_demo()
@role_required_with_demo(MANAGERS)
def get_ledger():
    db = _db()
    f = facts(db)
    inp = _inputs(db)
    return jsonify(
        {
            "success": True,
            "facts": f,
            "inputs": inp,
            "bill": bill(f, inp),
            "price_list": {
                "hardware": pricing.HARDWARE,
                "addons": pricing.ADDONS,
                "operator_per_hour": pricing.OPERATOR_PER_HOUR,
                "operator_min_hours": pricing.OPERATOR_MIN_HOURS,
                "remote_setup": pricing.REMOTE_SETUP,
                "text_each": pricing.TEXT_EACH,
            },
        }
    )


@bp.route("", methods=["PUT"])
@jwt_required_with_demo()
@role_required_with_demo(MANAGERS)
def put_ledger():
    from routes.consolidated_api_routes import _kv_put

    body = request.get_json(silent=True) or {}
    keep = {
        k: body.get(k)
        for k in (
            "client",
            "days_override",
            "addons",
            "hardware",
            "operator_hours",
            "remote_setup",
            "texts_charge_override",
            "travel",
            "other",
            "notes",
        )
        if k in body
    }
    db = _db()
    _kv_put(db, KV_KEY, keep)
    f = facts(db)
    return jsonify({"success": True, "inputs": keep, "bill": bill(f, keep)})
