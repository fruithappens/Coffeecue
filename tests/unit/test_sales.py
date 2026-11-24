"""The sales list (L6-9): what can be saved on a lead."""
from routes import sales_routes as s


def test_only_known_fields_are_taken():
    f, why = s.clean({"stage": "quoted", "value": "$1,250.50", "next_step": " Call ", "id": 9, "source": "x"})
    assert why is None
    assert f == {"stage": "quoted", "value": 1250.5, "next_step": "Call"}


def test_bad_values_are_named():
    assert s.clean({"stage": "won"})[1]
    assert s.clean({"value": "lots"})[1]
    assert s.clean({"value": "-5"})[1]
    assert s.clean({"next_date": "soon"})[1]


def test_blank_clears():
    f, why = s.clean({"value": "", "next_date": "", "notes": None})
    assert why is None and f == {"value": None, "next_date": None, "notes": ""}


def test_long_text_is_cut():
    assert len(s.clean({"next_step": "x" * 999})[0]["next_step"]) == 300
