"""During service, check the printers and the texts once a minute and alert
the admin when one stops working (roadmap U4-3).

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


def check_once(app=None, alert=None):
    """One pass. Returns a list of (code, message) it alerted on (for tests
    and logs). `alert` defaults to send_admin_alert."""
    if alert is None:
        from services.admin_alerts import send_admin_alert as alert
    raised = []
    conn = None
    try:
        conn = _connect()
        if conn is None:
            return raised
        cur = conn.cursor()
        # Printers only during service: one switched off overnight is fine.
        for pid, name, secs in (silent_printers(cur) if in_service(cur) else []):
            mins = max(1, secs // 60)
            msg = (f"CupQ: label printer '{name}' hasn't checked in for {mins} min during "
                   "service. Labels won't print until it's back. Check its power, paper "
                   "and network (it should be on the Nighthawk).")
            alert(f"PRINTER_OFFLINE_{pid}", "critical", msg)
            raised.append((f"PRINTER_OFFLINE_{pid}", msg))
        conn.rollback()
    except Exception as e:
        logger.warning("[service-watch] printer check failed: %s", e)
    finally:
        if conn is not None:
            try:
                conn.close()
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
