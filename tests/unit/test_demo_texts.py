"""Demo numbers: texts to 0400 009 9xx are shown in the Demo Room, never sent."""

import os
import sys
from unittest.mock import patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from services import demo_texts  # noqa: E402
from services.messaging import BENCH_PHONE_PREFIX, MessagingService  # noqa: E402


def setup_function():
    demo_texts.clear()


def test_demo_range_is_inside_the_bench_range():
    # The second wall: if the demo check ever failed, the bench wall
    # behind it still refuses every demo number.
    assert demo_texts.DEMO_PHONE_PREFIX.startswith(BENCH_PHONE_PREFIX)


def test_is_demo():
    assert demo_texts.is_demo("+61400009901")
    assert demo_texts.is_demo("+61400009999")
    assert not demo_texts.is_demo("+61400009")       # too short
    assert not demo_texts.is_demo("+614000099011")   # too long
    assert not demo_texts.is_demo("+61412693279")    # a real mobile
    assert not demo_texts.is_demo("")
    assert not demo_texts.is_demo(None)


def test_filed_and_listed_newest_last():
    a = demo_texts.add("+61400009901", "one", "confirmation")
    b = demo_texts.add("+61400009902", "two", "ready")
    c = demo_texts.add("+61400009901", "three", "ready")
    assert [t["body"] for t in demo_texts.list_texts()] == ["one", "two", "three"]
    assert [t["id"] for t in demo_texts.list_texts(phone="+61400009901")] == [a, c]
    assert [t["id"] for t in demo_texts.list_texts(after=a)] == [b, c]
    demo_texts.clear()
    assert demo_texts.list_texts() == []


def test_send_to_a_demo_number_is_filed_not_delivered_or_metered():
    svc = MessagingService(testing_mode=True)
    with patch.object(svc, "_deliver") as deliver, \
         patch("services.sms_meter.decide") as decide, \
         patch("services.sms_meter.record") as record:
        # Typed the way a person says it; normalised before the check.
        result = svc.send_message("0400 009 901", "Your flat white is ready", "ready")
    assert result == "demo_preview"
    deliver.assert_not_called()
    decide.assert_not_called()
    record.assert_not_called()
    [t] = demo_texts.list_texts()
    assert t["to"] == "+61400009901"
    assert t["body"] == "Your flat white is ready"
    assert t["kind"] == "ready"


def test_a_real_number_is_not_filed():
    svc = MessagingService(testing_mode=True)
    with patch.object(svc, "_deliver", return_value="testing_mode_message_sid"), \
         patch("services.sms_meter.decide", return_value=(True, "")), \
         patch("services.sms_meter.record"):
        svc.send_message("+61412693279", "hello", "reply")
    assert demo_texts.list_texts() == []
