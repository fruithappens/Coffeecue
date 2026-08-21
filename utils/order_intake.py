"""Order intake gate — is the system currently accepting NEW customer orders?

Why this exists
---------------
"Stop All Operations" on the Support → Emergency tab wrote an
`emergency_mode` setting, and nothing in the codebase ever read it. The
button froze the orders that already existed but did nothing to stop new
ones, so an operator could hit the big red button in an actual emergency
and watch the queue keep filling with no indication why. This module is
the missing half.

Two levels, deliberately distinct:

  emergency_mode    Stop All Operations. Freezes in-progress orders AND
                    refuses new ones. The "something is wrong" switch.

  ordering_locked   Lock System. Refuses new orders but leaves everything
                    in the queue running, so the baristas work through
                    what they have. The everyday "last orders before the
                    keynote" switch.

Scope: CUSTOMER-initiated intake only — SMS, the kiosk, and the attendee
app. Staff-authenticated order creation (a barista adding a walk-in at
the machine) is deliberately NOT gated: locking the public queue should
not stop the people running the event from putting an order in.

Fail-open on purpose. If the settings read raises, ordering continues and
we log loudly. An event that cannot take orders because this check hit a
transient database error is a worse failure than one that accepts a few
orders during a stop.
"""
import logging

logger = logging.getLogger("expresso.order_intake")

# Shown to the customer. Plain ASCII only — an emoji or em-dash pushes the
# SMS into UCS-2 and doubles the cost of every one of these replies.
EMERGENCY_MESSAGE = (
    "Sorry, coffee ordering is paused right now. Please check with the "
    "event team - we'll be back shortly."
)
LOCKED_MESSAGE = (
    "Sorry, we've stopped taking new orders for now. Please check with "
    "the coffee station for the next serving time."
)


def _flag(db, key):
    """Read one boolean settings key. True only for an explicit 'true'."""
    cursor = None
    try:
        cursor = db.cursor()
        cursor.execute("SELECT value FROM settings WHERE key = %s", (key,))
        row = cursor.fetchone()
        if not row:
            return False
        val = row['value'] if isinstance(row, dict) else row[0]
        return str(val).strip().lower() == 'true'
    finally:
        if cursor is not None:
            try:
                cursor.close()
            except Exception:
                pass


def intake_blocked_reason(db):
    """Return a customer-facing message if new orders are refused, else None.

    Emergency wins over lock — if both are set, the customer is told the
    stronger thing.
    """
    try:
        if _flag(db, 'emergency_mode'):
            return EMERGENCY_MESSAGE
        if _flag(db, 'ordering_locked'):
            return LOCKED_MESSAGE
    except Exception as e:
        # Fail OPEN. See the module docstring.
        logger.error(
            "Order intake gate could not be evaluated, allowing the order "
            "through: %s", e
        )
        try:
            db.rollback()
        except Exception:
            pass
    return None
