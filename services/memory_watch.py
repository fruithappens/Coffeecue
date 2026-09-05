"""Memory watchdog + on-demand allocation tracing.

Why this exists
---------------
Railway's memory graph for 29 Aug - 5 Sep 2026 is a sawtooth: the process
climbs from ~200 MB toward ~1 GB and is reset by a restart, over and over.
Some of those restarts are deploys. On 4 Sep -- Treenet day 2, the busiest
day -- there were NO deploys and it still dropped several times: the server
restarted itself mid-event, most likely killed for memory. Each restart is a
short outage plus reset state (counters, the reminder thread, live sockets).

Nothing in the source holds an obviously unbounded structure (the module-
level caches are bounded or cleaned on disconnect), so the growth has to be
MEASURED on the running process rather than guessed at. Three things here:

  1. A daemon thread logs RSS + thread count once a minute ("[memory] ...")
     so the ramp shows up in Railway's logs next to what the app was doing.
  2. Above MEMORY_ALERT_MB (default 700) it fires the existing admin alert
     (email/SMS, per-code cooldown) ONCE per crossing -- "memory is high, a
     forced restart is likely" -- so the operator hears about it BEFORE the
     container dies, not after. Re-arms once RSS falls 100 MB below the line.
  3. tracemalloc can be switched on/off at runtime by an admin (see
     routes/health_api.py: /api/health/memory) and the top allocation sites
     read back, so the leak can be located on prod without a redeploy. OFF
     by default: tracing costs CPU and memory of its own.

Never raises into the app: every public function swallows and logs.
"""
from __future__ import annotations

import logging
import os
import sys
import threading
import time
import tracemalloc

logger = logging.getLogger(__name__)

_BOOT_AT = time.time()
_ALERT_MB = int(os.getenv("MEMORY_ALERT_MB", "700") or 700)


def rss_mb() -> float:
    """Resident set size in MB. psutil normally; a getrusage fallback that
    reports the PEAK (ru_maxrss) if psutil is ever missing."""
    try:
        import psutil

        return psutil.Process(os.getpid()).memory_info().rss / (1024 * 1024)
    except Exception:
        try:
            import resource

            ru = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
            # Linux reports KB, macOS bytes.
            return ru / 1024.0 if sys.platform != "darwin" else ru / (1024 * 1024)
        except Exception:
            return 0.0


def snapshot(app=None) -> dict:
    """Process metrics for the health check: RSS, uptime, threads, live
    Socket.IO clients (the per-client server queues are a leak suspect),
    and whether tracing is on."""
    clients = None
    try:
        sio = app.config.get("socketio") if app is not None else None
        if sio is not None:
            clients = len(getattr(getattr(sio, "server", None), "eio", None).sockets)
    except Exception:
        clients = None
    return {
        "rss_mb": round(rss_mb(), 1),
        "uptime_s": int(time.time() - _BOOT_AT),
        "threads": threading.active_count(),
        "socketio_clients": clients,
        "tracemalloc": tracemalloc.is_tracing(),
        "alert_mb": _ALERT_MB,
    }


def trace(enabled: bool, frames: int = 1) -> bool:
    """Switch tracemalloc on/off at runtime. Returns the new state."""
    try:
        if enabled and not tracemalloc.is_tracing():
            tracemalloc.start(max(1, min(int(frames or 1), 10)))
            logger.warning("[memory] tracemalloc STARTED (frames=%s) -- costs CPU + memory; switch off when done", frames)
        elif not enabled and tracemalloc.is_tracing():
            tracemalloc.stop()
            logger.warning("[memory] tracemalloc stopped")
    except Exception as e:
        logger.warning("[memory] tracemalloc toggle failed: %s", e)
    return tracemalloc.is_tracing()


def top_allocations(n: int = 25) -> dict:
    """Top-n allocation sites by size while tracing. Grouped by file:line so
    the answer reads as 'this line of this file is holding N MB'."""
    if not tracemalloc.is_tracing():
        return {"tracing": False, "top": []}
    try:
        snap = tracemalloc.take_snapshot()
        cur, peak = tracemalloc.get_traced_memory()
        out = []
        for s in snap.statistics("lineno")[: max(1, min(int(n or 25), 200))]:
            fr = s.traceback[0]
            where = fr.filename
            # Trim the container's site-packages prefix so the list is readable.
            for marker in ("/site-packages/", "/app/"):
                if marker in where:
                    where = where.split(marker, 1)[1]
                    break
            out.append({"where": f"{where}:{fr.lineno}", "size_mb": round(s.size / 1048576, 2), "count": s.count})
        return {"tracing": True, "traced_mb": round(cur / 1048576, 1), "peak_mb": round(peak / 1048576, 1), "top": out}
    except Exception as e:
        return {"tracing": True, "error": str(e), "top": []}


