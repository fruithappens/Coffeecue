"""Server errors, recorded where tablet crashes already are (roadmap U4-7).

Tablet crashes (the React error boundary) land in client_errors and show in
Runner > System > Diagnostics. Server errors -- a 500 from any endpoint, or
an exception nothing caught -- only reached the Railway log, where nobody
looks until someone calls. Now each one is a client_errors row too, with
component = 'server', so the same panel shows both, grouped with counts.

Same error at the same address inside a minute is recorded once: a broken
endpoint polled by ten screens must not write ten rows a second. Its own
short database connection, so recording an error can't poison the
transaction of the request that failed.
"""
import logging
import os
import threading
import time

logger = logging.getLogger(__name__)

DEDUPE_S = 60
_recent = {}
_lock = threading.Lock()


def _first_time(key):
    now = time.monotonic()
    with _lock:
        last = _recent.get(key)
        if last is not None and now - last < DEDUPE_S:
            return False
        _recent[key] = now
        if len(_recent) > 500:  # forget the oldest
            for k, _ in sorted(_recent.items(), key=lambda kv: kv[1])[:250]:
                _recent.pop(k, None)
        return True


def record(method, path, status, message, stack=None):
    """Write one server error. Never raises."""
    try:
        msg = f"HTTP {status}: {str(message or '').strip() or 'server error'}"[:2000]
        if not _first_time((method, path, status, msg[:200])):
            return False
        url = os.getenv("DATABASE_URL")
        if not url:
            return False
        import psycopg2

        conn = psycopg2.connect(url, connect_timeout=5)
        try:
            cur = conn.cursor()
            cur.execute(
                "INSERT INTO client_errors (component, message, stack, url, user_agent, retry_count) "
                "VALUES (%s, %s, %s, %s, %s, 0)",
                ("server", msg, (stack or "")[:5000] or None, f"{method} {path}"[:500], "server"),
            )
            conn.commit()
        finally:
            conn.close()
        return True
    except Exception as e:
        logger.warning("server_errors.record failed: %s", e)
        return False


def install(app):
    """Hook into Flask: handled 500s (after_request) and unhandled
    exceptions (got_request_exception)."""
    from flask import got_request_exception, request

    @app.after_request
    def _record_5xx(response):
        try:
            if response.status_code >= 500 and request.path.startswith("/api/"):
                message = ""
                if response.is_json:
                    body = response.get_json(silent=True) or {}
                    message = body.get("message") or body.get("error") or ""
                threading.Thread(
                    target=record, daemon=True,
                    args=(request.method, request.path, response.status_code, message)).start()
        except Exception:
            pass
        return response

    def _record_exception(sender, exception, **extra):
        try:
            import traceback

            stack = "".join(traceback.format_exception(type(exception), exception, exception.__traceback__))
            record(request.method, request.path, 500, f"{type(exception).__name__}: {exception}", stack)
        except Exception:
            pass

    got_request_exception.connect(_record_exception, app, weak=False)
