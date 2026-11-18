"""The text blocklist and the flood guard.

Methods of CoffeeOrderSystem, moved here unchanged from
services/coffee_system.py (roadmap X7-11). CoffeeOrderSystem inherits
SmsGuardMixin, so self.<method>() reaches them exactly as before.
"""
import json
from datetime import datetime
from services.coffee_system import (  # noqa: F401  (defined above the mixin imports)
    logger,
)


class SmsGuardMixin:
    def _load_sms_blocklist(self):
        """Return the blocklist as {normalised_phone: {reason, by, at}} - read
        FRESH from the settings table (not the cache) so a just-blocked number
        takes effect immediately."""
        try:
            try:
                self.db.rollback()
            except Exception:
                pass
            cursor = self.db.cursor()
            cursor.execute("SELECT value FROM settings WHERE key = 'sms_blocklist'")
            row = cursor.fetchone()
            if not row or not row[0]:
                return {}
            raw = row[0] if not isinstance(row, dict) else row.get("value")
            data = json.loads(raw) if isinstance(raw, str) else raw
            if isinstance(data, dict):
                return data
            if isinstance(data, list):  # legacy plain-list shape
                return {p: {} for p in data}
            return {}
        except Exception as e:
            logger.warning(f"_load_sms_blocklist failed: {e}")
            try:
                self.db.rollback()
            except Exception:
                pass
            return {}

    def is_sms_blocked(self, phone):
        try:
            p = self._normalize_phone(phone)
        except Exception:
            p = phone
        return p in self._load_sms_blocklist()

    def block_sms_number(self, phone, reason="", by=""):
        try:
            p = self._normalize_phone(phone)
        except Exception:
            p = phone
        bl = self._load_sms_blocklist()
        bl[p] = {
            "reason": reason or "",
            "by": by or "",
            "at": datetime.now().isoformat(),
        }
        self._set_setting("sms_blocklist", json.dumps(bl))
        logger.info(f"SMS number blocked: {p} (by={by!r}, reason={reason!r})")
        return p

    def unblock_sms_number(self, phone):
        try:
            p = self._normalize_phone(phone)
        except Exception:
            p = phone
        bl = self._load_sms_blocklist()
        if p in bl:
            del bl[p]
            self._set_setting("sms_blocklist", json.dumps(bl))
            logger.info(f"SMS number unblocked: {p}")
            return True
        return False

    def get_sms_blocklist(self):
        bl = self._load_sms_blocklist()
        return [
            {"phone": p, **(v if isinstance(v, dict) else {})} for p, v in bl.items()
        ]

    def register_inbound_sms(self, phone, now_ts=None):
        """Record an inbound SMS and decide how to treat it. Returns:
          'ok'      - handle normally (reply)
          'blocked' - on the manual blocklist (ignore, no reply)
          'paused'  - within cooldown from an earlier burst trip (ignore)
          'tripped' - JUST crossed the burst/sustained threshold (ignore + alert)
        In-memory per-number sliding window on the singleton; `now_ts` is
        overridable for tests."""
        ts = now_ts if now_ts is not None else datetime.now().timestamp()
        try:
            p = self._normalize_phone(phone)
        except Exception:
            p = phone

        if self.is_sms_blocked(p):
            return "blocked"

        pauses = getattr(self, "_sms_pause_until", None)
        if pauses is None:
            pauses = {}
            self._sms_pause_until = pauses
        log = getattr(self, "_sms_inbound_log", None)
        if log is None:
            log = {}
            self._sms_inbound_log = log

        # Still cooling down from a previous trip?
        until = pauses.get(p, 0)
        if until and ts < until:
            return "paused"

        # Append this timestamp, pruning anything older than the larger window.
        window = max(self._SMS_BURST_WINDOW, self._SMS_SUSTAINED_WINDOW)
        times = [t for t in log.get(p, []) if ts - t <= window]
        times.append(ts)
        log[p] = times

        burst = sum(1 for t in times if ts - t <= self._SMS_BURST_WINDOW)
        sustained = len(times)  # already pruned to the larger window
        if burst > self._SMS_BURST_MAX or sustained > self._SMS_SUSTAINED_MAX:
            pauses[p] = ts + self._SMS_PAUSE_SECONDS
            log[p] = []  # reset so post-cooldown counting starts clean
            self._last_sms_burst_count = burst
            return "tripped"
        return "ok"

    def sms_spam_alert(self, phone, burst_count=None):
        """Post a ONE-OFF alert into the barista Messages inbox
        (customer_questions) when a number is auto-paused, so a human can judge
        spam vs a real customer who needs help. Mirrors
        _forward_question_to_baristas' insert + WS event. Never raises."""
        try:
            p = self._normalize_phone(phone)
        except Exception:
            p = phone
        n = (
            burst_count
            or getattr(self, "_last_sms_burst_count", 0)
            or self._SMS_BURST_MAX
        )
        mins = self._SMS_PAUSE_SECONDS // 60
        msg = (
            f"{p} sent {n}+ texts very fast and was auto-paused for {mins} "
            f"min to protect SMS credit. If it's a real customer who needs "
            f"help, assist them at the counter - replies resume automatically "
            f"after the pause. If it's spam, block the number."
        )
        try:
            try:
                self.db.rollback()
            except Exception:
                pass
            cursor = self.db.cursor()
            cursor.execute(
                """INSERT INTO customer_questions
                     (phone, customer_name, question, status, created_at)
                   VALUES (%s, %s, %s, 'pending', %s) RETURNING id, created_at""",
                (p, "⚠️ Possible SMS spam", msg, datetime.now()),
            )
            row = cursor.fetchone()
            self.db.commit()
            qid = row[0] if row else None
            created = row[1] if row else datetime.now()
        except Exception as e:
            logger.error(f"sms_spam_alert insert failed: {e}")
            try:
                self.db.rollback()
            except Exception:
                pass
            return
        try:
            from flask import current_app as _ca

            socketio = _ca.config.get("socketio") if _ca else None
            if socketio:
                socketio.emit(
                    "customer_question",
                    {
                        "id": qid,
                        "phone": p,
                        "customer_name": "⚠️ Possible SMS spam",
                        "customerName": "⚠️ Possible SMS spam",
                        "question": msg,
                        "created_at": created.isoformat() + "Z"
                        if hasattr(created, "isoformat")
                        else str(created),
                        "createdAt": created.isoformat() + "Z"
                        if hasattr(created, "isoformat")
                        else str(created),
                    },
                    room="orders",
                )
        except Exception as ws_err:
            logger.debug(f"sms_spam_alert WS emit skipped: {ws_err}")
