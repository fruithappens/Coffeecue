"""The code that turns an ordering iPad into a barista station.

This one is a security boundary, not a convenience: the device sits
unattended in a public foyer and the session it grants can see customer
names and phone numbers. So the tests are about what must NEVER happen,
not about the happy path.
"""

import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(
    0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
)

from utils.station_unlock import (MAX_ATTEMPTS, MIN_CODE_LENGTH,  # noqa: E402
                                  hash_code, is_enabled, lockout_remaining,
                                  normalise, recent_failures, record_failure,
                                  validate_new_code, verify_code)

NOW = datetime(2026, 8, 24, 9, 0, tzinfo=timezone.utc)


def _ago(minutes):
    return (NOW - timedelta(minutes=minutes)).isoformat()


# --- the code itself ---------------------------------------------------


def test_spacing_is_not_part_of_the_secret():
    # Codes get read off a card in pairs and typed that way.
    stored = hash_code("cupq4718")
    assert verify_code("cupq 4718", stored)
    assert verify_code("  cupq4718  ", stored)
    assert normalise(" 12 34 56 ") == "123456"


def test_the_obvious_codes_are_refused_when_set():
    for bad in ("123456", "111111", "000000", "654321", "password", "coffee"):
        ok, message = validate_new_code(bad)
        assert not ok, f"{bad} was accepted"
        assert message


def test_short_codes_are_refused():
    assert not validate_new_code("12345")[0]
    assert not validate_new_code("cupq99")[0]  # 6 is no longer enough
    assert not validate_new_code("")[0]
    assert not validate_new_code(None)[0]


def test_digits_only_needs_to_be_longer():
    # Ten symbols is a much smaller alphabet than thirty-six, and there
    # is no global lock backing this up any more.
    assert not validate_new_code("41830672")[0]  # 8 digits
    assert validate_new_code("4183067241")[0]  # 10 digits
    assert validate_new_code("cupq4718")[0]  # 8 with letters


def test_runs_of_digits_are_refused_at_any_length():
    assert not validate_new_code("2345678")[0]
    assert not validate_new_code("9876543")[0]


def test_a_reasonable_code_is_accepted():
    assert validate_new_code("cupq4718")[0]
    assert validate_new_code("ctn26-cart")[0]


def test_a_wrong_code_never_verifies():
    stored = hash_code("cupq4718")
    for wrong in ("cupq4719", "", None, "CUPQ4718", " ", "cupq47180"):
        assert not verify_code(wrong, stored)


def test_a_broken_stored_hash_reads_as_wrong_not_as_open():
    # A corrupted setting must lock the door, not open it.
    for broken in (None, "", "not-a-hash", 42, {}, []):
        assert not verify_code("cupq4718", broken)


# --- the switch --------------------------------------------------------


def test_enabled_requires_both_a_switch_and_a_code():
    assert is_enabled({"enabled": True, "code_hash": "x"})
    assert not is_enabled({"enabled": True})  # on, but nothing to check
    assert not is_enabled({"code_hash": "x"})  # code set, but off
    assert not is_enabled({})
    assert not is_enabled(None)
    assert not is_enabled("yes")


# --- the throttle ------------------------------------------------------


def test_a_few_failures_do_not_lock_anyone_out():
    attempts = [_ago(1)] * (MAX_ATTEMPTS - 1)
    assert lockout_remaining(attempts, NOW) == 0


def test_enough_failures_lock_it():
    attempts = [_ago(1)] * MAX_ATTEMPTS
    assert lockout_remaining(attempts, NOW) > 0


def test_a_lockout_expires_on_its_own():
    # Locked at breakfast, usable by morning tea, with nobody clearing
    # anything.
    attempts = [_ago(120)] * MAX_ATTEMPTS
    assert lockout_remaining(attempts, NOW) == 0


def test_a_corrupted_attempt_log_cannot_lock_the_fallback_out():
    # This is the one that matters: the fallback is needed precisely
    # when things are already going wrong, so junk in the log must not
    # be the reason a barista cannot bring up the spare device.
    for junk in (None, "lots", 5, [None], ["nonsense"], [{}], [[]]):
        assert lockout_remaining(junk, NOW) == 0
        assert recent_failures(junk, NOW) == []


def test_recording_a_failure_prunes_stale_entries():
    attempts = [_ago(500), _ago(400), _ago(1)]
    out = record_failure(attempts, NOW)
    assert len(out) == 2  # the recent one, plus the new one
    assert all(isinstance(x, str) for x in out)


def test_the_attempt_log_cannot_grow_without_bound():
    attempts = []
    for _ in range(200):
        attempts = record_failure(attempts, NOW)
    assert len(attempts) <= MAX_ATTEMPTS * 2


def test_the_minimum_is_long_enough_to_stand_without_a_global_lock():
    # There is no global failure lock, on purpose: it would let anyone
    # disable the backup station. That decision only holds while the
    # code itself is long enough that scripted guessing is hopeless, so
    # this pins the length the reasoning depends on.
    assert MIN_CODE_LENGTH >= 8
