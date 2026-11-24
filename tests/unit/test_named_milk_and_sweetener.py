"""A named milk or sweetener is never swapped or dropped (24 Nov 2026).

'latte with goat milk' was confirmed as OAT ('oat' is inside 'goat'),
'latte no milk' as full cream, and 'with honey' lost the honey.
"""
import pytest

from services.coffee.menu import _words_overlap
from services.nlp import NLPService


@pytest.fixture(scope="module")
def nlp():
    return NLPService()


@pytest.mark.parametrize(
    "text, milk",
    [
        ("latte with goat milk", "goat"),
        ("latte with a2 milk", "a2"),
        ("latte no milk", "no milk"),
        ("latte with oat milk", "oat"),
        ("oat latte", "oat"),
        ("cappuccino with almond milk", "almond"),
        ("latte with soy", "soy"),
        ("latte with milk", None),
        ("latte with extra milk", None),
        ("flat white", None),
    ],
)
def test_milk_named_is_milk_kept(nlp, text, milk):
    assert nlp.parse_order(text).get("milk") == milk


@pytest.mark.parametrize(
    "text, sugar",
    [("latte with honey", "honey"), ("latte with equal", "equal"), ("latte 2 sugars", "2 sugar")],
)
def test_sweetener_named_is_kept(nlp, text, sugar):
    assert nlp.parse_order(text).get("sugar") == sugar


def test_milk_names_match_whole_words_only():
    assert _words_overlap("oat", "oat milk")
    assert _words_overlap("lactose free", "lactose free milk")
    assert not _words_overlap("oat", "goat")
    assert not _words_overlap("goat", "oat")
    assert not _words_overlap("", "oat")
