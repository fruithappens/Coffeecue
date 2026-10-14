"""Texts going down AFTER the first good text of the day (failure drill, 15 Oct 2026).

"Texts are down" was "2+ failures and 0 successes since boot". The 5 Sep
outage began right after a redeploy, so that caught it. An outage that
starts mid-event, after texts had been getting out, left the success count
above zero and was never flagged: no barista banner, no admin alert.
"""
import pytest

from services import sms_health


@pytest.fixture(autouse=True)
def fresh_counters():
    saved = dict(sms_health._state)
    for k in ("outbound_ok", "outbound_failed", "outbound_fail_streak"):
        sms_health._state[k] = 0
    sms_health._state["outbound_last_at"] = None
    yield
    sms_health._state.clear()
    sms_health._state.update(saved)


def test_outage_after_a_good_morning_is_flagged():
    for _ in range(40):
        sms_health.note_outbound(ok=True)
    assert not sms_health._outbound_is_down()
    for _ in range(sms_health.FAIL_STREAK_DOWN):
        sms_health.note_outbound(ok=False)
    assert sms_health._outbound_is_down()
    snap = sms_health.snapshot()
    assert snap["outbound_down"] is True
    assert "last 3 attempts failed" in snap["problems"][0]


def test_two_bad_numbers_mid_event_do_not_page_anyone():
    sms_health.note_outbound(ok=True)
    sms_health.note_outbound(ok=False)
    sms_health.note_outbound(ok=False)
    assert not sms_health._outbound_is_down()


def test_one_text_getting_out_clears_it():
    sms_health.note_outbound(ok=True)
    for _ in range(5):
        sms_health.note_outbound(ok=False)
    assert sms_health._outbound_is_down()
    sms_health.note_outbound(ok=True)
    assert not sms_health._outbound_is_down()


def test_boot_rule_unchanged():
    sms_health.note_outbound(ok=False)
    sms_health.note_outbound(ok=False)
    assert sms_health._outbound_is_down()
    assert "0 delivered" in sms_health.snapshot()["problems"][0]
