"""Retiring an event: what 'erase attendee details' removes and what it keeps."""

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

import routes.event_data_routes as r  # noqa: E402

SQL = " ".join(sql for _, sql in r._ERASE_STEPS)


def test_every_place_attendees_live_is_covered():
    for table in ("ea_attendees", "conversation_states", "sms_messages", "order_messages",
                  "customer_preferences", "customer_questions", "partial_orders",
                  "sms_outbound_log", "loyalty_transactions", "feedback", "orders"):
        assert table in SQL, table
    assert "sms_blocklist" in SQL


def test_order_keys_that_name_a_person():
    for k in ("name", "phone", "lookup_phone", "notes", "ea_contact_id", "email"):
        assert k in r._PERSONAL_ORDER_KEYS
    # What the report counts stays.
    for k in ("type", "milk", "size", "station_id", "channel", "vip"):
        assert k not in r._PERSONAL_ORDER_KEYS


def test_orders_and_ratings_are_kept_not_deleted():
    assert "DELETE FROM orders" not in SQL
    assert "DELETE FROM feedback" not in SQL
    assert "DELETE FROM sms_outbound_log" not in SQL  # the text counts
    # phone is NOT NULL on these: blanked, never set NULL.
    assert "phone = ''" in SQL and "phone = NULL" not in SQL
