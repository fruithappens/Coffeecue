#!/usr/bin/env python
"""
Script to run the Expresso server - production ready for Railway
"""
# --- CONCURRENCY PATCH (must be the very first thing that runs) ---
# This is the ACTUAL production entrypoint (Dockerfile CMD / railway
# startCommand / Procfile all run `python run_server.py`). Historically it
# started the app with eventlet's async mode declared but NEVER
# monkey-patched, so every blocking call — every Postgres query especially —
# froze the single hub until it returned. Result: the server handled ONE
# request at a time (measured live: 10 concurrent requests took 13.4s in a
# strict 1.3s staircase), which starved the CloudPRNT printer's poll under
# load (25-55s label delays).
#
# monkey_patch() turns eventlet's green sockets on before anything imports
# socket/ssl/requests. patch_psycopg() additionally makes psycopg2 (libpq, a
# C extension the socket patch can't reach) yield to the hub during a query
# instead of freezing it. Together they let one worker serve many requests
# at once. Pairs with the per-request pooled DB connection in
# CoffeeOrderSystem.db (else green queries would collide on one connection).
# MUST precede every other import. See wsgi.py for the original write-up.
# --- DNS resolver fix (MUST precede `import eventlet`) ---
# monkey_patch() below swaps in eventlet's own DNS resolver, "greendns",
# which is driven by dnspython. dnspython is an UNPINNED transitive
# dependency, so a container REBUILD can pull a newer dnspython that
# eventlet 0.33.3's greendns can't drive — and then every PUBLIC DNS lookup
# times out ("Failed to resolve api.twilio.com / cupq.app"), silently
# killing ALL outbound (SMS, keep-warm) while inbound + Postgres (private
# DNS) keep working. This bit us right after a redeploy with no networking
# code changed (Treenet, 2026-09-05). Forcing greendns OFF makes eventlet
# use the system resolver (run in a threadpool, so it still never blocks the
# hub) and the dnspython version stops mattering.
import os as _os
_os.environ.setdefault("EVENTLET_NO_GREENDNS", "yes")

import eventlet  # noqa: E402
eventlet.monkey_patch()  # noqa: E402
from psycogreen.eventlet import patch_psycopg  # noqa: E402
patch_psycopg()  # noqa: E402

import os
import sys
from app import create_app

# Ensure admin user exists before starting server
try:
    from ensure_admin_user import main as ensure_admin
    ensure_admin()
except Exception as e:
    print(f"Warning: Could not ensure admin user: {e}")

if __name__ == '__main__':
    app, socketio = create_app()

    # Get port from environment (Railway sets this)
    port = int(os.environ.get('PORT', 5001))
    host = '0.0.0.0'
    debug = os.environ.get('DEBUG', 'False').lower() == 'true'

    print(f"🚀 Starting Expresso server on {host}:{port}")
    print(f"🛡️ Security features: ACTIVE")
    print(f"🌐 Environment: {'Development' if debug else 'Production'}")

    # IMPORTANT: use_reloader=False even when debug is on.
    # eventlet (used by Flask-SocketIO async_mode='eventlet') doesn't
    # play nicely with werkzeug's reloader — the child process hangs
    # during startup somewhere after DB init but before bind. Tried,
    # didn't work; see scripts/dev_watch.sh for an external file-
    # watcher alternative that achieves the same 'auto-restart on
    # save' effect via kill+respawn.
    if hasattr(socketio, 'run') and socketio.__class__.__name__ == 'DummySocketIO':
        app.run(debug=debug, host=host, port=port, use_reloader=False)
    else:
        socketio.run(
            app, debug=debug, host=host, port=port,
            use_reloader=False,
            allow_unsafe_werkzeug=True,
        )