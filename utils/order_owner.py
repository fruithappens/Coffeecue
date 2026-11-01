"""Proof that a customer owns an order.

Cancelling a queued order and saying "got it" on a ready one are public:
the customer has no login, only the phone that placed it. Order numbers are
sequential and shown on the public board, so the number alone proved
nothing -- one script could cancel every queued coffee mid-event (audit
finding SEC-008).

The key is an HMAC of the order number under the JWT secret, so nothing
new is stored: it is handed to the device that placed the order and sent
back with cancel and collected. Lettered group drinks (336a, 336b) share
their round's key (336), so one phone can act on the whole round. The JWT
secret, not SECRET_KEY, because it must survive a restart or every login
would break too; replacing it voids keys for orders already in the queue,
which then need a barista, as before.
"""

import hashlib
import hmac

from flask import current_app

KEY_LENGTH = 20


def order_key(order_number):
    secret = (current_app.config.get("JWT_SECRET_KEY") or "").encode()
    msg = f"order-owner:{order_number}".encode()
    return hmac.new(secret, msg, hashlib.sha256).hexdigest()[:KEY_LENGTH]


def key_ok(supplied, *order_numbers):
    """True if `supplied` is the key of any of these numbers (the order
    itself, or its round)."""
    if not supplied or not isinstance(supplied, str):
        return False
    return any(
        hmac.compare_digest(supplied, order_key(n))
        for n in order_numbers
        if n not in (None, "")
    )


def supplied_key(request):
    """The key the customer's device sent: header, else JSON body."""
    k = request.headers.get("X-Order-Key")
    if not k:
        body = request.get_json(silent=True) or {}
        k = body.get("key") if isinstance(body, dict) else None
    return (k or "").strip()


# ---------------------------------------------------------------------------
# Attendee pass: proof that the phone on /my belongs to the attendee.
#
# /my identifies people by the mobile they type once (no code, no text), so
# anyone who knows a number can see that person's coffee. Seeing is allowed;
# CHANGING (rename, usual, cancel) needs this pass, which the page earns by
# giving the surname EventsAir holds for them (audit finding SEC-009).
# ---------------------------------------------------------------------------

def attendee_pass(cid):
    secret = (current_app.config.get("JWT_SECRET_KEY") or "").encode()
    msg = f"attendee-pass:{cid}".encode()
    return hmac.new(secret, msg, hashlib.sha256).hexdigest()[:KEY_LENGTH]


def pass_ok(cid, supplied):
    if not cid or not supplied or not isinstance(supplied, str):
        return False
    return hmac.compare_digest(supplied, attendee_pass(cid))


def supplied_pass(request):
    return (request.headers.get("X-Attendee-Pass") or "").strip()


def same_surname(given, on_record):
    """Forgiving match: case, spaces, hyphens and apostrophes don't count
    (O'Brien, o brien and OBRIEN are one person)."""
    norm = lambda s: "".join(ch for ch in str(s or "").lower() if ch.isalnum())
    g, r = norm(given), norm(on_record)
    return bool(g) and bool(r) and hmac.compare_digest(g, r)
