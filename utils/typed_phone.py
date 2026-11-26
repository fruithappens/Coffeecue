"""Clean a mobile number as a customer typed it on the ordering screen.

Peri SIG Hobart, 26 Nov 2026: a delegate's phone remembered their number
from the first coffee, they typed it again on the end, and the order went
in as one 20-digit number. The orders.phone column holds 20 characters,
so the INSERT failed and the screen said only "None of the drinks could
be placed". Phone is optional, so a number we can't use must never cost
anyone their coffee.
"""

import re

# E.164 allows 15 digits after the "+"; anything shorter than 8 is not a
# mobile in any country we serve.
MIN_DIGITS = 8
MAX_DIGITS = 15


def clean_typed_phone(raw):
    """The usable form of a typed number, or '' when there isn't one.

    A number typed twice ("0400...0400...") is folded back to one copy.
    Too short or too long after that: '' (the order goes ahead without a
    text, rather than failing). The leading "+" is kept; spacing is not
    this function's job (the caller normalises to E.164).
    """
    s = str(raw or "").strip()
    if not s:
        return ""
    digits = re.sub(r"\D", "", s)
    plus = s.startswith("+")
    half = len(digits) // 2
    if len(digits) % 2 == 0 and half >= MIN_DIGITS and digits[:half] == digits[half:]:
        digits = digits[:half]
    if not (MIN_DIGITS <= len(digits) <= MAX_DIGITS):
        return ""
    return ("+" if plus else "") + digits
