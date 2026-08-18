"""In-memory ring buffer of recent log records, for Support -> Diagnostics.

Railway logs to stdout, so there is no file for the app to read back and
`/api/diagnostics/logs` used to return FABRICATED entries ("Sample log
message 0".."9" on a five-minute cadence). That is worse than an empty
list: during a real incident it looks like working diagnostics and sends
you looking in the wrong place. It cost an hour on 2026-08-18 chasing a
lost SMS order.

A bounded deque attached to the root logger costs almost nothing and
gives the one thing that incident actually needed: the last few hundred
warnings and errors, with tracebacks.
"""
import logging
import threading
from collections import deque
from datetime import datetime

# Bounded so a long-running instance can never grow this without limit.
DEFAULT_CAPACITY = 500


class RingBufferHandler(logging.Handler):
    """Keeps the most recent records in memory. Never raises: a logging
    handler that throws would take down the code it is meant to observe."""

    def __init__(self, capacity=DEFAULT_CAPACITY, level=logging.WARNING):
        super().__init__(level=level)
        self._records = deque(maxlen=capacity)
        self._lock = threading.Lock()

    def emit(self, record):
        try:
            entry = {
                'timestamp': datetime.fromtimestamp(record.created).isoformat(),
                'level': record.levelname,
                'logger': record.name,
                'message': record.getMessage(),
            }
            if record.exc_info:
                # The traceback is the whole point — this is what was
                # missing when a request died mid-order.
                entry['traceback'] = self.format(record).split('\n', 1)[-1][:4000]
            with self._lock:
                self._records.append(entry)
        except Exception:
            pass  # never let diagnostics break the app

    def snapshot(self, limit=100, level=None):
        with self._lock:
            items = list(self._records)
        if level:
            wanted = str(level).upper()
            items = [e for e in items if e['level'] == wanted]
        return list(reversed(items))[:limit]


_handler = None


def install(capacity=DEFAULT_CAPACITY, level=logging.WARNING):
    """Attach to the root logger once. Idempotent."""
    global _handler
    if _handler is not None:
        return _handler
    _handler = RingBufferHandler(capacity=capacity, level=level)
    _handler.setFormatter(logging.Formatter('%(message)s'))
    logging.getLogger().addHandler(_handler)
    return _handler


def get_handler():
    return _handler
