"""One minimum password length everywhere (audit SEC-025)."""
from utils.login_rules import MIN_PASSWORD, password_problem


def test_short_or_missing_passwords_are_refused():
    for bad in (None, "", "a", "x" * (MIN_PASSWORD - 1), 12345678):
        assert password_problem(bad)


def test_eight_characters_is_enough():
    assert password_problem("x" * MIN_PASSWORD) is None
