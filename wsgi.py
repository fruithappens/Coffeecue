"""Production entrypoint. Run this under gunicorn, never directly.

WHY THIS FILE EXISTS
--------------------
Production used to serve via `python run_server.py`, which is Flask-SocketIO
driving Werkzeug's DEVELOPMENT server — it only starts at all because
`allow_unsafe_werkzeug=True` was passed to silence the guard that exists to
prevent exactly this. Two long-standing faults came from it:

1. THE SITE HUNG AND STAYED HUNG. eventlet was never monkey-patched, so a
   blocking socket froze the whole process — every request, indefinitely.
   The process stayed ALIVE, so Railway's restartPolicy ("ON_FAILURE")
   never fired and nothing recovered it. On 2026-08-20 a single request to
   /api/ea/status (which calls out to Microsoft for a token) took the entire
   site down until it was restarted by hand. `requests`' own timeout does
   not save you: it does not cover DNS, and under un-patched eventlet a
   blocking read stalls the hub permanently.

2. LARGE UPLOADS SILENTLY FAILED. The dev server did not reliably read big
   request bodies behind Railway's proxy. Branding PUTs of ~500-700KB
   arrived TRUNCATED, so request.get_json() raised BadRequest and the save
   failed while the UI still said "saved". Text fields persisted; images
   never did. That is why event backgrounds and logos would not stick.

WHAT FIXES IT
-------------
monkey_patch() below turns eventlet's green sockets on BEFORE anything
imports socket/ssl/requests, so an outbound call yields instead of blocking
the hub. gunicorn then supplies what a dev server never did: a real WSGI
request reader (large bodies), and an arbiter that kills and replaces a
worker that stops heartbeating.

It MUST be the first thing that runs — patching after `requests` has already
bound the standard socket module leaves the old blocking one in place, and
the bug comes straight back. Keep these lines at the top.
"""
import eventlet  # noqa: E402

eventlet.monkey_patch()  # noqa: E402  MUST precede every other import

import os  # noqa: E402
import logging  # noqa: E402

logger = logging.getLogger(__name__)

# Best-effort, never fatal: a missing admin user must not stop the site
# from booting. Matches the behaviour run_server.py had.
try:
    from ensure_admin_user import main as ensure_admin

    ensure_admin()
except Exception as e:  # pragma: no cover - startup convenience only
    print(f"Warning: Could not ensure admin user: {e}")

from app import create_app  # noqa: E402

application, socketio = create_app()

# gunicorn looks for `application`; keep `app` too so that
# `gunicorn wsgi:app` also works and nobody gets caught out.
app = application

if __name__ == "__main__":
    # Local convenience only. Production runs gunicorn (see Dockerfile).
    port = int(os.environ.get("PORT", 5001))
    socketio.run(
        application,
        host="0.0.0.0",
        port=port,
        use_reloader=False,
        allow_unsafe_werkzeug=True,
    )
