"""Background question-timeout sweeper.

Customer texts BARISTA → coffee_system inserts a row in
customer_questions (status='pending'). Baristas have 60 seconds to
reply via the UI; this daemon catches the ones nobody answered.

On each tick (every 10s):
  1. Find customer_questions rows where status='pending' AND
     created_at < (now - QUESTION_TIMEOUT_SECONDS).
  2. For each, send a fallback SMS to the customer:
       "Sorry, all baristas busy right now — want to continue
        ordering? Reply YES, or text BARISTA again to retry."
  3. Mark the row status='timed_out' (so it doesn't fire twice and
     so the Barista UI removes it from the pending badge).
  4. Emit a WebSocket event 'customer_question_timed_out' so any
     open Barista UI updates its badge immediately.

Configuration:
  - QUESTION_TIMEOUT_SECONDS (env / config) — default 60.
  - QUESTION_TIMEOUT_INTERVAL_SECONDS — default 10. Loop tick.

Schema dependency: migration #10 _m010_customer_questions.

Mirrors the shape of services/pickup_reminder.py — same defensive
patterns (caught exceptions never kill the loop, rollback on read
failure, daemon thread so it dies with the process).
"""
from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)


class QuestionTimeoutService:
    def __init__(self, db, messaging_service, config=None):
        self.db = db  # singleton conn — only used as fallback
        self.messaging_service = messaging_service
        cfg = config or {}
        self.timeout_seconds = int(cfg.get('QUESTION_TIMEOUT_SECONDS', 60))
        self.interval_seconds = int(cfg.get('QUESTION_TIMEOUT_INTERVAL_SECONDS', 10))
        self._stop_event = threading.Event()
        self._thread = None
        # Optional Flask app for SocketIO emit — set by app.py via
        # set_app() so we don't import flask globally and create
        # circular import risk.
        self._app = None

    def set_app(self, app):
        """Wire the Flask app so we can grab socketio/messaging on
        each tick (the singleton on self may already be torn down)."""
        self._app = app

    def start(self):
        """Start the daemon. No-op if disabled or already running."""
        if self.timeout_seconds <= 0:
            logger.info(
                "[question-timeout] disabled "
                "(QUESTION_TIMEOUT_SECONDS=%s)", self.timeout_seconds,
            )
            return
        if self._thread and self._thread.is_alive():
            logger.info("[question-timeout] already running")
            return
        self._stop_event.clear()
        self._thread = threading.Thread(
            target=self._loop, name='question-timeout', daemon=True,
        )
        self._thread.start()
        logger.info(
            "[question-timeout] started — %d s timeout, checking every %d s",
            self.timeout_seconds, self.interval_seconds,
        )

    def stop(self):
        self._stop_event.set()

    def _loop(self):
        while not self._stop_event.is_set():
            try:
                self._tick()
            except Exception as e:
                logger.exception("[question-timeout] tick error: %s", e)
            slept = 0
            while slept < self.interval_seconds and not self._stop_event.is_set():
                time.sleep(1)
                slept += 1

    def _tick(self):
        """One pass: time out overdue pending questions."""
        from utils.database import get_db_connection, close_connection
        conn = None
        try:
            conn = get_db_connection()
            cur = conn.cursor()
            cutoff = datetime.now() - timedelta(seconds=self.timeout_seconds)
            # Race-safe: only flip 'pending' → 'timed_out'. A barista
            # racing us with /reply will match first (their UPDATE
            # filters status='pending' too) and we'll match zero rows
            # for that ID.
            cur.execute(
                """
                UPDATE customer_questions
                   SET status = 'timed_out',
                       timeout_at = %s
                 WHERE status = 'pending'
                   AND created_at < %s
                RETURNING id, phone, customer_name, question
                """,
                (datetime.now(), cutoff),
            )
            timed_out_rows = cur.fetchall() or []
            conn.commit()

            if not timed_out_rows:
                return

            for row in timed_out_rows:
                if isinstance(row, dict):
                    qid = row.get('id')
                    phone = row.get('phone')
                    name = row.get('customer_name') or ''
                else:
                    qid, phone, name, _q = row
                self._send_fallback(phone, name)
                self._emit_timed_out(qid)
                logger.info(
                    "[question-timeout] question %s timed out (phone %s)",
                    qid, phone,
                )
        except Exception as e:
            logger.exception("[question-timeout] DB error: %s", e)
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

    def _send_fallback(self, phone, name):
        """No customer-facing 'all baristas are slammed' SMS.

        Steve (live test): that message reads worse than silence — a
        customer who's texted assumes the barista has it, and (with the
        reply-routing fix) the barista genuinely does: the answer sits on
        the order's question card. So the sweeper still clears the pending
        badge after the timeout, but sends the customer nothing. Left as a
        no-op (rather than deleted) so the tick's call site is unchanged and
        a future soft nudge can slot straight back in here if wanted."""
        return

    def _emit_timed_out(self, qid):
        """Fire 'customer_question_timed_out' so any open Barista UI
        removes it from the pending list immediately."""
        if not self._app:
            return
        try:
            socketio = self._app.config.get('socketio')
            if not socketio:
                return
            socketio.emit(
                'customer_question_timed_out',
                {'id': qid, 'status': 'timed_out'},
                room='orders',
            )
        except Exception as e:
            logger.debug("[question-timeout] WS emit skipped: %s", e)
