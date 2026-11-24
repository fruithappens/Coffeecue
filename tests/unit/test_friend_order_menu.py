"""A friend's coffee is checked against the event's menu (24 Nov 2026).

The friend flow used to accept any drink, milk or size: soy with no soy
station, a large at an event that only pours small.
"""
from unittest.mock import patch

import services.coffee_system  # noqa: F401  (loads the mixins in order)
from services.coffee import friends
from services.coffee.menu import MenuMixin


class Fake(friends.FriendsMixin, MenuMixin):
    def _get_available_coffee_types(self):
        return ["latte", "cappuccino", "flat white"]

    def _get_available_milk_types(self):
        return ["full cream", "oat", "skim"]

    def _get_available_sizes(self, coffee_type=None):
        return ["small", "large"]

    def _milk_is_makeable(self, milk_type):
        return True


def check(**order):
    with patch("services.sms_wording._overrides", return_value={}):
        return Fake()._friend_menu_refusal(order)


def test_what_the_event_makes_passes():
    assert check(type="latte", milk="oat", size="large") is None
    assert check(type="latte", milk="no milk", size="small") is None
    assert check(type="cappuccino") is None


def test_milk_not_on_today_is_refused():
    assert check(type="latte", milk="soy").startswith("Sorry, we don't have soy milk.")
    assert check(type="latte", milk="goat").startswith("Sorry, we don't have goat milk.")


def test_size_not_poured_is_refused():
    assert "size 'medium'" in check(type="latte", milk="oat", size="medium")


def test_drink_not_on_menu_is_refused():
    assert check(type="mocha").startswith("Sorry, we don't offer mocha.")
