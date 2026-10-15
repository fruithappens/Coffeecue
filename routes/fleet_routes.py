"""The fleet board (roadmap C3-7): every CupQ copy on one page.

GET /api/fleet/self     this copy's own numbers. Answers a manager's login,
                        or another copy holding the shared FLEET_STATUS_TOKEN
                        (Authorization: Bearer ...). Without that env set,
                        only a login can read it.
GET /api/fleet/board    this copy plus every copy in the 'fleet_copies'
                        list: up/down and version from each copy's public
                        /api/app-version, and its numbers from /api/fleet/self
                        when this copy has the token.
PUT /api/fleet/copies   save the list: [{"name": "Demo", "url": "https://demo.cupq.app"}]
                        (the board also shows copies in the FLEET_COPIES setting,
                        which scripts/fleet_apply.py adds to)

The board fetches server-side, so the addresses are limited to https on
cupq.app or Railway's own domains: an admin can't point it at an internal
address (no SSRF).
"""
import hmac
import logging
import os
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from urllib.parse import urlparse

from flask import Blueprint, current_app, jsonify, request

from routes.support_api_routes import support_role_required

logger = logging.getLogger("expresso.routes.fleet")


def _build_commit():
    from utils.build_info import commit

    return commit()


bp = Blueprint("fleet_api", __name__, url_prefix="/api/fleet")

ALLOWED_HOST = re.compile(r"^([a-z0-9-]+\.)*(cupq\.app|up\.railway\.app)$")
MAX_COPIES = 200
TIMEOUT_S = 4


def _db():
    return current_app.config.get("coffee_system").db


def _kv_get(db, key, default=None):
    import json

    try:
        db.rollback()
    except Exception:
        pass
    cur = db.cursor()
    cur.execute("SELECT value FROM settings WHERE key = %s", (key,))
    row = cur.fetchone()
    if not row:
        return default
    val = row[0] if not isinstance(row, dict) else row["value"]
    try:
        return json.loads(val)
    except (TypeError, ValueError):
        return val


def _kv_put(db, key, value):
    import json

    cur = db.cursor()
    cur.execute(
        "INSERT INTO settings(key, value) VALUES(%s, %s) "
        "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
        (key, json.dumps(value)),
    )
    db.commit()


def _one(cur, sql, params=()):
    cur.execute(sql, params)
    row = cur.fetchone()
    if not row:
        return 0
    return (row[0] if not isinstance(row, dict) else list(row.values())[0]) or 0


