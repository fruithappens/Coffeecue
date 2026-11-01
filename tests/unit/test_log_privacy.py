"""Mobile numbers never reach the logs whole (audit SEC-011)."""
import logging

from utils.log_privacy import install, mask_numbers


def test_au_mobiles_in_every_spelling_keep_last_three():
    for n in ("+61412693279", "61412693279", "0412693279", "0412 693 279", "+61 412-693-279"):
        assert mask_numbers(f"from {n}: hi") == "from +…279: hi", n


def test_other_international_numbers():
    assert mask_numbers("to +447911123456") == "to +…456"


def test_order_numbers_times_and_ids_untouched():
    for text in ("order 5838b", "took 1793525278 ms", "station 26600002", "#347", "2026-11-01 18:12"):
        assert mask_numbers(text) == text


def test_every_logger_is_masked(caplog):
    install()
    with caplog.at_level(logging.INFO):
        logging.getLogger("some.module").info("SMS from %s", "+61412693279")
        logging.getLogger("other").warning(f"form {{'From': '0412693279'}}")
    text = caplog.text
    assert "412693279" not in text and "0412" not in text
    assert "+…279" in text
