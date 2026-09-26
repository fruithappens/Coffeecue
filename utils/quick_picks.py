"""Quick picks: the organiser's one-tap drinks.

A lounge (Virgin, Adelaide) or a busy event sells the same three or four
drinks to most people. A quick pick is one of those drinks set up once --
drink, milk, size -- and shown as a big button at the top of the ordering
screen, so the common order is one tap and a name instead of four steps.

Stored as a JSON list under the `quick_picks` settings row. Two jobs live
here, both pure so they are testable without a database:

* normalize_picks() cleans whatever the Runner saved (or whatever a stale
  row holds) into a short, well-formed list. It never raises.
* resolve_picks() checks each pick against the LIVE menu the kiosk is
  about to show. A pick whose drink or milk is off today (switched off,
  86'd, no station makes it) is dropped rather than shown -- a one-tap
  button that then gets refused would be worse than no button.
"""

MAX_PICKS = 6
MAX_LABEL = 40

# Milk values that mean "no milk" -- the kiosk sends 'no milk' for a black
# drink, the Runner may save an empty string.
_NO_MILK = {"", "none", "no milk", "black"}


def _clean(s, limit=60):
    return " ".join(str(s or "").split())[:limit]


def _fold_milk(s):
    """'Skim Milk' -> 'skim', matching the menu's own milk folding."""
    v = _clean(s).lower()
    if v.endswith(" milk"):
        v = v[:-5].strip()
    return v


def normalize_picks(raw):
    """Return a clean list of {drink, milk, size, label} dicts.

    Accepts anything: a list, a JSON-decoded blob, None, garbage. Entries
    without a drink are dropped, duplicates (same drink+milk+size) keep the
    first, and the list is capped at MAX_PICKS.
    """
    if not isinstance(raw, list):
        return []
    out, seen = [], set()
    for item in raw:
        if not isinstance(item, dict):
            continue
        drink = _clean(item.get("drink")).lower()
        if not drink:
            continue
        milk = _fold_milk(item.get("milk"))
        if milk in _NO_MILK:
            milk = ""
        size = _clean(item.get("size")).lower()
        key = (drink, milk, size)
        if key in seen:
            continue
        seen.add(key)
        out.append(
            {
                "drink": drink,
                "milk": milk,
                "size": size,
                "label": _clean(item.get("label"), MAX_LABEL),
            }
        )
        if len(out) >= MAX_PICKS:
            break
    return out


def _find(entries, wanted, fold=lambda s: _clean(s).lower()):
    for e in entries or []:
        if not isinstance(e, dict):
            continue
        if fold(e.get("value")) == wanted or fold(e.get("name")) == wanted:
            return e
    return None


def _available(entry):
    return bool(entry) and not entry.get("unavailable") and bool(entry.get("stations"))


def resolve_picks(picks, menu):
    """Picks that can actually be ordered from `menu` right now.

    `menu` is the kiosk menu dict (coffee_types / milks / sizes lists of
    {name, value, stations[, unavailable]}). Each surviving pick carries
    the menu's own `value`s -- exactly what the order form would send had
    the customer tapped through -- plus display names and a label.
    """
    menu = menu or {}
    out = []
    for p in normalize_picks(picks):
        drink = _find(menu.get("coffee_types"), p["drink"])
        if not _available(drink):
            continue
        milk = None
        if p["milk"]:
            milk = _find(menu.get("milks"), p["milk"], fold=_fold_milk)
            if not _available(milk):
                continue
        sizes = menu.get("sizes") or []
        size = None
        if p["size"]:
            size = _find(sizes, p["size"])
            # A size the event no longer offers falls back to the default
            # cup rather than hiding the pick: the drink is still right.
        if size is None and sizes:
            size = sizes[0]
        drink_name = drink.get("name") or p["drink"].title()
        milk_name = (milk.get("name") if milk else "") or ""
        label = p["label"] or (
            f"{drink_name} · {milk_name}" if milk_name else drink_name
        )
        out.append(
            {
                "drink": drink.get("value"),
                "drink_name": drink_name,
                "milk": milk.get("value") if milk else "",
                "milk_name": milk_name,
                "size": (size or {}).get("value", "") if isinstance(size, dict) else "",
                "label": label,
            }
        )
    return out
