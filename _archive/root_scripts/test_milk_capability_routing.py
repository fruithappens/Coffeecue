"""
Self-contained tests for the milk-capability routing fix (the #165 bug).

Runs with plain `python3 test_milk_capability_routing.py` — no pytest, no
Postgres, no Twilio.

Background: a fresh customer texted "oat latte" with no station specified.
The SMS gate accepted oat (no active station defined milk_types -> fail-open),
but _assign_station substituted a hardcoded 'full cream'/'skim' default, found
no station "with" oat, and SILENTLY dumped the order on station 1 with a false
"confirmed" SMS. These tests pin the corrected behaviour:

  - when NO active station can make the milk, _confirm_order asks the customer
    for a milk we can make (and parks the conversation), instead of confirming
  - when stations exist but truly none are active, the generic "no stations"
    message is used
  - _no_capable_milk_message names the requested milk + offers makeable milks
"""

import sys
import os
from unittest.mock import MagicMock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import utils.database as database
from services.coffee_system import CoffeeOrderSystem


def make_system():
    db = MagicMock()
    system = CoffeeOrderSystem(db, {'EVENT_NAME': 'Test Event'})
    system._get_available_milk_types = lambda: [
        'full cream', 'skim', 'soy', 'almond', 'no milk'
    ]
    # Don't let the order actually parse/price against the mock DB.
    system._compute_order_price = lambda od: (None, None)
    return system


# ---------- tiny runner -----------------------------------------------------

_passed = 0
_failed = 0


def check(name, cond, detail=''):
    global _passed, _failed
    if cond:
        _passed += 1
        print(f"  \033[32mPASS\033[0m {name}")
    else:
        _failed += 1
        print(f"  \033[31mFAIL\033[0m {name}  {detail}")


# ---------- tests -----------------------------------------------------------

def test_no_capable_milk_message():
    s = make_system()
    parked = {}
    s._set_conversation_state = lambda phone, state, data=None: parked.update(
        {'phone': phone, 'state': state, 'data': data})
    msg = s._no_capable_milk_message('+61400000001', 'Steve',
                                     {'type': 'latte', 'milk': 'oat',
                                      'size': 'medium', 'sugar': 'no sugar'})
    check("names the requested milk", 'oat' in msg.lower(), msg)
    check("asks for another milk", 'what milk' in msg.lower(), msg)
    check("offers makeable milks", 'soy' in msg.lower() and 'almond' in msg.lower(), msg)
    check("does NOT confirm an order", 'confirmed' not in msg.lower()
          and 'order #' not in msg.lower(), msg)
    check("parks conversation at awaiting_milk", parked.get('state') == 'awaiting_milk', parked)
    check("drops the unmakeable milk from parked order",
          'milk' not in (parked.get('data', {}).get('order_details', {})), parked)


def test_confirm_order_reasks_when_no_station_can_make_milk():
    s = make_system()
    # No station can make the milk; but stations DO exist and are active.
    s._assign_station = lambda *a, **k: (None, False)
    s._has_active_station = lambda: True
    s._set_conversation_state = lambda *a, **k: None
    # Avoid real DB during order-number/VIP lookups.
    database.get_db_connection = lambda *a, **k: MagicMock()

    reply = s._confirm_order('+61400000002', {
        'type': 'latte', 'milk': 'oat', 'size': 'medium', 'sugar': 'no sugar'
    }, 'Ada')
    check("re-ask returned (not a confirmation)",
          isinstance(reply, str) and 'oat' in reply.lower() and 'what milk' in reply.lower(),
          repr(reply))
    check("did NOT silently confirm onto a station",
          'confirmed' not in reply.lower(), repr(reply))


def test_confirm_order_generic_when_no_active_stations():
    s = make_system()
    s._assign_station = lambda *a, **k: (None, False)
    s._has_active_station = lambda: False  # genuinely no stations open
    s._set_conversation_state = lambda *a, **k: None
    database.get_db_connection = lambda *a, **k: MagicMock()

    reply = s._confirm_order('+61400000003', {
        'type': 'latte', 'milk': 'oat', 'size': 'medium', 'sugar': 'no sugar'
    }, 'Bob')
    check("generic 'no stations available' message",
          isinstance(reply, str) and 'no coffee stations' in reply.lower(),
          repr(reply))


def _system_with_stations(station_rows):
    """Build a system whose _assign_station sees exactly `station_rows`.

    _assign_station calls self.db.cursor().fetchall() three times in order:
    event_breaks (none), live order load (none), then the station_stats rows.
    db.cursor() returns the same mock cursor each call, so a single fetchall
    side_effect list scripts all three.
    """
    s = make_system()
    cur = s.db.cursor.return_value
    cur.fetchall.side_effect = [[], [], list(station_rows)]
    s._get_routing_rules = lambda: {
        'considerCapabilities': True, 'balanceWorkload': True,
        'prioritizeEfficiency': True, 'emergencyMode': False,
    }
    s._get_station_wait_time = lambda station_id: 5
    return s


def test_assign_unconfigured_station_is_wildcard():
    # Stations with NO capabilities must be treated as "can make any milk"
    # (matches the SMS gate fail-open) — an oat order must NOT strand.
    s = _system_with_stations([
        (1, 0, {}, 'active'),
        (2, 0, {}, 'active'),
    ])
    station_id, delayed = s._assign_station(False, 'oat', 'latte', 'medium')
    check("unconfigured stations route oat to a real station",
          station_id in (1, 2), f"got {station_id}")


def test_assign_configured_without_oat_returns_none():
    # Both stations explicitly list only full cream/skim -> none can make oat.
    # Must return None (NOT a silent station-1 fallback).
    s = _system_with_stations([
        (1, 0, {'milk_types': ['full cream', 'skim']}, 'active'),
        (2, 0, {'milk_types': ['full cream', 'skim']}, 'active'),
    ])
    station_id, delayed = s._assign_station(False, 'oat', 'latte', 'medium')
    check("configured-without-oat returns None (no silent station 1)",
          station_id is None, f"got {station_id}")


def test_assign_routes_to_the_one_station_with_oat():
    s = _system_with_stations([
        (1, 0, {'milk_types': ['full cream', 'skim']}, 'active'),
        (2, 0, {'milk_types': ['full cream', 'skim', 'oat']}, 'active'),
    ])
    station_id, delayed = s._assign_station(False, 'oat', 'latte', 'medium')
    check("oat routes to the station that lists oat", station_id == 2, f"got {station_id}")


def test_assign_full_cream_still_balances_across_both():
    # A makeable milk must still pick one of the capable stations (sanity:
    # the wildcard/None changes didn't break normal routing).
    s = _system_with_stations([
        (1, 0, {'milk_types': ['full cream', 'skim']}, 'active'),
        (2, 0, {'milk_types': ['full cream', 'skim']}, 'active'),
    ])
    station_id, delayed = s._assign_station(False, 'full cream', 'latte', 'medium')
    check("full cream routes to a real station", station_id in (1, 2), f"got {station_id}")


if __name__ == '__main__':
    print("milk-capability routing tests")
    test_no_capable_milk_message()
    test_confirm_order_reasks_when_no_station_can_make_milk()
    test_confirm_order_generic_when_no_active_stations()
    test_assign_unconfigured_station_is_wildcard()
    test_assign_configured_without_oat_returns_none()
    test_assign_routes_to_the_one_station_with_oat()
    test_assign_full_cream_still_balances_across_both()
    print(f"\n{_passed} passed, {_failed} failed")
    sys.exit(1 if _failed else 0)
