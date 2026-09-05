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
from utils.station_label import station_label as _station_label
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
        # Cap how stale an order can be and still get a reminder. Without
        # this, a fresh deploy would spam reminders for every historical
        # completed-but-not-picked-up order (test seed data, abandoned
        # orders from last week, etc). Default: only remind about orders
        # completed in the last 4 hours. Set 0 to disable the cap.
        self.max_reminder_age_minutes = int(cfg.get('PICKUP_REMINDER_MAX_AGE_MINUTES', 240))
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
            now = datetime.now()
            cutoff = now - timedelta(minutes=self.reminder_minutes)
            min_completed_at = None
            if self.max_reminder_age_minutes > 0:
                min_completed_at = now - timedelta(minutes=self.max_reminder_age_minutes)

            # The schema's "completed" status is what /complete sets.
            # picked_up_at IS NULL means barista hasn't tapped Picked Up.
            # reminder_sent_at IS NULL means we haven't reminded yet.
            # min_completed_at filter caps how stale an order can be and
            # still earn a reminder (skip historical / abandoned orders).
            if min_completed_at:
                cur.execute(
                    """
                    SELECT id, order_number, phone, order_details, station_id
                    FROM orders
                    WHERE status = 'completed'
                      AND picked_up_at IS NULL
                      AND reminder_sent_at IS NULL
                      AND completed_at IS NOT NULL
                      AND completed_at < %s
                      AND completed_at > %s
                      AND phone IS NOT NULL
                      AND phone != ''
                    ORDER BY completed_at ASC
                    LIMIT 50
                    """,
                    (cutoff, min_completed_at),
                )
            else:
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

            # ONE reminder per round. A round's cups all complete together
            # (the ready text already waits for the last one), so each would
            # earn its own reminder -- Steve's phone showed five reminders
            # for two rounds; a 15-coffee round would be 15 texts. A cup
            # with a group_id is reminded ONCE for the whole round, only
            # when nothing in it is still being made, and every cup is
            # stamped so no sibling sends again (this tick or the next).
            reminded_groups = set()
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
                group_id = details.get('group_id')
                if group_id:
                    gid = str(group_id)
                    if gid in reminded_groups:
                        continue  # a sibling sent this tick; stamped below
                    total, remaining, lead_num, lead_station = self._group_state(cur, gid)
                    if remaining > 0:
                        # Still being made -- not the round's turn yet. Left
                        # unstamped so it is re-evaluated next tick.
                        continue
                    body = self._send_group_reminder(
                        phone, gid, total, details, lead_station or station_id)
                    reminded_groups.add(gid)
                    cur.execute(
                        "UPDATE orders SET reminder_sent_at = %s WHERE "
                        "COALESCE(order_details::jsonb, '{}'::jsonb)->>'group_id' = %s "
                        "AND reminder_sent_at IS NULL",
                        (datetime.now(), gid),
                    )
                    self._record(cur, lead_num or gid, phone, body)
                    continue

                body = self._send_reminder(phone, order_number, details, station_id)
                # Stamp so we don't re-send. Done in same transaction.
                cur.execute(
                    "UPDATE orders SET reminder_sent_at = %s WHERE id = %s",
                    (datetime.now(), order_id),
                )
                self._record(cur, order_number, phone, body)
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

    @staticmethod
    def _record(cur, order_number, phone, body):
        """File the reminder in order_messages (what the barista's per-order
        Messages view reads), on the tick's own transaction. A round's is
        filed against its lead cup. Never raises."""
        if not body:
            return
        try:
            cur.execute(
                "INSERT INTO order_messages (order_number, phone, message, message_sid) "
                "VALUES (%s, %s, %s, %s)",
                (str(order_number), phone, body, 'reminder'),
            )
        except Exception as e:
            logger.debug("[pickup-reminder] order_messages record skipped: %s", e)

    @staticmethod
    def _group_state(cur, group_id):
        """(non-cancelled cups, cups still being made, lead cup number, lead
        cup station) for a round. A lettered round's lead is <base>a; a
        legacy round's lead IS the base. Uses the tick's own cursor."""
        cur.execute(
            "SELECT COUNT(*) FILTER (WHERE status <> 'cancelled') AS total, "
            "       COUNT(*) FILTER (WHERE status NOT IN "
            "         ('completed','picked_up','cancelled')) AS remaining, "
            "       MIN(CASE WHEN order_number IN (%s, %s) THEN order_number END) AS lead_num, "
            "       MIN(CASE WHEN order_number IN (%s, %s) THEN station_id END) AS lead_station "
            "FROM orders WHERE "
            "COALESCE(order_details::jsonb, '{}'::jsonb)->>'group_id' = %s",
            (group_id, f"{group_id}a", group_id, f"{group_id}a", group_id),
        )
        row = cur.fetchone()
        if not row:
            return 0, 0, None, None
        if isinstance(row, dict):
            return (int(row.get('total') or 0), int(row.get('remaining') or 0),
                    row.get('lead_num'), row.get('lead_station'))
        return int(row[0] or 0), int(row[1] or 0), row[2], row[3]

    def _send_group_reminder(self, phone, group_id, count, details, station_id):
        """One reminder for the whole round. Returns the body sent (for the
        message log) or None."""
        try:
            name = (details.get('name') or '').strip() or 'there'
            drinks = f"{count} coffees" if count and count != 1 else "coffee"
            verb = 'are' if count != 1 else 'is'
            tail = 'them before they go cold' if count != 1 else 'it before it goes cold'
            station_text = (_station_label(self.db, station_id) if station_id
                            else 'the counter')
            # ASCII only (see _send_reminder).
            body = (
                f"Hi {name}, just a reminder - your {drinks} (Order #{group_id}) "
                f"{verb} still waiting at {station_text}. Come grab {tail}!"
            )
            if self.messaging_service:
                self.messaging_service.send_message(phone, body)
                logger.info(
                    "[pickup-reminder] sent ONE round reminder for group %s to %s",
                    group_id, phone,
                )
            return body
        except Exception as e:
            logger.error(
                "[pickup-reminder] failed sending round reminder for %s: %s",
                group_id, e,
            )
            return None

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
            station_text = (_station_label(self.db, station_id) if station_id
                            else 'the counter')
            # ASCII only: the wave emoji and the em dash both force UCS-2,
            # which halves the per-segment budget from 160 to 70 and made
            # this reminder cost two segments instead of one.
            body = (
                f"Hi {name}, just a reminder - your {description} "
                f"(Order #{order_number}) is still waiting at {station_text}. "
                f"Come grab it before it goes cold!"
            )
            if self.messaging_service:
                self.messaging_service.send_message(phone, body)
                logger.info(
                    "[pickup-reminder] sent reminder for order %s to %s",
                    order_number, phone,
                )
            return body
        except Exception as e:
            logger.error(
                "[pickup-reminder] failed sending reminder for %s: %s",
                order_number, e,
            )
            return None
