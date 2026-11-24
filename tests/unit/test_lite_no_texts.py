"""Lite plan: no texts at all (Steve, 24 Nov 2026).

Every text is held -- replies and staff texts too, not only automatic
ones -- the screens behave as if Texts off were on, and an inbound text
gets no reply. Other tiers and unset plans are unchanged.
"""
from unittest.mock import patch

from services import sms_meter
from tests.unit.test_texts_off import _patched


def _with_tier(tier):
    store = {"plan_tier": tier} if tier else {}
    return store, _patched(store)


def test_lite_holds_every_kind_of_text():
    store, (a, b, c) = _with_tier("lite")
    with a, b, c:
        assert sms_meter.plan_has_no_texts() is True
        assert sms_meter.texts_off() is True
        for kind in ("ready", "confirmation", "reply", "manual", "question_reply"):
            ok, why = sms_meter.decide(kind, "hello")
            assert ok is False and "plan has no texts" in why, kind
        # An admin's test send still goes, so a misconfigured number can be checked.
        assert sms_meter.decide("test", "test")[0] is True


def test_other_tiers_and_no_tier_still_text():
    for tier in (None, "standard", "pro", "urn"):
        store, (a, b, c) = _with_tier(tier)
        with a, b, c:
            assert sms_meter.plan_has_no_texts() is False, tier
            assert sms_meter.decide("reply", "hi") == (True, None), tier


def test_lite_cannot_switch_texts_back_on():
    from flask import Flask

    from routes.sms_meter_routes import put_texts_off

    fn = put_texts_off
    while hasattr(fn, "__wrapped__"):  # past the login decorators
        fn = fn.__wrapped__
    app = Flask(__name__)
    with app.test_request_context(json={"texts_off": False}), patch.object(
        sms_meter, "plan_has_no_texts", return_value=True
    ):
        resp, code = fn()
    assert code == 409
    assert "Lite" in resp.get_json()["message"]