def self_status():
    """This copy's numbers. Each part fails soft: a broken one reads None."""
    db = _db()
    out = {
        "commit": (_build_commit() or "")[:7] or None,
        "event_name": None,
        "orders_last_hour": None,
        "orders_open": None,
        "texts_used": None,
        "text_cap": None,
        "printers": None,
        "printers_online": None,
        "at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        try:
            db.rollback()
        except Exception:
            pass
        cur = db.cursor()
        out["orders_last_hour"] = int(_one(
            cur, "SELECT COUNT(*) FROM orders WHERE created_at > NOW() - INTERVAL '1 hour'"))
        out["orders_open"] = int(_one(
            cur, "SELECT COUNT(*) FROM orders WHERE status IN ('pending', 'in-progress', 'in_progress')"))
        out["printers"] = int(_one(cur, "SELECT COUNT(*) FROM printers WHERE enabled = TRUE"))
        out["printers_online"] = int(_one(
            cur, "SELECT COUNT(*) FROM printers WHERE enabled = TRUE "
                 "AND last_poll_at > NOW() - INTERVAL '60 seconds'"))
        db.rollback()
    except Exception as e:
        logger.warning(f"fleet self: counts failed: {e}")
        try:
            db.rollback()
        except Exception:
            pass
    try:
        b = _kv_get(db, "branding_settings", default={}) or {}
        if isinstance(b, dict):
            out["event_name"] = b.get("event_name") or b.get("eventName")
    except Exception:
        pass
    try:
        from services import sms_meter

        snap = sms_meter.snapshot()
        out["texts_used"] = snap.get("used")
        out["text_cap"] = snap.get("cap")
    except Exception as e:
        logger.warning(f"fleet self: text meter failed: {e}")
    return out


def _token_ok():
    want = os.getenv("FLEET_STATUS_TOKEN") or ""
    got = (request.headers.get("Authorization") or "")
    if not want or not got.startswith("Bearer "):
        return False
    return hmac.compare_digest(got[7:].strip(), want)


@bp.route("/self", methods=["GET"])
def get_self():
    if not _token_ok():
        # Fall back to a manager's login.
        return _get_self_logged_in()
    return jsonify({"success": True, "data": self_status()})


@support_role_required
def _get_self_logged_in():
    return jsonify({"success": True, "data": self_status()})


def _clean_url(raw):
    u = urlparse(str(raw or "").strip())
    host = (u.hostname or "").lower()
    if u.scheme != "https" or not ALLOWED_HOST.match(host) or u.port not in (None, 443):
        return None
    return f"https://{host}"


def _probe(copy):
    """One remote copy: public version first (is it up?), then its numbers."""
    import requests

    url = copy["url"]
    row = {"name": copy.get("name") or url, "url": url, "up": False, "commit": None,
           "error": None, "stats": None}
    try:
        r = requests.get(f"{url}/api/app-version", timeout=TIMEOUT_S)
        if r.status_code == 200:
            row["up"] = True
            row["commit"] = ((r.json() or {}).get("commit") or "")[:7] or None
        else:
            row["error"] = f"answered {r.status_code}"
    except Exception as e:
        row["error"] = "no answer" if "timed out" in str(e).lower() or "connect" in str(e).lower() else str(e)[:80]
        return row
    token = os.getenv("FLEET_STATUS_TOKEN")
    if token:
        try:
            r = requests.get(f"{url}/api/fleet/self", timeout=TIMEOUT_S,
                             headers={"Authorization": f"Bearer {token}"})
            if r.status_code == 200:
                row["stats"] = (r.json() or {}).get("data")
        except Exception:
            pass
    return row


def _env_copies():
    """Copies listed in FLEET_COPIES (JSON list), which the build script
    (scripts/fleet_apply.py) adds to when it makes a new copy. Shown beside
    the list saved in System > Fleet; the same address twice shows once."""
    import json

    try:
        raw = json.loads(os.getenv("FLEET_COPIES") or "[]")
    except ValueError:
        logger.warning("FLEET_COPIES is not a JSON list; ignored")
        return []
    return [c for c in raw if isinstance(c, dict) and c.get("url")] if isinstance(raw, list) else []


@bp.route("/board", methods=["GET"])
@support_role_required
def get_board():
    db = _db()
    copies = _kv_get(db, "fleet_copies", default=[]) or []
    copies = [c for c in copies if isinstance(c, dict) and c.get("url")] + _env_copies()
    seen, merged = set(), []
    for c in copies:
        url = _clean_url(c.get("url"))
        if url and url not in seen:
            seen.add(url)
            merged.append({"name": c.get("name") or url, "url": url})
    copies = merged[:MAX_COPIES]
    here = {"name": "This copy", "url": request.host_url.rstrip("/"), "up": True,
            "self": True, "commit": None, "error": None, "stats": self_status()}
    here["commit"] = here["stats"].get("commit")
    rows = [here]
    if copies:
        with ThreadPoolExecutor(max_workers=min(8, len(copies))) as pool:
            rows += list(pool.map(_probe, copies))
    return jsonify({"success": True, "data": {
        "copies": rows, "token_set": bool(os.getenv("FLEET_STATUS_TOKEN")),
        "at": datetime.now(timezone.utc).isoformat()}})


@bp.route("/copies", methods=["PUT"])
@support_role_required
def put_copies():
    body = request.get_json(silent=True) or {}
    raw = body.get("copies")
    if not isinstance(raw, list):
        return jsonify({"success": False, "message": "copies must be a list"}), 400
    clean, bad = [], []
    for c in raw[:MAX_COPIES]:
        if not isinstance(c, dict):
            continue
        url = _clean_url(c.get("url"))
        if not url:
            bad.append(str(c.get("url"))[:80])
            continue
        if url not in {x["url"] for x in clean}:
            clean.append({"name": str(c.get("name") or "").strip()[:60] or url, "url": url})
    if bad:
        return jsonify({"success": False,
                        "message": "Only https addresses on cupq.app or up.railway.app: " + ", ".join(bad)}), 400
    _kv_put(_db(), "fleet_copies", clean)
    return jsonify({"success": True, "data": {"copies": clean}})
