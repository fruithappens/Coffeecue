"""Knowing a label roll is running out before it does.

Changing a roll takes a minute and any barista can do it. Changing it at
9am with fourteen people waiting is a different event entirely -- at
CTN26 the 9am hour was 41 orders and a 23-minute median wait, and a
paper change in the middle of that is the sort of thing people remember
about the coffee.

Steve: "this might be able to be done in a break and not in peak".

So this is not stock control. It is one number -- roughly how many
labels are left -- and a warning early enough to act on during a lull.

Counting is deliberately simple: labels PRINTED since the roll was
fitted. Not labels queued, because a queued job that never printed did
not consume paper, and over-counting would send someone to change a
roll that is half full.

The count can only ever be approximate. A jam wastes labels the system
never sees, and a test print consumes one. That is fine for the purpose:
the number exists to prompt a look at the printer, not to be audited.
Which is why the warning language is "about" and the threshold is
generous.
"""

# KV key holding per-printer roll state.
ROLL_SETTING_KEY = "label_roll_state"

# Labels on a fresh roll. A starting point, not a fact -- roll sizes
# differ by supplier and label length, so it is configurable per printer
# and the operator should set it from the box.
DEFAULT_ROLL_CAPACITY = 500

# Warn with this many left. Generous on purpose: the whole value is
# having enough runway to change it during a break rather than a peak,
# and a warning that arrives with 10 left has missed the point.
DEFAULT_WARN_AT = 75

# Below this, it is not a heads-up any more.
CRITICAL_AT = 20


def _int(value, fallback):
    try:
        n = int(value)
        return n if n > 0 else fallback
    except (TypeError, ValueError):
        return fallback


def roll_for(state, printer_id):
    """This printer's roll settings, with defaults filled in.

    Never raises and never returns None: an unconfigured printer behaves
    as a fresh default roll rather than disabling the feature, because a
    silent no-warning state is the failure this exists to prevent.
    """
    entry = {}
    if isinstance(state, dict):
        raw = state.get(str(printer_id)) or state.get(printer_id) or {}
        if isinstance(raw, dict):
            entry = raw
    return {
        "capacity": _int(entry.get("capacity"), DEFAULT_ROLL_CAPACITY),
        "warn_at": _int(entry.get("warn_at"), DEFAULT_WARN_AT),
        # ISO timestamp the roll was fitted. None means "never recorded",
        # in which case everything ever printed counts -- which reads
        # low, prompting a change and a reset. Erring towards warning.
        "reset_at": entry.get("reset_at"),
    }


def assess(capacity, used, warn_at=DEFAULT_WARN_AT):
    """Turn a count into something worth showing a barista.

    Returns level, remaining and a sentence. `level` is one of ok, low,
    critical, empty -- the same vocabulary the status dot uses, so the
    two cannot describe the same printer differently.
    """
    cap = _int(capacity, DEFAULT_ROLL_CAPACITY)
    try:
        consumed = max(0, int(used or 0))
    except (TypeError, ValueError):
        consumed = 0
    remaining = max(0, cap - consumed)
    warn = _int(warn_at, DEFAULT_WARN_AT)

    if remaining <= 0:
        level, message = "empty", "Label roll is probably empty - check the printer."
    elif remaining <= CRITICAL_AT:
        level, message = (
            "critical",
            f"About {remaining} labels left - change the roll now.",
        )
    elif remaining <= warn:
        level, message = "low", (
            f"About {remaining} labels left - a good moment to "
            f"change the roll is the next break."
        )
    else:
        level, message = "ok", f"About {remaining} labels left."

    return {
        "level": level,
        "capacity": cap,
        "used": consumed,
        "remaining": remaining,
        "warn_at": warn,
        "message": message,
        # Percentage is for a bar, not for a decision.
        "percent_left": int(round(100.0 * remaining / cap)) if cap else 0,
    }


def set_roll(state, printer_id, capacity=None, warn_at=None, reset_at=None):
    """Update one printer's entry, leaving the others alone.

    Returns a NEW dict rather than mutating, because this is written back
    into a shared settings blob and quietly editing the caller's copy is
    how two settings screens end up fighting.
    """
    out = dict(state) if isinstance(state, dict) else {}
    key = str(printer_id)
    entry = dict(out.get(key) or {})
    if capacity is not None:
        entry["capacity"] = _int(capacity, DEFAULT_ROLL_CAPACITY)
    if warn_at is not None:
        entry["warn_at"] = _int(warn_at, DEFAULT_WARN_AT)
    if reset_at is not None:
        entry["reset_at"] = reset_at
    out[key] = entry
    return out
