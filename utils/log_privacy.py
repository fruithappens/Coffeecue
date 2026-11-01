"""Mobile numbers never reach the logs whole (audit finding SEC-011).

The logs go to Railway, whose stored data was in scope of the 21 Oct 2026
breach, and DATA_MAP.md promises numbers are masked. Dozens of log lines
across the app put a number in their text, so rather than chase each one,
every log record is masked as it is created: a mobile keeps only its last
three digits ("+61…333"), enough to match a complaint to a log line.

install() wraps the logging record factory, so it covers every logger,
handler and library, including ones set up after it runs.
"""

import logging
import re

# Australian mobiles in the forms people and providers write them
# (+61 4xx, 614xx, 04xx, with or without spaces or dashes), then any other
# international number written with a +.
_AU_MOBILE = re.compile(r"(?<![\d+])(?:\+?61[ -]?|0)4\d{2}[ -]?\d{3}[ -]?\d{3}(?!\d)")
_INTL = re.compile(r"(?<![\d+])\+\d[\d -]{6,16}\d(?!\d)")


def _mask(match):
    digits = re.sub(r"\D", "", match.group(0))
    return f"+…{digits[-3:]}"


def mask_numbers(text):
    if not text or not isinstance(text, str):
        return text
    return _INTL.sub(_mask, _AU_MOBILE.sub(_mask, text))


_installed = False


def install():
    global _installed
    if _installed:
        return
    old_factory = logging.getLogRecordFactory()

    def factory(*args, **kwargs):
        record = old_factory(*args, **kwargs)
        try:
            text = record.getMessage()
            masked = mask_numbers(text)
            if masked != text:
                record.msg, record.args = masked, None
        except Exception:
            pass  # never lose a log line over masking
        return record

    logging.setLogRecordFactory(factory)
    _installed = True
