"""Background pickup-reminder service.

After a barista taps Complete, the customer gets an immediate
"your drink is ready" SMS (see _notify_customer_order_ready in
routes/consolidated_api_routes.py). But if they don't show up
to collect it, the cup just sits there. This service follows
up with a single gentle reminder SMS after N minutes of being
in 'completed' status without being marked picked_up.

Design:
  - Daemon thread loops every 60 seconds.
  - On each tick, queries orders WHERE status='completed' AND
    picked_up_at IS NULL AND reminder_sent_at IS NULL AND
    completed_at < now() - N minutes.
  - Sends the reminder SMS and stamps reminder_sent_at so we
    never spam the same customer twice.
  - All exceptions are caught and logged; the loop never dies.

Configuration:
  - PICKUP_REMINDER_MINUTES (env / config) — minutes after
    completion to send the reminder. Default 10. Set to 0 to
    disable.
  - PICKUP_REMINDER_INTERVAL_SECONDS — how often the loop
    wakes up. Default 60.

Schema dependency: orders.reminder_sent_at — created by
migration #7 in services/migrations.py.
"""
from __future__ import annotations

import json
import logging
import threading
import time
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)


class PickupReminderService:
    def __init__(self, db, messaging_service, config=None):
        self.db = db
        self.messaging_service = messaging_service
        cfg = config or {}
        self.reminder_minutes = int(cfg.get('PICKUP_REMINDER_MINUTES', 10))
        self.interval_seconds = int(cfg.get('PICKUP_REMINDER_INTERVAL_SECONDS', 60))
        self._stop_event = threading.Event()
        self._thread = None

    def start(self):
        """Start the background reminder loop. No-op if already running
        or if reminder_minutes is 0 (feature disabled)."""
        if self.reminder_minutes <= 0:
            logger.info(
                "[pickup-reminder] disabled "
                "(PICKUP_REMINDER_MINUTES=%s)", self.reminder_minutes
            )
            return
        if self._thread and self._thread.is_alive():
            logger.info("[pickup-reminder] already running")
            return
        self._stop_event.clear()
        self._thread = threading.Thread(
            target=self._loop,
            name='pickup-reminder',
            daemon=True,
        )
        self._thread.start()
        logger.info(
            "[pickup-reminder] started — will remind after %d min, "
            "checking every %d s",
            self.reminder_minutes, self.interval_seconds,
        )

    def stop(self):
        """Stop the background loop. Used by tests."""
        self._stop_event.set()

    def _loop(self):
        while not self._stop_event.is_set():
            try:
                self._tick()
            except Exception as e:
                logger.exception("[pickup-reminder] tick error: %s", e)
            # Sleep in small increments so stop() is responsive
            slept = 0
            while slept < self.interval_seconds and not self._stop_event.is_set():
                time.sleep(1)
                slept += 1

    def _tick(self):
        """One pass: find overdue orders and send reminders."""
        from utils.database import get_db_connection, close_connection
        conn = None
        try:
            conn = get_db_connection()
            cur = conn.cursor()
            cutoff = datetime.now() - timedelta(minutes=self.reminder_minutes)

            # The schema's "completed" status is what /complete sets.
            # picked_up_at IS NULL means barista hasn't tapped Picked Up.
            # reminder_sent_at IS NULL means we haven't reminded yet.
            cur.execute(
                """
                SELECT id, order_number, phone, order_details, station_id
                FROM orders
                WHERE status = 'completed'
                  AND picked_up_at IS NULL
                  AND reminder_sent_at IS NULL
                  AND completed_at IS NOT NULL
                  AND completed_at < %s
                  AND phone IS NOT NULL
                  AND phone != ''
                ORDER BY completed_at ASC
                LIMIT 50
                """,
                (cutoff,),
            )
            rows = cur.fetchall()
            if not rows:
                return

            for row in rows:
                if isinstance(row, dict):
                    order_id = row.get('id')
                    order_number = row.get('order_number')
                    phone = row.get('phone')
                    details_raw = row.get('order_details')
                    station_id = row.get('station_id')
                else:
                    order_id, order_number, phone, details_raw, station_id = row

                details = self._parse_details(details_raw)
                self._send_reminder(phone, order_number, details, station_id)
                # Stamp so we don't re-send. Done in same transaction.
                cur.execute(
                    "UPDATE orders SET reminder_sent_at = %s WHERE id = %s",
                    (datetime.now(), order_id),
                )
            conn.commit()
        except Exception as e:
            logger.exception("[pickup-reminder] DB error: %s", e)
            try:
                if conn:
                    conn.rollback()
            except Exception:
                pass
        finally:
            try:
                if conn:
                    close_connection(conn)
            except Exception:
                pass

    @staticmethod
    def _parse_details(raw):
        if not raw:
            return {}
        if isinstance(raw, dict):
            return raw
        try:
            return json.loads(raw)
        except Exception:
            return {}

    def _send_reminder(self, phone, order_number, details, station_id):
        try:
            name = (details.get('name') or '').strip() or 'there'
            coffee = details.get('type') or 'order'
            milk = details.get('milk')
            size = details.get('size')
            parts = []
            if size:
                parts.append(size)
            parts.append(coffee)
            description = ' '.join(parts).strip() or 'order'
            if milk and milk.lower() not in ('none', 'no milk', ''):
                description = f"{description} with {milk}"
            station_label = f"Station {station_id}" if station_id else 'the counter'
            body = (
                f"👋 Hi {name}, just a reminder — your {description} "
                f"(Order #{order_number}) is still waiting at {station_label}. "
                f"Come grab it before it goes cold!"
            )
            if self.messaging_service:
                self.messaging_service.send_message(phone, body)
                logger.info(
                    "[pickup-reminder] sent reminder for order %s to %s",
                    order_number, phone,
                )
        except Exception as e:
            logger.error(
                "[pickup-reminder] failed sending reminder for %s: %s",
                order_number, e,
            )
