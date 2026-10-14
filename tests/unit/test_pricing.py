"""The ledger's sums (L6-3). Treenet re-quoted under the 22 Sep prices was
software $980 + labour $880 + texts $150 (+ hardware $1,640) = $3,650 ex GST."""
from utils import pricing


def amount(r, what):
    return sum(l["amount"] for l in r["lines"] if l["what"].startswith(what))


def test_treenet_requote():
    r = pricing.build(
        "standard",
        2,
        operator_hours=8,
        texts_charge_override=150,
        other=[("Hardware hire (as quoted)", 1640)],
    )
    assert amount(r, "Software") == 980
    assert amount(r, "On-site operator") == 880
    assert amount(r, "Texts") == 150
    assert r["subtotal"] == 3650
    assert r["gst"] == 365 and r["total"] == 4015


def test_operator_minimum_and_hardware_per_day():
    r = pricing.build(
        "lite", 3, operator_hours=2, hardware={"station_kit": 2, "label_printer": 1}
    )
    assert amount(r, "On-site operator") == 4 * 110
    assert amount(r, "Station kit") == 60 * 2 * 3
    assert amount(r, "Label printer") == 90 * 1 * 3
    assert amount(r, "Software") == 290 + 2 * 150


def test_addons_free_on_pro_and_texts_over_allowance():
    r = pricing.build(
        "pro", 1, addons=["eventsair", "square"], texts_used=6100, texts_included=6000
    )
    assert amount(r, "EventsAir") == 0 and amount(r, "Card payments") == 0
    assert amount(r, "Texts beyond") == 15.0
    r = pricing.build("standard", 1, addons=["eventsair"])
    assert amount(r, "EventsAir") == 350


def test_no_plan_and_urn_are_flagged_not_guessed():
    assert pricing.build(None, 1)["subtotal"] == 0
    assert "Quoted" in pricing.build("urn", 2)["lines"][0]["note"]
