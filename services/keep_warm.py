"""Stop the container idling down between orders.

WHY
---
The leading explanation for "SMS was dead when I arrived, then fixed
itself" is a cold start. Railway can idle a service down; the first
inbound webhook after a quiet spell then lands on an app that is still
booting. Twilio waits about fifteen seconds and gives up. The customer
gets silence, and the order never existed at all — there is nothing to
find afterwards, which is precisely why the demo failure was
unexplainable.

Event days have exactly the traffic shape that triggers this: a long
quiet morning, then everyone at once during the first break. The first
person in the queue is the one who pays for it.

WHY THE PING GOES OUT AND BACK IN
---------------------------------
It would be cheaper to call the health function directly in-process,
but that proves nothing and prevents nothing: the platform decides
whether to idle a service on the traffic it sees at its edge. So the
ping is a real HTTP request to our own public hostname, which is the
only kind of request that counts.

SAFETY
------
This runs on a daemon thread with a short timeout and swallows
everything. A keep-warm that can hang or crash the app it is meant to
protect would be strictly worse than no keep-warm — this codebase has
already lost production once to a single blocking call.
"""
from __future__ import annotations

import logging
import os
import threading
import time
import urllib.request

logger = logging.getLogger(__name__)

DEFAULT_MINUTES = 4.0
# Comfortably under Twilio's ~15s webhook patience, so a slow ping can
# never itself become the thing that holds a worker.
REQUEST_TIMEOUT_S = 8


def _public_base_url():
    """The externally reachable base URL, or None if we cannot tell.

    RAILWAY_PUBLIC_DOMAIN is set by Railway and carries no scheme.
    PUBLIC_URL is the manual override for anywhere else.
    """
    explicit = os.getenv("PUBLIC_URL", "").strip().rstrip("/")
    if explicit:
        return explicit if explicit.startswith("http") else f"https://{explicit}"
    domain = os.getenv("RAILWAY_PUBLIC_DOMAIN", "").strip().rstrip("/")
    if domain:
        return f"https://{domain}"
    return None


class KeepWarmService:
    def __init__(self, interval_minutes=None, path="/api/health"):
        if interval_minutes is None:
            try:
                interval_minutes = float(
                    os.getenv("KEEP_WARM_MINUTES", DEFAULT_MINUTES)
                )
            except (TypeError, ValueError):
                interval_minutes = DEFAULT_MINUTES
        self.interval_s = max(0.0, float(interval_minutes)) * 60.0
        self.base_url = _public_base_url()
        self.path = path
        self._thread = None
        self._stop = threading.Event()
        self.consecutive_failures = 0

    @property
    def enabled(self):
        return self.interval_s > 0 and bool(self.base_url)

    def start(self):
        if not self.enabled:
            logger.info(
                "Keep-warm disabled (interval=%.1fmin, public URL=%s). Set "
                "KEEP_WARM_MINUTES and PUBLIC_URL/RAILWAY_PUBLIC_DOMAIN to "
                "enable.",
                self.interval_s / 60.0,
                self.base_url,
            )
            return False
        self._thread = threading.Thread(target=self._run, name="keep-warm", daemon=True)
        self._thread.start()
        logger.info(
            "Keep-warm pinging %s%s every %.1f min",
            self.base_url,
            self.path,
            self.interval_s / 60.0,
        )
        return True

    def stop(self):
        self._stop.set()

    def _ping_once(self):
        url = f"{self.base_url}{self.path}"
        req = urllib.request.Request(url, headers={"User-Agent": "cupq-keep-warm"})
        started = time.time()
        with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT_S) as resp:
            resp.read(256)
            return resp.status, time.time() - started

    def _run(self):
        # Don't ping the instant we boot — we are demonstrably warm, and
        # the app may still be finishing startup.
        if self._stop.wait(self.interval_s):
            return
        while not self._stop.is_set():
            try:
                status, elapsed = self._ping_once()
                if status == 200:
                    # A ping that took a long time is the cold start we
                    # are trying to prevent, so it is worth saying out
                    # loud even though it succeeded.
                    if elapsed > 5:
                        logger.warning(
                            "Keep-warm ping OK but SLOW (%.1fs) — the "
                            "container was probably cold.",
                            elapsed,
                        )
                    self.consecutive_failures = 0
                else:
                    self.consecutive_failures += 1
                    logger.warning("Keep-warm ping returned HTTP %s", status)
            except Exception as e:
                self.consecutive_failures += 1
                # Only escalate once it is a pattern; a single failed
                # ping is usually the network, not the service.
                level = logger.error if self.consecutive_failures >= 3 else logger.info
                level(
                    "Keep-warm ping failed (%d in a row): %s",
                    self.consecutive_failures,
                    e,
                )
            self._stop.wait(self.interval_s)
