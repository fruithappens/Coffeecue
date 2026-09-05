"""Group-order lettering: one base number per round, drinks a/b/c.

Steve (Treenet): a round ordered together should read as ONE order with
lettered drinks -- 336a, 336b, 336c -- instead of scattered sequential
numbers (336, 337, 338) that also gap whenever another order interleaves.
A letter, not a dash, so there is no 3-vs-4-digit ambiguity on a cup.

This module is the single home for that scheme so the two places that
place a round -- the app/kiosk group endpoint (routes) and the SMS
multi-drink flow (services) -- letter identically. It lives in utils/ so
both can import it without a circular import (same pattern as
order_provenance).

Design notes that matter:

* The number is PRE-ASSIGNED, before the row is inserted. Order creation
  broadcasts a websocket `new_order` (and may auto-print a label on
  arrival) carrying the number, so renaming afterwards would flash "336"
  on the barista board and then swap to "336a" -- a ghost card. Assigning
  first means every downstream surface only ever sees the final number.
* One `nextval` per round. The sequence advances once, so a solo order
  placed right after a 3-drink round gets 337, not 339: no gaps.
* Only rounds of 2+ drinks are lettered. A single drink is never "336a".
* order_number is VARCHAR(20) UNIQUE -- no schema change, and the UNIQUE
  constraint is the final backstop against any collision.
* The public kiosk endpoint must NOT honour an arbitrary number from the
  request body (anyone could pick numbers). `authorise_preassigned` /
  `consume_preassigned` is an in-process allow-list that only the group
  endpoint populates, immediately before it calls the single-order path.
  The server is one eventlet process, so a module-level set is correct.
"""

import json
import logging
import threading

logger = logging.getLogger(__name__)

# Letters for positions 1..26. Beyond that (never in practice -- the app
# caps a round at 10) we simply stop lettering rather than invent "aa".
_LETTERS = "abcdefghijklmnopqrstuvwxyz"


def group_letter(position):
    """1 -> 'a', 2 -> 'b', ... 26 -> 'z'; anything else -> ''."""
    try:
        i = int(position)
    except (TypeError, ValueError):
        return ""
    if 1 <= i <= len(_LETTERS):
        return _LETTERS[i - 1]
    return ""


def lettered(base, position):
    """'336', 2 -> '336b'. Falls back to the bare base if out of range."""
    return f"{base}{group_letter(position)}"


def is_lettered(order_number):
    """True for a group drink like '336b' / 'C12a' (digit then one letter)."""
    s = str(order_number or "")
    return len(s) >= 2 and s[-1].isalpha() and s[-2].isdigit()


def base_of(order_number):
    """'336b' -> '336'; a plain number is returned unchanged."""
    s = str(order_number or "")
    return s[:-1] if is_lettered(s) else s


def read_order_prefix(conn):
    """The operator's event prefix (e.g. 'C'), or ''. Mirrors the read in
    coffee_system._confirm_order so a lettered base matches solo numbers.
    Never raises."""
    try:
        cur = conn.cursor()
        cur.execute("SELECT value FROM settings WHERE key = 'order_prefix'")
        row = cur.fetchone()
        try:
            cur.close()
        except Exception:
            pass
        if not row:
            return ""
        raw = row[0] if not isinstance(row, dict) else list(row.values())[0]
        if not raw:
            return ""
        parsed = json.loads(raw) if isinstance(raw, str) else raw
        if isinstance(parsed, dict):
            return (parsed.get("prefix") or "").strip()
        if isinstance(parsed, str):
            return parsed.strip()
    except Exception as e:
        logger.debug(f"order_prefix read skipped: {e}")
        try:
            conn.rollback()
        except Exception:
            pass
    return ""


def reserve_order_base(conn):
    """Take ONE number from order_number_seq for a whole round and return
    it with the event prefix applied ('336' or 'C336'). Returns None if the
    sequence is unavailable, in which case the caller must fall back to the
    ordinary per-drink numbering rather than fail the order."""
    try:
        prefix = read_order_prefix(conn)
        cur = conn.cursor()
        cur.execute("SELECT nextval('order_number_seq')")
        row = cur.fetchone()
        try:
            cur.close()
        except Exception:
            pass
        if not row:
            return None
        val = row[0] if not isinstance(row, dict) else list(row.values())[0]
        return f"{prefix}{int(val)}"
    except Exception as e:
        logger.warning(f"reserve_order_base failed (falling back to per-drink numbers): {e}")
        try:
            conn.rollback()
        except Exception:
            pass
        return None


# ---- pre-assignment allow-list for the PUBLIC kiosk endpoint --------------
_preassigned = set()
_preassigned_lock = threading.Lock()


def authorise_preassigned(numbers):
    """Allow these exact numbers to be supplied to the single-order path.
    Called by the group endpoint right before it places each drink."""
    with _preassigned_lock:
        for n in numbers:
            if n:
                _preassigned.add(str(n))


def consume_preassigned(number):
    """True (and the entry is spent) only if `number` was authorised. A
    request body carrying a number nobody authorised gets False, and the
    caller ignores it -- so the public endpoint can't be used to pick
    numbers."""
    if not number:
        return False
    with _preassigned_lock:
        try:
            _preassigned.remove(str(number))
            return True
        except KeyError:
            return False


def discard_preassigned(numbers):
    """Forget authorisations that were never used (a drink failed to place
    before it consumed its number), so the set can't grow unbounded."""
    with _preassigned_lock:
        for n in numbers:
            _preassigned.discard(str(n))
