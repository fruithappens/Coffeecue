# How cupq.app serves requests

Roadmap task S1-10, checked 11 Oct 2026.

- **Start:** Railway runs `python run_server.py`, built from the Dockerfile,
  restarting on failure: set in `.railway/railway.ts` (since Oct 2026; it
  replaced railway.json / railway.toml, which Railway stopped reading).
- **First lines of run_server.py:** `EVENTLET_NO_GREENDNS=yes` (the September
  SMS DNS outage), then `eventlet.monkey_patch()`, then psycogreen's
  `patch_psycopg()` so database calls yield instead of blocking.
- **Server:** `socketio.run(...)` with `SocketIO(async_mode='eventlet')`
  serves through eventlet's WSGI server, not Flask's development server.
  (`allow_unsafe_werkzeug=True` only matters in threading mode; it is unused.)
- **Database:** each request gets its own pooled connection (CoffeeSystem.db),
  so concurrent requests don't share one.

## Verified

On a local copy with the orders table locked for 8 seconds from outside:
`/api/health` kept answering in ~2 ms throughout. Requests that genuinely read
orders (the orders list, and the public menu, which works out wait times from
the queue) waited for the lock, as they should. Nothing else stalled.

Re-run with `scripts/check_server_concurrency.sh` against a local or staging
copy, especially after upgrading eventlet, Flask or psycopg2
(see docs/DEPENDENCY_AUDIT.md).
