"""This copy watches the others (roadmap U4-10).

Every minute the service watch (services/service_watch.py) asks each copy
on the fleet board (System > Fleet, plus the FLEET_COPIES setting the build
script fills) for its public menu (/api/display/menu: it needs the
database, where /api/health doesn't). A copy that fails DOWN_AFTER checks in a row
texts the admin number and whoever is on call; when it answers again they
get "it's back". Live (cupq.app) watches demo and every client copy.

What this can't do: tell anyone when THIS copy is down. That needs a
watcher outside CupQ (an uptime service on the on-call phone; the GitHub
uptime ping is a slow backstop).
"""
import logging
import os

logger = logging.getLogger(__name__)

DOWN_AFTER = int(os.getenv("FLEET_DOWN_AFTER_CHECKS", "2"))
# Longer than the database pool's 10 s wait, so a busy copy isn't "down".
TIMEOUT_S = 15
# /api/health answers without touching the database, so it stayed 200
# through demo's empty connection pool (17-20 Oct 2026) and nobody heard.
# The public menu is what a customer's phone loads first, and needs the DB.
PROBE_PATH = "/api/display/menu"

_fails = {}      # url -> consecutive failed checks
_alerted = set()  # urls we've said are down


def copies(db_cursor=None):
    """The other copies to watch: the board's saved list plus FLEET_COPIES,
    each address once, only https on cupq.app or Railway (routes/fleet_routes)."""
    from routes.fleet_routes import _clean_url, _env_copies

    raw = list(_env_copies())
    if db_cursor is not None:
        try:
            import json

            db_cursor.execute("SELECT value FROM settings WHERE key = 'fleet_copies'")
            row = db_cursor.fetchone()
            v = (row[0] if not isinstance(row, dict) else row.get("value")) if row else None
            v = json.loads(v) if isinstance(v, str) else (v or [])
            raw += [c for c in v if isinstance(c, dict)] if isinstance(v, list) else []
        except Exception as e:
            logger.debug("fleet watch: saved list unreadable: %s", e)
    me = (os.getenv("PUBLIC_BASE_URL") or "").rstrip("/")
    out, seen = [], set()
    for c in raw:
        url = _clean_url(c.get("url"))
        if url and url not in seen and url != me:
            seen.add(url)
            out.append({"name": c.get("name") or url, "url": url})
    return out


def answers(url):
    import requests

    try:
        r = requests.get(f"{url}{PROBE_PATH}", timeout=TIMEOUT_S,
                         headers={"User-Agent": "CupQ-fleet-watch/1"})
        return r.status_code == 200
    except Exception:
        return False


def check(cur, alert, probe=answers):
    """One pass over the other copies. Returns the (code, message) raised."""
    raised = []
    for c in copies(cur):
        url, name = c["url"], c["name"]
        host = url.replace("https://", "")
        code = "COPY_DOWN_" + host
        if probe(url):
            _fails[url] = 0
            if url in _alerted:
                _alerted.discard(url)
                msg = f"CupQ: {name} ({host}) is answering again."
                alert("COPY_BACK_" + host, "critical", msg)
                raised.append(("COPY_BACK_" + host, msg))
                try:
                    from services.admin_alerts import _last_sent

                    _last_sent.pop(code, None)
                    _last_sent.pop("COPY_BACK_" + host, None)
                except Exception:
                    pass
            continue
        _fails[url] = _fails.get(url, 0) + 1
        if _fails[url] >= DOWN_AFTER:
            msg = (f"CupQ: {name} ({host}) hasn't answered for {_fails[url]} minutes. "
                   "Check Railway, or run: python scripts/fleet_apply.py list")
            alert(code, "critical", msg)  # admin_alerts' cooldown keeps this to once per 15 min
            raised.append((code, msg))
            _alerted.add(url)
    return raised