class MemoryWatchService:
    """Once a minute: log RSS; alert the admin once per crossing of the line."""

    def __init__(self, db=None, interval_s: int = 60):
        self.db = db
        self.interval_s = max(15, int(interval_s))
        self._stop = threading.Event()
        self._thread = None
        self._armed = True

    def start(self):
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="memory-watch", daemon=True)
        self._thread.start()
        logger.info("[memory] watchdog started -- logging RSS every %ds, alert above %d MB", self.interval_s, _ALERT_MB)

    def stop(self):
        self._stop.set()

    def _boot_report(self):
        """Say the server started -- and whether that was a DEPLOY (new build)
        or a RESTART of the same build (a crash, an OOM kill, a health-check
        restart). On Treenet day 2 the server restarted several times with no
        deploy and nobody knew for a day. Railway sets RAILWAY_DEPLOYMENT_ID
        per deploy; the last one is remembered in the settings KV, so a boot
        carrying the SAME id is a restart and is alerted (email/SMS)."""
        try:
            dep = (os.getenv("RAILWAY_DEPLOYMENT_ID") or "").strip()
            sha = (os.getenv("RAILWAY_GIT_COMMIT_SHA") or "")[:7]
            if not dep or self.db is None:
                logger.info("[boot] started (no deployment id; not reporting)")
                return
            from routes.consolidated_api_routes import _kv_get, _kv_put
            last = _kv_get(self.db, "last_deployment_id", default=None)
            if last != dep:
                _kv_put(self.db, "last_deployment_id", dep)
                logger.info("[boot] new deploy %s (%s) -- not a restart", dep[:8], sha)
                return
            from services.admin_alerts import send_admin_alert
            logger.warning("[boot] RESTART of the same deploy %s (%s)", dep[:8], sha)
            send_admin_alert(
                "SERVER_RESTARTED", "critical",
                (f"CupQ server RESTARTED at {time.strftime('%H:%M')} without a deploy "
                 f"(build {sha or dep[:8]}). It is back up; orders and the board recover "
                 f"on their own, but the reminder timer and live counters reset. If this "
                 f"repeats, check Railway's logs for the cause."),
                db=self.db)
        except Exception as e:
            logger.warning("[boot] report failed: %s", e)
            try:
                self.db.rollback()
            except Exception:
                pass

    def _run(self):
        # First tick waits 75 s: long enough for the DB and alert config to be
        # readable, short enough that a restart is reported inside two minutes.
        self._stop.wait(75)
        if not self._stop.is_set():
            self._boot_report()
        while not self._stop.is_set():
            try:
                self._tick()
            except Exception as e:
                logger.warning("[memory] tick error: %s", e)
            self._stop.wait(self.interval_s)

    def _tick(self):
        mb = rss_mb()
        # Hand freed C-allocator memory back to the OS. glibc keeps freed
        # blocks inside per-thread arenas and only trims the main heap top,
        # so RSS climbs with request volume while Python's heap stays flat
        # (measured 2026-09-05: +20 MB RSS / 2 min under load, tracemalloc
        # flat). malloc_trim(0) releases what it can; it is cheap (ms) and
        # a no-op anywhere it isn't glibc. Logged before/after so the
        # effect is visible in the same line the ramp shows up in.
        trimmed = None
        try:
            if sys.platform.startswith("linux"):
                import ctypes
                libc = ctypes.CDLL("libc.so.6")
                if libc.malloc_trim(0):
                    trimmed = rss_mb()
        except Exception:
            trimmed = None
        if trimmed is not None and trimmed < mb - 1:
            logger.info("[memory] malloc_trim released %.0f MB (rss %.0f -> %.0f MB)", mb - trimmed, mb, trimmed)
            mb = trimmed
        up_min = int((time.time() - _BOOT_AT) / 60)
        logger.info(
            "[memory] rss=%.0fMB threads=%d uptime=%dm%s",
            mb, threading.active_count(), up_min, " tracing" if tracemalloc.is_tracing() else "",
        )
        if mb >= _ALERT_MB and self._armed:
            self._armed = False
            try:
                from services.admin_alerts import send_admin_alert

                send_admin_alert(
                    "MEMORY_HIGH",
                    "critical",
                    (f"CupQ server memory is {mb:.0f} MB (alert line {_ALERT_MB} MB), "
                     f"climbing since the last restart {up_min} min ago. A forced restart "
                     f"is likely soon - a short outage, then it recovers on its own. "
                     f"Nothing to do at the cart; this is for the operator."),
                    db=self.db,
                )
            except Exception as e:
                logger.warning("[memory] alert failed: %s", e)
        elif mb < _ALERT_MB - 100:
            self._armed = True
