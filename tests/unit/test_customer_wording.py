"""The organiser's phone wording is cleaned before it is stored or served (X7-5)."""
from routes.customer_wording_routes import MAX_LEN, clean


def test_only_known_stages_one_line_and_capped():
    out = clean(
        {
            "pending": "  In   the\nqueue  ",
            "completed": "x" * 200,
            "bogus": "nope",
            "cancelled": "",
            "picked_up": None,
        }
    )
    assert out == {"pending": "In the queue", "completed": "x" * MAX_LEN}


def test_rubbish_is_empty():
    assert clean(None) == {}
    assert clean("text") == {}
    assert clean(["pending"]) == {}
