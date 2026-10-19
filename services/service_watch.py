"""During service, check the printers and the texts once a minute and alert
the admin when one stops working (roadmap U4-3). Also, at any hour, that a
backup has checked in within the last day (services/backup_watch, S1-14),
and that the other CupQ copies answer (services/fleet_watch, U4-10).

Before this, a printer that went offline mid-service alerted nobody (the
barista found out when labels stopped), and "texts are failing" was only
checked while a barista screen happened to be polling for its banner.

"During service" = an order was placed or touched in the last 30 minutes,
so a printer switched off overnight never texts anyone at 3am.

Alerts go through services.admin_alerts.send_admin_alert: the number and
email set under Runner > Live > Readiness, once per problem per cooldown
(default 15 min), so a printer that stays off texts once, not every minute.

Its own short database connection each check, never the request
connection, so a slow check can't hold up an order.
"""
import logging
import os
import threading

logger = logging.getLogger(__name__)

PRINTER_SILENT_S = int(os.getenv("PRINTER_ALERT_AFTER_S", "180"))
SERVICE_WINDOW_MIN = 30

# Printers we've said are offline: id -> name. When one checks in again the
# admin gets "it's back", so they don't have to go and look (failure drill,
# 15 Oct 2026: the offline text came, nothing ever said it was fixed).
_offline_alerted = {}

# This copy checking itself: the menu a customer's phone loads first, asked
# of this very server once a minute at any hour. cupq.app's connection pool
# ran dry on 17 Oct 2026 and ordering failed for three days while
# /api/health (no database) stayed green and nobody was texted.
SELF_DOWN_AFTER = int(os.getenv("SELF_CHECK_DOWN_AFTER", "3"))
_self = {"fails": 0, "alerted": False}


