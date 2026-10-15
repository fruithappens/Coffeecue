"""The backup job's check-in (roadmap S1-14).

POST /api/public/backup-heartbeat   Bearer BACKUP_HEARTBEAT_TOKEN
                                    {"kind": "nightly"|"hourly", "bytes": n}

Called by scripts/backup_prod.py after a dump it has verified. Answers 404
unless the token is set, so the address gives nothing away on a copy that
isn't backed up. See services/backup_watch.py.
"""
import hmac
import logging
import os

from flask import Blueprint, jsonify, request

from security_middleware import _client_ip, limiter

logger = logging.getLogger("expresso.routes.backup")

bp = Blueprint("backup_api", __name__, url_prefix="/api/public")


@bp.route("/backup-heartbeat", methods=["POST"])
@limiter.limit("30 per hour", key_func=_client_ip)
def heartbeat():
    want = os.getenv("BACKUP_HEARTBEAT_TOKEN") or ""
    got = request.headers.get("Authorization") or ""
    if not want:
        return jsonify({"success": False}), 404
    if not got.startswith("Bearer ") or not hmac.compare_digest(got[7:].strip(), want):
        return jsonify({"success": False, "message": "not allowed"}), 401
    body = request.get_json(silent=True) or {}
    kind = body.get("kind") if body.get("kind") in ("nightly", "hourly", "manual") else "manual"
    try:
        size = max(0, int(body.get("bytes") or 0))
    except (TypeError, ValueError):
        size = 0
    from services import backup_watch
    from utils.database import close_connection, get_db_connection

    conn = get_db_connection()
    try:
        v = backup_watch.record(conn, kind, size)
    finally:
        close_connection(conn)
    logger.info("backup check-in: %s, %s bytes", kind, size)
    return jsonify({"success": True, "recorded": v})
