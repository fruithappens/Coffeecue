"""
Self-contained tests for _extract_name_and_order — the opening-message name
guesser. Runs with plain `python3 test_name_extraction.py`.

Bug it pins (2026-06-16): after "Forget me", a customer texted "Last latte"
(meaning their last/usual latte) and the bot replied "Thanks Last!" — it took
the first leftover word as the name. Re-order / generic words must NOT be
treated as names; the bot should ask "what's your first name?" instead.
Real names in the same shape ("Sarah latte", "I'm Bob, latte") must still work.
"""

import sys
import os
from unittest.mock import MagicMock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from services.coffee_system import CoffeeOrderSystem

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


def make_system():
    return CoffeeOrderSystem(MagicMock(), {'EVENT_NAME': 'Test Event'})


def test_reorder_words_are_not_names():
    s = make_system()
    for msg in ["Last latte", "usual flat white", "quick latte",
                "regular cappuccino", "another latte", "same latte"]:
        nm, order = s._extract_name_and_order(msg)
        check(f"'{msg}' -> no name (asks for name instead)", nm is None, f"got name={nm!r}")
        # The order is preserved as either a typed drink or a "usual" request
        # (NLP reads "usual ..." as a re-order intent) — never a bogus name.
        check(f"'{msg}' -> order preserved (drink or usual)",
              bool(order.get('type') or order.get('request_usual')), f"order={order}")


def test_real_names_still_extracted():
    s = make_system()
    cases = [
        ("Sarah latte", "Sarah"),
        ("I'm Bob, large flat white", "Bob"),
        ("Hi, my name is Priya, oat latte", "Priya"),
    ]
    for msg, expected in cases:
        nm, order = s._extract_name_and_order(msg)
        check(f"'{msg}' -> name {expected!r}", nm == expected, f"got {nm!r}")


if __name__ == '__main__':
    print("name-extraction tests")
    test_reorder_words_are_not_names()
    test_real_names_still_extracted()
    print(f"\n{_passed} passed, {_failed} failed")
    sys.exit(1 if _failed else 0)