def site_answers(timeout=15):
    """True if this server serves its public menu (which needs the database)."""
    import urllib.request

    port = os.getenv("PORT", "5001")
    try:
        req = urllib.request.Request(f"http://127.0.0.1:{port}/api/display/menu",
                                     headers={"User-Agent": "CupQ-self-check/1"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status == 200
    except Exception:
        return False


def check_self(alert, probe=None):
    """Count failures; text after SELF_DOWN_AFTER in a row, and again when it
    recovers. Returns (code, message) when it alerted, else None."""
    if (probe or site_answers)():
        _self["fails"] = 0
        if _self["alerted"]:
            _self["alerted"] = False
            msg = "CupQ: ordering is working again (the menu loads)."
            alert("SITE_BACK", "critical", msg)
            try:
                from services.admin_alerts import _last_sent

                _last_sent.pop("SITE_DOWN", None)
            except Exception:
                pass
            return ("SITE_BACK", msg)
        return None
    _self["fails"] += 1
    if _self["fails"] >= SELF_DOWN_AFTER and not _self["alerted"]:
        _self["alerted"] = True
        where = os.getenv("PUBLIC_BASE_URL") or os.getenv("RAILWAY_PUBLIC_DOMAIN") or "this copy"
        msg = (f"CupQ: {where} can't load its menu ({_self['fails']} checks in a row). "
               "Ordering is probably down. Restart the web service in Railway "
               "(Deployments, the active one, Restart).")
        alert("SITE_DOWN", "critical", msg)
        return ("SITE_DOWN", msg)
    return None


def _connect():
    import psycopg2

    url = os.getenv("DATABASE_URL")
    return psycopg2.connect(url, connect_timeout=5) if url else None


def in_service(cur):
    """An order placed or changed in the last SERVICE_WINDOW_MIN minutes."""
    cur.execute(
        "SELECT 1 FROM orders WHERE COALESCE(updated_at, created_at) > NOW() - "
        "(%s || ' minutes')::interval LIMIT 1", (str(SERVICE_WINDOW_MIN),))
    return cur.fetchone() is not None


def silent_printers(cur):
    """Enabled printers that have checked in before but not for
    PRINTER_SILENT_S seconds: (id, name, seconds silent). A printer that has
    never checked in is a setup problem (Readiness shows it), not an outage."""
    cur.execute(
        "SELECT id, name, EXTRACT(EPOCH FROM (NOW() - last_poll_at)) FROM printers "
        "WHERE enabled = TRUE AND last_poll_at IS NOT NULL "
        "AND last_poll_at < NOW() - (%s || ' seconds')::interval",
        (str(PRINTER_SILENT_S),))
    return [(r[0], r[1], int(r[2] or 0)) for r in cur.fetchall()]


def back_online(cur, ids):
    """Of these printer ids, the ones that have checked in within
    PRINTER_SILENT_S seconds."""
    if not ids:
        return []
    cur.execute(
        "SELECT id FROM printers WHERE id = ANY(%s) AND last_poll_at IS NOT NULL "
        "AND last_poll_at >= NOW() - (%s || ' seconds')::interval",
        (list(ids), str(PRINTER_SILENT_S)))
    return [r[0] for r in cur.fetchall()]


def check_once(app=None, alert=None):
    """One pass. Returns a list of (code, message) it alerted on (for tests
    and logs). `alert` defaults to send_admin_alert."""
    if alert is None:
        from services.admin_alerts import send_admin_alert as alert
    raised = []
    # Can this server still serve a customer? Any hour, not just in service.
    try:
        hit = check_self(alert)
        if hit:
            raised.append(hit)
    except Exception as e:
        logger.warning("[service-watch] self check failed: %s", e)
    conn = None
    try:
        conn = _connect()
        if conn is None:
            return raised
        cur = conn.cursor()
        # Printers only during service: one switched off overnight is fine.
        silent = silent_printers(cur) if in_service(cur) else []
        for pid, name, secs in silent:
            mins = max(1, secs // 60)
            msg = (f"CupQ: label printer '{name}' hasn't checked in for {mins} min during "
                   "service. Labels won't print until it's back. Check its power, paper "
                   "and network (it should be on the Nighthawk).")
            alert(f"PRINTER_OFFLINE_{pid}", "critical", msg)
            raised.append((f"PRINTER_OFFLINE_{pid}", msg))
            _offline_alerted[pid] = name
        still_silent = {pid for pid, _n, _s in silent}
        for pid in back_online(cur, [p for p in _offline_alerted if p not in still_silent]):
            name = _offline_alerted.pop(pid, None) or f"printer {pid}"
            msg = f"CupQ: label printer '{name}' is back and printing again."
            # Same severity as the offline text, so whoever got that gets
            # this (the admin alert threshold defaults to critical).
            alert(f"PRINTER_BACK_{pid}", "critical", msg)
            raised.append((f"PRINTER_BACK_{pid}", msg))
            # A fresh outage later should text straight away, not wait out
            # the offline alert's cooldown.
            try:
                from services.admin_alerts import _last_sent

                _last_sent.pop(f"PRINTER_OFFLINE_{pid}", None)
                _last_sent.pop(f"PRINTER_BACK_{pid}", None)
            except Exception:
                pass
        conn.rollback()
    except Exception as e:
        logger.warning("[service-watch] printer check failed: %s", e)
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass

    # Backups (S1-14): texts when no good backup has checked in for a day.
    bconn = None
    try:
        bconn = _connect()
        if bconn is not None:
            from services import backup_watch
            hit = backup_watch.check(bconn.cursor(), alert)
            bconn.rollback()
            if hit:
                raised.append(hit)
    except Exception as e:
        logger.warning("[service-watch] backup check failed: %s", e)
    finally:
        if bconn is not None:
            try:
                bconn.close()
            except Exception:
                pass

    # The other copies (U4-10): demo and client copies, every minute.
    fconn = None
    try:
        fconn = _connect()
        from services import fleet_watch
        raised += fleet_watch.check(fconn.cursor() if fconn is not None else None, alert)
        if fconn is not None:
            fconn.rollback()
    except Exception as e:
        logger.warning("[service-watch] fleet check failed: %s", e)
    finally:
        if fconn is not None:
            try:
                fconn.close()
            except Exception:
                pass

    # Attendee details erased on schedule (L6-2): at most once a day, only
    # when the organiser has set a number of days.
    rconn = None
    try:
        rconn = _connect()
        if rconn is not None:
            from services import retention
            retention.run_daily_if_due(rconn)
    except Exception as e:
        logger.warning("[service-watch] retention run failed: %s", e)
    finally:
        if rconn is not None:
            try:
                rconn.close()
            except Exception:
                pass

    # Texts: the same verdict the barista banner shows, but checked here
    # whether or not a barista screen is open. Not limited to service: it
    # only trips after real sends have failed, so it can't fire overnight.
    try:
        from services import sms_health

        ms = app.config.get("messaging_service") if app is not None else None
        if ms is not None and not getattr(ms, "testing_mode", False):
            snap = sms_health.snapshot(db=None, messaging_service=ms)
            if snap.get("outbound_down"):
                msg = (snap.get("problems") or ["Outbound texts are failing."])[0]
                alert("SMS_OUTBOUND_DOWN", "critical", f"CupQ: {msg}")
                raised.append(("SMS_OUTBOUND_DOWN", msg))
    except Exception as e:
        logger.warning("[service-watch] text check failed: %s", e)
    return raised


class ServiceWatch:
    def __init__(self, app, interval_s=60):
        self.app = app
        self.interval_s = max(30, int(interval_s))
        self._stop = threading.Event()
        self._thread = None

    def start(self):
        if self._thread and self._thread.is_alive():
            return
        self._thread = threading.Thread(target=self._run, name="service-watch", daemon=True)
        self._thread.start()
        logger.info("[service-watch] started: printers and texts every %ds during service",
                    self.interval_s)

    def stop(self):
        self._stop.set()

    def _run(self):
        self._stop.wait(90)  # let the app finish booting
        while not self._stop.is_set():
            try:
                with self.app.app_context():
                    raised = check_once(self.app)
                if raised:
                    logger.warning("[service-watch] alerted: %s", [c for c, _ in raised])
            except Exception as e:
                logger.warning("[service-watch] tick error: %s", e)
            self._stop.wait(self.interval_s)
