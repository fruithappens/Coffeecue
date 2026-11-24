"""A refused order is never reported as placed, whatever the wording
(25 Nov 2026), and an unconfirmed friend's coffee isn't in the group."""
from unittest.mock import patch

import services.coffee_system  # noqa: F401  (loads the mixins in order)
from services.coffee.conversation import ConversationMixin
from services.coffee.friends import FriendsMixin
from services.coffee.placing import PlacingMixin


class Nlp:
    def format_order_summary(self, od):
        return od.get("type", "?")


class Fake(ConversationMixin, FriendsMixin, PlacingMixin):
    """reply: what _confirm_order says; places: whether it saves the order."""

    SUGAR_SELF_SERVE_NOTE = ""
    db = None

    def __init__(self, reply, places):
        self.reply, self.places, self.nlp, self.state = reply, places, Nlp(), None
        self.temp = {}

    def _confirm_order(self, phone, od, name, is_friend_order=False):
        if self.places:
            od["_created_order_number"] = "42"
        return self.reply

    def _set_conversation_state(self, phone, state, temp=None):
        self.state, self.temp = state, temp or {}

    def _get_conversation_state(self, phone):
        return {"state": self.state, "temp_data": self.temp}

    def _apply_self_serve_sugar(self, od):
        return False

    def _pre_event_settings(self):
        return {}

    def _get_setting_fresh(self, key, default=None):
        return default

    def _format_price_tail(self, od):
        return ""

    def _format_group_total(self, orders):
        self.totalled = list(orders)
        return ""

    def _ensure_group_id_on_order(self, **kw):
        pass


def test_a_refusal_worded_by_the_organiser_is_not_a_recap():
    bot = Fake("No coffee at the moment, mate.", places=False)
    assert bot._place_order("+1", "Alex", {"type": "latte"}) == (
        "No coffee at the moment, mate."
    )
    assert bot.state is None


def test_a_placed_order_worded_sorry_is_still_placed():
    bot = Fake("Sorry for the wait! Order #42 is in.", places=True)
    assert "That's: latte." in bot._place_order("+1", "Alex", {"type": "latte"})
    assert bot.state == "completed"


def test_yes_to_a_refused_usual_gets_no_friend_tip():
    bot = Fake("Ordering has stopped.", places=False)
    state = {"temp_data": {"order_details": {"type": "latte"}, "name": "Alex"}}
    assert bot._handle_awaiting_confirmation("+1", "YES", state) == (
        "Ordering has stopped."
    )


SAM = {"type": "mocha", "milk": "oat", "name": "Sam"}


def friend(bot, msg):
    state = {
        "temp_data": {
            "primary_name": "Alex",
            "primary_order": {"type": "latte"},
            "friend_name": "Sam",
            "friend_order": dict(SAM),
            "group_orders": [dict(SAM)],
            "group_id": "41",
        }
    }
    with patch("services.sms_wording._overrides", return_value={}):
        return bot._handle_awaiting_friend_confirmation("+1", msg, state)


def test_a_refused_friend_is_not_counted():
    bot = Fake("Ordering has stopped.", places=False)
    assert friend(bot, "YES") == "Ordering has stopped."
    assert bot.state == "awaiting_friend_decision"
    assert bot.temp["group_orders"] == []


def test_a_confirmed_friend_is_counted():
    bot = Fake("Order #42 confirmed.", places=True)
    assert "That's 2 coffees" in friend(bot, "YES")


def test_a_milk_question_stays_the_friends():
    bot = Fake("Which milk instead?", places=False)
    bot.state = "awaiting_milk"
    friend(bot, "YES")
    assert bot.state == "awaiting_friend_milk"
    assert bot.temp["friend_name"] == "Sam"
    assert "milk" not in bot.temp["friend_order"]


def test_cancel_edit_and_done_leave_the_friend_out():
    for msg in ("NO", "EDIT", "FRIEND"):
        bot = Fake("", places=False)
        friend(bot, msg)
        assert bot.temp["group_orders"] == [], msg
    bot = Fake("", places=False)
    reply = friend(bot, "DONE")
    assert reply.startswith("Sam's coffee wasn't confirmed")
    assert "coffees has been confirmed" not in reply
