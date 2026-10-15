"""
Self-contained tests for SMS abuse protection (manual blocklist + inbound
burst throttle). Run: `python3 test_sms_abuse_protection.py`.

Pins the behaviour that protects Twilio credit AND avoids false-positives on
legit-but-chatty customers (MENU / VIP / FRIEND group orders / corrections):
  - a machine-gun burst trips (pause + alert), then cools down and self-heals
  - a normal human cadence NEVER trips, even over many messages
  - manual block/unblock works and short-circuits to 'blocked'
"""

import sys
import os
import json
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
    s = CoffeeOrderSystem(MagicMock(), {'EVENT_NAME': 'Test Event'})
    # In-memory settings store so block/unblock persist without a real DB.
    store = {}
    s._set_setting = lambda k, v: (store.__setitem__(k, v), True)[1]
    def fake_load():
        raw = store.get('sms_blocklist')
        if not raw:
            return {}
        d = json.loads(raw) if isinstance(raw, str) else raw
        return d if isinstance(d, dict) else {}
    s._load_sms_blocklist = fake_load
    return s


def test_normal_cadence_never_trips():
    s = make_system()
    # 30 messages, one every 10 seconds (a chatty FRIEND group order pace —
    # the customer waits for a reply between texts). Must all be 'ok'.
    ph = '+61400000010'
    results = [s.register_inbound_sms(ph, now_ts=1000 + i * 10) for i in range(30)]
    check("30 msgs at 10s apart never trip", all(r == 'ok' for r in results),
          f"{[r for r in results if r != 'ok']}")


def test_burst_trips_then_pauses_then_heals():
    s = make_system()
    ph = '+61400000011'
    # 12 messages within ~11s = burst rate; the 13th (>12 in 60s) trips.
    res = [s.register_inbound_sms(ph, now_ts=2000 + i) for i in range(13)]
    check("first 12 fast msgs are ok", all(r == 'ok' for r in res[:12]), f"{res[:12]}")
    check("13th fast msg trips", res[12] == 'tripped', f"got {res[12]}")
    # More messages during the 10-min cooldown are ignored ('paused').
    check("during cooldown → paused", s.register_inbound_sms(ph, now_ts=2100) == 'paused')
    # After the pause window (600s) it serves again.
    check("after cooldown → ok (self-heals)",
          s.register_inbound_sms(ph, now_ts=2000 + 13 + 700) == 'ok')


def test_sustained_backstop():
    s = make_system()
    ph = '+61400000012'
    # 62 messages at 8s apart (~7.5/min): burst stays under 12/60s so the
    # burst rule does NOT fire, but the sustained count exceeds 60 within 600s
    # → trips on the 61st (index 60).
    res = [s.register_inbound_sms(ph, now_ts=3000 + i * 8) for i in range(62)]
    check("sustained flood eventually trips", 'tripped' in res, "never tripped")
    check("sustained flood doesn't trip too early (>50 msgs first)",
          'tripped' in res and res.index('tripped') > 50,
          f"tripped at index {res.index('tripped') if 'tripped' in res else -1}")


def test_block_unblock():
    s = make_system()
    ph = '+61400000013'
    check("not blocked initially", not s.is_sms_blocked(ph))
    check("register ok before block", s.register_inbound_sms(ph, now_ts=4000) == 'ok')
    s.block_sms_number(ph, reason='spam', by='tester')
    check("is_sms_blocked after block", s.is_sms_blocked(ph))
    check("register → blocked after block", s.register_inbound_sms(ph, now_ts=4001) == 'blocked')
    check("blocklist lists the number", any(e['phone'] == ph for e in s.get_sms_blocklist()))
    check("unblock returns True", s.unblock_sms_number(ph) is True)
    check("register ok again after unblock", s.register_inbound_sms(ph, now_ts=4002) == 'ok')
    check("unblock unknown number → False", s.unblock_sms_number('+61499999999') is False)


if __name__ == '__main__':
    print("SMS abuse-protection tests")
    test_normal_cadence_never_trips()
    test_burst_trips_then_pauses_then_heals()
    test_sustained_backstop()
    test_block_unblock()
    print(f"\n{_passed} passed, {_failed} failed")
    sys.exit(1 if _failed else 0)
