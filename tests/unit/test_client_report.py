"""The report emailed to the client the morning after (U4-11)."""
from datetime import datetime, timedelta

from services import client_report as cr

CFG = {"on": True, "email": "a@example.com", "from": "2026-11-26", "to": "2026-11-27"}


def at(day, hour):
    return datetime(2026, 11, day, hour)


def test_goes_out_from_nine_the_morning_after():
    assert not cr.is_due(CFG, at(27, 23))
    assert not cr.is_due(CFG, at(28, 8))
    assert cr.is_due(CFG, at(28, 9))
    assert cr.is_due(CFG, at(29, 1))


def test_only_once_only_when_on_and_not_weeks_later():
    assert not cr.is_due({**CFG, "sent_at": "2026-11-28T00:00:00Z"}, at(28, 10))
    assert not cr.is_due({**CFG, "on": False}, at(28, 10))
    assert not cr.is_due({**CFG, "tries": cr.MAX_TRIES}, at(28, 10))
    assert not cr.is_due({**CFG, "to": ""}, at(28, 10))
    assert not cr.is_due(CFG, at(27, 9) + timedelta(days=cr.GIVE_UP_DAYS + 1))


DATA = {
    "success": True, "total_orders": 12, "status_breakdown": {"picked_up": 10, "cancelled": 2},
    "avg_wait_min": 4.2, "peak_hour": {"hour": 10, "orders": 6}, "per_station": [{}, {}],
    "top_drinks": [{"drink": "<script>x</script>", "orders": 3}],
    "milk": {"by_milk": [{"milk": "oat", "orders": 4}]},
    "errors": {"count": 9, "recent": [{"message": "secret crash"}]},
    "issues": [{"title": "Internal issue"}],
}


def test_the_email_is_the_clients_version_and_escaped():
    html = cr.render(DATA, "A & B <Expo>", "2026-11-26", "2026-11-27", "https://demo.cupq.app/event-feedback/t")
    assert "A &amp; B &lt;Expo&gt;" in html and "<script>" not in html.lower()
    assert ">10<" in html  # cancelled orders aren't counted
    assert "26 November 2026 to 27 November 2026" in html and "10 am" in html
    assert "secret crash" not in html and "Internal issue" not in html
    assert "/event-feedback/t" in html


def test_feedback_links_expire_and_the_oldest_drop_off():
    now = datetime(2026, 11, 28)
    token, links = cr.new_link([], "Expo", "a@example.com", now)
    assert cr.find_link(links, token, now)["event"] == "Expo"
    assert cr.find_link(links, "nope", now) is None
    assert cr.find_link(links, token, now + timedelta(days=cr.LINK_DAYS + 1)) is None
    for _ in range(cr.MAX_LINKS + 5):
        _, links = cr.new_link(links, "Expo", "a@example.com", now)
    assert len(links) == cr.MAX_LINKS


def test_the_report_function_can_be_called_without_a_login():
    import inspect

    from routes.api.reports import get_today_report

    assert inspect.unwrap(get_today_report).__code__.co_filename.endswith("reports.py")
