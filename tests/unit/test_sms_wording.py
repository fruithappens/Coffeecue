"""The text bot's editable wording (X7-6): an edit can't break a conversation."""
from unittest.mock import patch

from services import sms_wording as w


def _with(overrides):
    return patch.object(w, "_overrides", return_value=overrides)


def test_defaults_when_nothing_is_set():
    with _with({}):
        assert w.say("order_cancelled", order_number="12") == (
            "Your order #12 has been cancelled. Text us when you'd like to place a new order."
        )


def test_an_override_is_used_with_its_placeholders():
    with _with({"order_cancelled": "Done: #{order_number} is cancelled."}):
        assert w.say("order_cancelled", order_number="12") == "Done: #12 is cancelled."


def test_a_broken_override_falls_back_to_the_default():
    for bad in ("Done #{order_numbr}", "Done #{order_number", "Done {}"):
        with _with({"order_cancelled": bad}):
            assert w.say("order_cancelled", order_number="12").startswith(
                "Your order #12"
            )


def test_problems_named_plainly():
    assert "unknown placeholder" in w.problems("order_cancelled", "#{oops}")
    assert "isn't part of a placeholder" in w.problems("order_cancelled", "oops {")
    assert w.problems("order_cancelled", "#{order_number} gone") is None
    assert "longer than" in w.problems("no_name_yet", "x" * (w.MAX_LEN + 1))


def test_every_default_is_valid():
    for key, (default, holders, _) in w.CATALOG.items():
        assert w.problems(key, default) is None, key
