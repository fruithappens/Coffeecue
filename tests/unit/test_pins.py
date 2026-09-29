"""utils/pins.py: which PINs are allowed, and that a PIN hashes stably."""
import os

os.environ.setdefault("PIN_PEPPER", "test-pepper")

from utils import pins  # noqa: E402


def test_pin_rules():
    assert pins.pin_problem("4829") is None
    assert pins.pin_problem("48291357") is None
    assert pins.pin_problem("123") == "A PIN is 4 to 8 digits."
    assert pins.pin_problem("123456789") == "A PIN is 4 to 8 digits."
    assert pins.pin_problem("12a4") == "A PIN is 4 to 8 digits."
    assert "same digit" in pins.pin_problem("7777")
    assert "run of digits" in pins.pin_problem("1234")
    assert "run of digits" in pins.pin_problem("6543")


def test_hash_is_stable_and_keyed():
    a = pins.pin_hash("4829")
    assert a == pins.pin_hash("4829")
    assert a != pins.pin_hash("4830")
    assert len(a) == 64
    os.environ["PIN_PEPPER"] = "another-pepper"
    try:
        assert pins.pin_hash("4829") != a
    finally:
        os.environ["PIN_PEPPER"] = "test-pepper"
