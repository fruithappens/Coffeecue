"""Plan-tier limits, matching the pricing page at cupq.com.au.

One CupQ deployment serves one customer's event(s) at a time -- no table
has an event column (see docs/reference), so a "plan" is a single
settings value Steve sets when he provisions that customer's instance,
not a multi-tenant billing system. Unset (the default -- true of every
deployment that predates this file) means no limits at all: existing
and manually-provisioned instances keep behaving exactly as they do
today until someone opts them into a tier.

Unlike utils/order_intake.py's emergency/lock gate, the attendee cap
applies to EVERY order-creation path, including a barista's own walk-in
entry. That gate exists to stop the public queue; this one exists to
cap how many different people an event actually serves, and exempting
staff-entered orders would make the cap trivial to route around by
keying every order in at the counter instead of letting people self-order.

Fail-open throughout, same reasoning as order_intake.py: a transient DB
error should never be the thing that stops a real coffee order.
"""

import logging

logger = logging.getLogger("expresso.plan_limits")

# "sms" is the plan's included texts, counted in billed segments -- the
# allowances Steve settled on 22 Sep. services/sms_meter.py enforces it
# (or the organiser's own cap, if they set one).
#
# Keys match the tier values the pricing-page quote tool already uses
# (deploy/index.html's #qTier radios), so the same word means the same
# thing on the website and in this setting.
PLAN_LIMITS = {
    "lite": {
        "sms": 500,
        "attendees": 150,
        "stations": 1,
        "vip": False,
        "group_orders": False,
        "square": False,
        "badge_scan": False,
        "white_label": False,
    },
    "standard": {
        "sms": 2000,
        "attendees": 400,
        "stations": 2,
        "vip": False,
        "group_orders": False,
        "square": False,
        "badge_scan": False,
        "white_label": False,
    },
    "pro": {
        "sms": 6000,
        "attendees": 1000,
        "stations": None,
        "vip": True,
        "group_orders": True,
        "square": True,
        "badge_scan": True,
        "white_label": True,
    },
    "urn": {
        "sms": None,
        "attendees": None,
        "stations": None,
        "vip": True,
        "group_orders": True,
        "square": True,
        "badge_scan": True,
        "white_label": True,
    },
}
# No plan_tier set (every instance today): unlimited, matching current
# behaviour exactly -- gating only ever switches on once Steve sets a tier.
UNLIMITED = {
    "sms": None,
    "attendees": None,
    "stations": None,
    "vip": True,
    "group_orders": True,
    "square": True,
    "badge_scan": True,
    "white_label": False,
}

# Plain ASCII only -- see [[expresso-sms-cost]]: an emoji or em-dash pushes
# an SMS reply into UCS-2 and doubles its cost.
ATTENDEE_CAP_MESSAGE = (
    "Sorry, this event has reached its attendee limit. "
    "Please check with the event team."
)
GROUP_ORDER_DISABLED_MESSAGE = (
    "Group ordering isn't included on this event's plan. "
    "Please order one coffee at a time."
)


def _setting(db, key):
    cursor = None
    try:
        cursor = db.cursor()
        cursor.execute("SELECT value FROM settings WHERE key = %s", (key,))
        row = cursor.fetchone()
        if not row:
            return None
        return row["value"] if isinstance(row, dict) else row[0]
    except Exception as e:
        logger.error("plan_limits: setting read failed for %s: %s", key, e)
        return None
    finally:
        if cursor is not None:
            try:
                cursor.close()
            except Exception:
                pass


def get_limits(db):
    """The active tier's limits, or UNLIMITED if no tier is set."""
    tier = _setting(db, "plan_tier")
    return PLAN_LIMITS.get(tier, UNLIMITED)


def feature_allowed(db, feature):
    """True unless the active tier explicitly excludes `feature`. Fails
    open -- a broken settings read must never take a feature down."""
    try:
        return bool(get_limits(db).get(feature, True))
    except Exception as e:
        logger.error("plan_limits: feature check failed for %s: %s", feature, e)
        return True


def shows_powered_by(db):
    """Whether guest screens sign "powered by CupQ". Lite and Standard do;
    Pro and Urn (rental) are white-label. No tier set = shown, as today.

    Fails CLOSED to showing it -- the opposite of feature_allowed -- because
    a broken read must never quietly hand out the paid white-label look.
    """
    try:
        return not bool(get_limits(db).get("white_label", False))
    except Exception as e:
        logger.error("plan_limits: white-label check failed: %s", e)
        return True


def attendee_cap_message(db, phone):
    """A customer-facing decline if `phone` would be a NEW attendee past
    the plan's cap, else None. A phone that has already ordered is
    always let through -- the cap limits how many different people
    order, not how many times someone already in re-orders."""
    try:
        cap = get_limits(db).get("attendees")
        if cap is None:
            return None
        phone = (phone or "").strip()
        cursor = db.cursor()
        if phone:
            cursor.execute("SELECT 1 FROM orders WHERE phone = %s LIMIT 1", (phone,))
            if cursor.fetchone():
                return None
        cursor.execute(
            "SELECT COUNT(DISTINCT phone) FROM orders "
            "WHERE phone IS NOT NULL AND phone != ''"
        )
        row = cursor.fetchone()
        count = (row[0] if not isinstance(row, dict) else list(row.values())[0]) or 0
        if count >= cap:
            logger.info("plan_limits: attendee cap reached (%s/%s)", count, cap)
            return ATTENDEE_CAP_MESSAGE
    except Exception as e:
        logger.error(
            "plan_limits: attendee cap check failed, allowing the order through: %s", e
        )
        try:
            db.rollback()
        except Exception:
            pass
    return None


def station_cap_message(db):
    """A caller-facing decline if the plan's station cap is already
    reached, else None."""
    try:
        cap = get_limits(db).get("stations")
        if cap is None:
            return None
        cursor = db.cursor()
        cursor.execute("SELECT COUNT(*) FROM station_stats")
        row = cursor.fetchone()
        count = (row[0] if not isinstance(row, dict) else list(row.values())[0]) or 0
        if count >= cap:
            return (
                f"This event's plan includes up to {cap} "
                f"station{'s' if cap != 1 else ''}."
            )
    except Exception as e:
        logger.error(
            "plan_limits: station cap check failed, allowing the create through: %s", e
        )
        try:
            db.rollback()
        except Exception:
            pass
    return None
