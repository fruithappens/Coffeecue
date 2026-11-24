"""Orders left waiting from an earlier day are closed automatically.

Nothing used to clear them: three orders from 27-29 Sep 2026 were still
"pending" / "in-progress" on cupq.app in late November, so the next event
would have opened with them at the top of station 2's queue (oldest
first) and counted them in every "You're #N in line".

An order still waiting HOURS after it was placed is closed as cancelled,
with a note saying why. No text is sent and nothing else changes. Orders
scheduled for later (scheduled_for) are left alone until that time has
passed by the same margin. "completed" (made, waiting for pickup) is not
touched: the coffee was made, and reports count it.
"""
import logging

logger = logging.getLogger("expresso.stale_orders")

HOURS = 12
NOTE = "[auto-closed: still waiting 12 h after it was placed]"

SQL = """
    UPDATE orders
       SET status = 'cancelled',
           updated_at = NOW(),
           barista_notes = TRIM(BOTH ' ' FROM COALESCE(barista_notes, '') || ' ' || %s)
     WHERE status IN ('pending', 'in-progress')
       AND created_at < NOW() - make_interval(hours => %s)
       AND (scheduled_for IS NULL OR scheduled_for < NOW() - make_interval(hours => %s))
 RETURNING id, order_number
"""


def close_stale(conn, hours=HOURS):
    """Close every order still waiting `hours` after it was placed.
    Returns the order numbers closed. Commits; rolls back on error."""
    cur = conn.cursor()
    try:
        cur.execute(SQL, (NOTE, hours, hours))
        rows = cur.fetchall()
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    numbers = [r[1] for r in rows]
    if numbers:
        logger.warning(
            "[stale-orders] closed %d order(s) still waiting after %d h: %s",
            len(numbers), hours, ", ".join(str(n) for n in numbers),
        )
    return numbers
