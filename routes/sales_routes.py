"""One sales list, from enquiry to paid (roadmap L6-9).

Demo requests (cupq.com.au), sign-ups (cupq.app/start) and leads typed in by
hand, each with a stage, a value and a next step. Runner > System > Sales.

GET    /api/sales          the list; new enquiries join it by themselves
POST   /api/sales          add a lead by hand
PATCH  /api/sales/<id>     stage, value, next step and date, notes, contact
DELETE /api/sales/<id>     leads typed in by hand only

The enquiries themselves are untouched: this holds what we do about them.
Admin only: it's CupQ's own pipeline, not something for event staff.
"""
import logging
import re

from flask import Blueprint, g, jsonify, request

from auth import jwt_required_with_demo, role_required_with_demo
from utils import event_time

logger = logging.getLogger("expresso.routes.sales")

bp = Blueprint("sales", __name__, url_prefix="/api/sales")
ADMIN = ["admin"]

STAGES = ["enquiry", "demo", "quoted", "signed", "event", "invoiced", "paid", "lost"]
TEXT = {
    "organisation": 160, "name": 120, "email": 200, "phone": 40,
    "event_when": 120, "next_step": 300, "notes": 4000,
}
COLUMNS = ("id", "source", "source_id", "created_at", "organisation", "name", "email", "phone",
           "event_when", "stage", "value", "next_step", "next_date", "notes", "updated_at", "updated_by")


def _conn():
    from utils.database import get_db_connection

    return get_db_connection()


def _release(conn):
    from utils.database import close_connection

    close_connection(conn)


def clean(body):
    """(fields, problem) from what was sent: only known fields, checked."""
    out = {}
    for k, cap in TEXT.items():
        if k in body:
            out[k] = str(body.get(k) or "").strip()[:cap]
    if "stage" in body:
        if body.get("stage") not in STAGES:
            return None, "That isn't a stage."
        out["stage"] = body["stage"]
    if "value" in body:
        raw = re.sub(r"[$,\s]", "", str(body.get("value") if body.get("value") is not None else ""))
        if raw == "":
            out["value"] = None
        else:
            if not re.fullmatch(r"\d{1,7}(\.\d{1,2})?", raw):
                return None, "Value is a number of dollars."
            out["value"] = float(raw)
    if "next_date" in body:
        raw = body.get("next_date")
        d = event_time.parse_date(raw) if raw else None
        if raw and not d:
            return None, "That isn't a date."
        out["next_date"] = d
    return out, None


def _pull_in(cur):
    """Enquiries and sign-ups not on the list yet."""
    cur.execute(
        """
        INSERT INTO sales_leads (source, source_id, created_at, organisation, name, email, phone,
                                 event_when, next_step)
        SELECT 'demo', id, created_at, organisation, name, email, phone, event_when,
               'Reply to their enquiry'
          FROM demo_requests WHERE COALESCE(source, '') <> 'event_feedback'
        ON CONFLICT (source, source_id) DO NOTHING
        """
    )
    cur.execute(
        """
        SELECT id, created_at, organisation, name, email, phone, event_name, starts, ends,
               attendees, plan, status
          FROM signup_requests s
         WHERE NOT EXISTS (SELECT 1 FROM sales_leads l WHERE l.source = 'signup' AND l.source_id = s.id)
        """
    )
    from routes.signup_routes import quote_for

    cols = [d[0] for d in cur.description]
    for row in cur.fetchall():
        r = dict(row) if isinstance(row, dict) else dict(zip(cols, row))
        days = {k: r[k].isoformat() if r.get(k) else None for k in ("starts", "ends")}
        value = None
        try:
            q = quote_for({**r, **days})
            value = None if q["quoted_separately"] else q["subtotal"]
        except Exception as e:
            logger.warning("sales: sign-up #%s has no quote: %s", r["id"], e)
        when = " to ".join(dict.fromkeys(d for d in (days["starts"], days["ends"]) if d))
        stage = {"approved": "signed", "declined": "lost"}.get(r.get("status"), "enquiry")
        cur.execute(
            """
            INSERT INTO sales_leads (source, source_id, created_at, organisation, name, email, phone,
                                     event_when, value, stage, next_step)
            VALUES ('signup', %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (source, source_id) DO NOTHING
            """,
            (r["id"], r["created_at"], r["organisation"], r["name"], r["email"], r["phone"],
             f"{r.get('event_name') or ''}, {when}".strip(", ")[:120], value, stage,
             "" if stage == "lost" else "Build their copy" if stage == "signed" else "Agree pricing"),
        )


