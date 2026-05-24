"""
Single source of truth for order status strings on the backend.
Frontend mirror lives in `Barista Front End/src/constants/orderStatus.js`
— keep in sync.

THE BUG WE'RE PREVENTING
------------------------
Status used to be a literal string at 100+ call sites. Some spelled
'in-progress' (hyphen), some 'in_progress' (underscore). Filters that
compared with the wrong spelling silently dropped orders.

USAGE
-----
    from services.order_status import OrderStatus, is_in_progress

    if order_row.status == OrderStatus.PENDING:
        ...

    if is_in_progress(order_row):
        ...
"""
from __future__ import annotations


class OrderStatus:
    """Canonical status strings used in the orders.status DB column.

    IMPORTANT:
    - IN_PROGRESS uses a HYPHEN ('in-progress'). The underscore form
      ('in_progress') is legacy drift; tolerate it on READ via
      is_in_progress(), but always WRITE the canonical form.
    - PICKED_UP uses an UNDERSCORE. Don't 'fix' it without a data
      migration — DB rows have this exact value.
    """

    PENDING     = 'pending'
    IN_PROGRESS = 'in-progress'
    COMPLETED   = 'completed'
    PICKED_UP   = 'picked_up'
    CANCELLED   = 'cancelled'


# Set form for `in` checks.
KNOWN_STATUSES = {
    OrderStatus.PENDING, OrderStatus.IN_PROGRESS,
    OrderStatus.COMPLETED, OrderStatus.PICKED_UP, OrderStatus.CANCELLED,
}


def _norm(s):
    return (s or '').strip().lower() if isinstance(s, str) else ''


def _status_of(order_or_status):
    """Accept either a row/dict with .status / ['status'] or a raw string."""
    if isinstance(order_or_status, str):
        return _norm(order_or_status)
    if isinstance(order_or_status, dict):
        return _norm(order_or_status.get('status'))
    return _norm(getattr(order_or_status, 'status', None))


def is_pending(order_or_status) -> bool:
    return _status_of(order_or_status) == 'pending'


def is_in_progress(order_or_status) -> bool:
    """Tolerates the underscore drift for legacy callers/rows."""
    s = _status_of(order_or_status)
    return s in ('in-progress', 'in_progress', 'inprogress')


def is_completed(order_or_status) -> bool:
    s = _status_of(order_or_status)
    return s in ('completed', 'complete', 'done')


def is_picked_up(order_or_status) -> bool:
    s = _status_of(order_or_status)
    return s in ('picked_up', 'picked-up', 'pickedup', 'collected')


def is_cancelled(order_or_status) -> bool:
    s = _status_of(order_or_status)
    return s in ('cancelled', 'canceled', 'cancel')


def is_active(order_or_status) -> bool:
    """Not yet collected or cancelled — useful for queue counts."""
    return is_pending(order_or_status) or is_in_progress(order_or_status)


def canonical_status(order_or_status):
    """Map a status to its canonical OrderStatus value, normalising
    legacy spellings. Returns None if unrecognised."""
    if is_pending(order_or_status):     return OrderStatus.PENDING
    if is_in_progress(order_or_status): return OrderStatus.IN_PROGRESS
    if is_completed(order_or_status):   return OrderStatus.COMPLETED
    if is_picked_up(order_or_status):   return OrderStatus.PICKED_UP
    if is_cancelled(order_or_status):   return OrderStatus.CANCELLED
    return None


# For SQL `IN` clauses where you want the underscore drift accepted.
IN_PROGRESS_SQL_VARIANTS = ('in-progress', 'in_progress')
PICKED_UP_SQL_VARIANTS   = ('picked_up', 'picked-up')
