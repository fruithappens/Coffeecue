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


def test_every_say_in_the_bot_has_a_catalogue_entry():
    # A typo'd key would raise KeyError mid-conversation; catch it here.
    import re
    from pathlib import Path

    root = Path(__file__).resolve().parents[2]
    used = set()
    for f in [root / "services" / "coffee_system.py", *(root / "services" / "coffee").glob("*.py")]:
        used |= set(re.findall(r"\bsay\(\s*[\"']([a-z_]+)[\"']", f.read_text()))
    assert used, "no say() calls found"
    assert used - set(w.CATALOG) == set()


def test_batch_two_placeholders_fill_in():
    with _with({}):
        assert w.say("name_updated", name="Robin") == (
            "Name updated to: Robin\nYour next order will use this name."
        )
        assert w.say("data_deleted", service="CupQ").endswith("Thanks for using CupQ.")
        assert w.say("friend_own_order_first", name="Sam").startswith("Hi Sam! ")


def test_an_order_confirmation_cannot_lose_its_number():
    assert w.problems("order_placed", "Thanks!") == "must include {order_number}"
    assert "{order}" in w.problems("order_recap", "{placed} Cheers")
    with _with({"order_placed": "Thanks!"}):
        assert "#7" in w.say("order_placed", order_number="7", queue="")


def test_recap_reads_as_before():
    with _with({}):
        assert w.say("order_recap", placed="Order #7 confirmed.", order="latte", price="\nTotal: $5") == (
            "Order #7 confirmed.\nThat's: latte.\nTotal: $5 Wrong? CHANGE or OOPS. Add another with FRIEND."
        )