def _row(r):
    v = dict(r) if isinstance(r, dict) else dict(zip(COLUMNS, r))
    for k in ("created_at", "updated_at"):
        v[k] = (v[k].isoformat() + "Z") if v.get(k) else None
    v["next_date"] = v["next_date"].isoformat() if v.get("next_date") else None
    v["value"] = float(v["value"]) if v.get("value") is not None else None
    return v


def _who():
    u = getattr(g, "user", None) or {}
    return str(u.get("username") or "")[:80] if isinstance(u, dict) else ""


def _fail(conn, what, e):
    conn.rollback()
    logger.error("sales: %s failed: %s", what, e)
    return jsonify({"success": False, "message": "Couldn't do that. Please try again."}), 500


@bp.route("", methods=["GET"])
@jwt_required_with_demo()
@role_required_with_demo(ADMIN)
def list_sales():
    conn = _conn()
    try:
        cur = conn.cursor()
        _pull_in(cur)
        conn.commit()
        cur.execute(f"SELECT {', '.join(COLUMNS)} FROM sales_leads ORDER BY created_at DESC, id DESC LIMIT 500")
        rows = [_row(r) for r in cur.fetchall()]
        conn.rollback()
        return jsonify({"success": True, "stages": STAGES, "leads": rows})
    except Exception as e:
        return _fail(conn, "list", e)
    finally:
        _release(conn)


@bp.route("", methods=["POST"])
@jwt_required_with_demo()
@role_required_with_demo(ADMIN)
def add_lead():
    f, why = clean(request.get_json(silent=True) or {})
    if not why and not (f.get("organisation") or f.get("name")):
        why = "Enter an organisation or a name."
    if why:
        return jsonify({"success": False, "message": why}), 400
    f.setdefault("next_step", "Contact them")
    f["updated_by"] = _who()
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            f"INSERT INTO sales_leads (source, {', '.join(f)}) VALUES ('manual', {', '.join(['%s'] * len(f))}) "
            f"RETURNING {', '.join(COLUMNS)}",
            tuple(f.values()),
        )
        row = _row(cur.fetchone())
        conn.commit()
        return jsonify({"success": True, "lead": row})
    except Exception as e:
        return _fail(conn, "add", e)
    finally:
        _release(conn)


@bp.route("/<int:lead_id>", methods=["PATCH"])
@jwt_required_with_demo()
@role_required_with_demo(ADMIN)
def change_lead(lead_id):
    f, why = clean(request.get_json(silent=True) or {})
    if why or not f:
        return jsonify({"success": False, "message": why or "Nothing to change."}), 400
    f["updated_by"] = _who()
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            f"UPDATE sales_leads SET {', '.join(k + ' = %s' for k in f)}, updated_at = (NOW() AT TIME ZONE 'UTC') "
            f"WHERE id = %s RETURNING {', '.join(COLUMNS)}",
            (*f.values(), lead_id),
        )
        row = cur.fetchone()
        conn.commit()
        if not row:
            return jsonify({"success": False, "message": "That lead is gone."}), 404
        return jsonify({"success": True, "lead": _row(row)})
    except Exception as e:
        return _fail(conn, "change", e)
    finally:
        _release(conn)


@bp.route("/<int:lead_id>", methods=["DELETE"])
@jwt_required_with_demo()
@role_required_with_demo(ADMIN)
def delete_lead(lead_id):
    conn = _conn()
    try:
        cur = conn.cursor()
        # One from the website would come straight back; mark it lost instead.
        cur.execute("DELETE FROM sales_leads WHERE id = %s AND source = 'manual'", (lead_id,))
        gone = cur.rowcount
        conn.commit()
        if not gone:
            return jsonify({"success": False, "message": "Only leads typed in by hand can be deleted. Mark it lost."}), 400
        return jsonify({"success": True})
    except Exception as e:
        return _fail(conn, "delete", e)
    finally:
        _release(conn)
