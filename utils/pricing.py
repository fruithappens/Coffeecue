"""CupQ prices, in one place (roadmap L6-3, the per-event ledger).

Settled with Steve on 22 Sep 2026, all ex GST. The website's quote tool
(deploy/index.html) carries the same numbers for the public; if a price
changes, change both.

Tier keys match utils/plan_limits.PLAN_LIMITS (lite, standard, pro, urn).
"""

GST = 0.10

# Software, per event: (first day, each extra day). "urn" is quoted.
TIERS = {
    "lite": {"name": "Skim", "first_day": 290, "extra_day": 150},
    "standard": {"name": "Flat White", "first_day": 690, "extra_day": 290},
    "pro": {"name": "Double Shot", "first_day": 1290, "extra_day": 490},
    "urn": {"name": "The Urn", "first_day": None, "extra_day": None},
}

# Add-ons, per event.
ADDONS = {
    "eventsair": {
        "name": "EventsAir link",
        "price": 350,
        "included_in": ("pro", "urn"),
    },
    "square": {
        "name": "Card payments (Square)",
        "price": 150,
        "included_in": ("pro", "urn"),
    },
}

# Hardware dry hire, per item per day.
HARDWARE = {
    "station_kit": {"name": "Station kit", "per_day": 60},
    "label_printer": {"name": "Label printer, incl. labels", "per_day": 90},
    "display_screen": {"name": "Display screen on stand", "per_day": 120},
    "badge_scanner": {"name": "USB badge scanner", "per_day": 30},
}

REMOTE_SETUP = 250  # remote setup and rehearsal, flat
OPERATOR_PER_HOUR = 110  # on-site operator
OPERATOR_MIN_HOURS = 4
TEXT_EACH = 0.15  # texts beyond the plan's allowance


def money(x):
    return round(float(x) + 1e-9, 2)


def software_lines(tier, days):
    t = TIERS.get(tier)
    days = max(1, int(days or 1))
    if not t:
        return [
            {
                "what": "Software: no plan chosen",
                "qty": days,
                "each": 0,
                "amount": 0,
                "note": "Pick a plan in Runner > Settings > Plan",
            }
        ]
    if t["first_day"] is None:
        return [
            {
                "what": f"Software: {t['name']}",
                "qty": days,
                "each": 0,
                "amount": 0,
                "note": "Quoted separately",
            }
        ]
    lines = [
        {
            "what": f"Software: {t['name']}, first day",
            "qty": 1,
            "each": t["first_day"],
            "amount": t["first_day"],
        }
    ]
    if days > 1:
        lines.append(
            {
                "what": f"Software: {t['name']}, extra days",
                "qty": days - 1,
                "each": t["extra_day"],
                "amount": t["extra_day"] * (days - 1),
            }
        )
    return lines


def build(
    tier,
    days,
    *,
    addons=(),
    hardware=None,
    operator_hours=0,
    remote_setup=False,
    texts_used=0,
    texts_included=None,
    texts_charge_override=None,
    travel=0,
    other=(),
):
    """The ledger's charge lines and totals.

    hardware: {key: quantity} hired for every day of the event.
    texts_charge_override: a fixed amount for texts (e.g. a pack sold up
      front); otherwise texts beyond the allowance at TEXT_EACH.
    other: [(what, amount)] free lines (freight, discount as a negative).
    """
    lines = software_lines(tier, days)
    days = max(1, int(days or 1))
    for key in addons or ():
        a = ADDONS.get(key)
        if a and tier not in a["included_in"]:
            lines.append(
                {"what": a["name"], "qty": 1, "each": a["price"], "amount": a["price"]}
            )
    for key, qty in (hardware or {}).items():
        h = HARDWARE.get(key)
        qty = int(qty or 0)
        if h and qty > 0:
            lines.append(
                {
                    "what": f"{h['name']} × {qty}",
                    "qty": qty * days,
                    "each": h["per_day"],
                    "amount": h["per_day"] * qty * days,
                    "note": f"{days} day{'s' if days != 1 else ''}",
                }
            )
    if remote_setup:
        lines.append(
            {
                "what": "Remote setup and rehearsal",
                "qty": 1,
                "each": REMOTE_SETUP,
                "amount": REMOTE_SETUP,
            }
        )
    hours = float(operator_hours or 0)
    if hours > 0:
        billed = max(hours, OPERATOR_MIN_HOURS)
        lines.append(
            {
                "what": "On-site operator",
                "qty": billed,
                "each": OPERATOR_PER_HOUR,
                "amount": money(billed * OPERATOR_PER_HOUR),
                "note": f"{OPERATOR_MIN_HOURS} h minimum" if billed > hours else "",
            }
        )
    if texts_charge_override not in (None, ""):
        amt = money(texts_charge_override)
        if amt:
            lines.append(
                {
                    "what": "Texts",
                    "qty": 1,
                    "each": amt,
                    "amount": amt,
                    "note": f"{texts_used} sent",
                }
            )
    else:
        over = (
            max(0, int(texts_used or 0) - int(texts_included or 0))
            if texts_included is not None
            else 0
        )
        if over:
            lines.append(
                {
                    "what": "Texts beyond the plan's allowance",
                    "qty": over,
                    "each": TEXT_EACH,
                    "amount": money(over * TEXT_EACH),
                }
            )
    if travel:
        lines.append(
            {"what": "Travel", "qty": 1, "each": money(travel), "amount": money(travel)}
        )
    for what, amount in other or ():
        if what and amount:
            lines.append(
                {
                    "what": str(what)[:80],
                    "qty": 1,
                    "each": money(amount),
                    "amount": money(amount),
                }
            )
    subtotal = money(sum(l["amount"] for l in lines))
    gst = money(subtotal * GST)
    return {
        "lines": lines,
        "subtotal": subtotal,
        "gst": gst,
        "total": money(subtotal + gst),
    }
