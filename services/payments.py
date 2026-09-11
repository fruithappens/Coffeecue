"""Payments, on an honour system that can also take the money.

Most of Steve's events are free to the delegate. A coffee cart at a paid
event already runs Square, and asks how the ordering system talks to it.
The answer is in three levels, and an operator stops wherever suits:

  Level 1 -- mark it paid. A Paid tap on the barista card, a PAID / UNPAID
             pill in the price's place, an unpaid count on the report. The
             counter takes the money however it likes.
  Level 2 -- pay on the phone. The operator's own Square account
             (connected once with OAuth, never Steve's), a Square-hosted
             Payment Link per order shown on the beacon and in the ready
             text, and Square's webhook marking the order paid.
  Level 3 -- the counter's own reader (Square Terminal): the Paid tap
             pushes the amount to the reader. Built on the same webhook.

The principle that does not move: **the coffee is never held for payment**
unless the operator chose Pay-to-order. The pricing MODE says what the
customer is told:

  honour          the order goes through; pay whenever (today's behaviour)
  pay_to_collect  made regardless; UNPAID until paid; "pay at the counter to
                  collect" on the ready text and the beacon
  pay_to_order    not placed until the phone payment succeeds (needs a
                  connected Square; the counter path still allows cash)

Payment state is derived, never guessed: an order is PAID when
orders.payment_status says so; UNPAID when pricing is on, its price is
above zero and it is not paid; NONE when there is nothing to pay (pricing
off, free, VIP comp).
"""

import base64
import hashlib
import hmac
import json
import logging
import uuid
from datetime import datetime

logger = logging.getLogger("expresso.payments")

MODES = ("honour", "pay_to_collect", "pay_to_order")
METHODS = ("cash", "card", "square", "other")


def mode_of(pricing):
    """The pricing mode, always one of MODES. Pricing switched off means
    honour whatever the setting says -- nothing is owed."""
    try:
        if not (pricing or {}).get("enabled"):
            return "honour"
        m = str((pricing or {}).get("mode") or "honour").strip().lower()
        return m if m in MODES else "honour"
    except Exception:
        return "honour"


def price_of(order_details):
    """The amount an order carries, as a float, or None when it has none."""
    try:
        od = order_details if isinstance(order_details, dict) else {}
        p = od.get("price")
        if p is None or p == "":
            return None
        return float(p)
    except Exception:
        return None


def state_of(payment_status, order_details, pricing):
    """'paid' | 'unpaid' | 'none'. See the module note."""
    try:
        if str(payment_status or "").lower() == "paid":
            return "paid"
        if mode_of(pricing) == "honour" and not (pricing or {}).get("enabled"):
            return "none"
        if not (pricing or {}).get("enabled"):
            return "none"
        p = price_of(order_details)
        if p is None or p <= 0:
            return "none"
        return "unpaid"
    except Exception:
        return "none"


def _find(cur, ref):
    """The row id for an order reference. Every barista-facing route takes
    the ORDER NUMBER (the list's `id` is the number, on purpose); a bare
    database id is accepted too, for the webhook and old callers."""
    ref = str(ref or "").strip()
    if not ref:
        return None
    cur.execute("SELECT id FROM orders WHERE order_number = %s", (ref,))
    row = cur.fetchone()
    if row:
        return row[0] if not isinstance(row, dict) else row.get("id")
    if ref.isdigit():
        cur.execute("SELECT id FROM orders WHERE id = %s", (int(ref),))
        row = cur.fetchone()
        if row:
            return row[0] if not isinstance(row, dict) else row.get("id")
    return None


def mark_paid(db, order_ref, method="cash", by=None, reference=None):
    """Record a payment against an order (by number, or by id). Idempotent:
    paying a paid order keeps the first record. Returns the stored details,
    or None if the order does not exist."""
    method = str(method or "cash").strip().lower()
    if method not in METHODS:
        method = "other"
    cur = db.cursor()
    order_id = _find(cur, order_ref)
    if order_id is None:
        return None
    cur.execute("SELECT order_details, payment_status FROM orders WHERE id = %s", (order_id,))
    row = cur.fetchone()
    if not row:
        return None
    od_raw, current = (row[0], row[1]) if not isinstance(row, dict) else (row.get("order_details"), row.get("payment_status"))
    od = od_raw if isinstance(od_raw, dict) else (json.loads(od_raw) if od_raw else {})
    if str(current or "").lower() == "paid":
        return od
    od["paid_at"] = datetime.utcnow().isoformat() + "Z"
    od["paid_method"] = method
    if by:
        od["paid_by"] = str(by)[:60]
    if reference:
        od["payment_reference"] = str(reference)[:120]
    cur.execute(
        "UPDATE orders SET payment_status = 'paid', order_details = %s, updated_at = %s WHERE id = %s",
        (json.dumps(od), datetime.now(), order_id))
    db.commit()
    logger.info(f"order {order_id} marked paid ({method}) by {by or 'system'}")
    return od


def mark_unpaid(db, order_ref, by=None):
    """Undo a Paid tap made by mistake. Keeps a note of who undid it."""
    cur = db.cursor()
    order_id = _find(cur, order_ref)
    if order_id is None:
        return None
    cur.execute("SELECT order_details FROM orders WHERE id = %s", (order_id,))
    row = cur.fetchone()
    if not row:
        return None
    od_raw = row[0] if not isinstance(row, dict) else row.get("order_details")
    od = od_raw if isinstance(od_raw, dict) else (json.loads(od_raw) if od_raw else {})
    for k in ("paid_at", "paid_method", "paid_by", "payment_reference"):
        od.pop(k, None)
    if by:
        od["unpaid_by"] = str(by)[:60]
    cur.execute(
        "UPDATE orders SET payment_status = 'pending', order_details = %s, updated_at = %s WHERE id = %s",
        (json.dumps(od), datetime.now(), order_id))
    db.commit()
    logger.info(f"order {order_id} marked unpaid by {by or 'system'}")
    return od


def summary(cur, d0, d1, pricing):
    """For the report: what was owed, what was paid, and how.

    {'enabled', 'mode', 'orders_priced', 'paid': {'count','total'},
     'unpaid': {'count','total'}, 'by_method': {method: {'count','total'}}}
    Cancelled orders are not owed. Amounts come from each order's own
    stored price, so a mid-event price change does not rewrite history.
    """
    out = {"enabled": bool((pricing or {}).get("enabled")), "mode": mode_of(pricing),
           "orders_priced": 0, "paid": {"count": 0, "total": 0.0},
           "unpaid": {"count": 0, "total": 0.0}, "by_method": {}}
    if not out["enabled"]:
        return out
    try:
        cur.execute(
            "SELECT payment_status, order_details FROM orders "
            "WHERE created_at >= %s AND created_at < %s AND status <> 'cancelled'",
            (d0, d1))
        for row in cur.fetchall():
            ps, od_raw = (row[0], row[1]) if not isinstance(row, dict) else (row.get("payment_status"), row.get("order_details"))
            od = od_raw if isinstance(od_raw, dict) else (json.loads(od_raw) if od_raw else {})
            st = state_of(ps, od, pricing)
            if st == "none":
                continue
            p = price_of(od) or 0.0
            out["orders_priced"] += 1
            if st == "paid":
                out["paid"]["count"] += 1
                out["paid"]["total"] = round(out["paid"]["total"] + p, 2)
                m = str(od.get("paid_method") or "other")
                bm = out["by_method"].setdefault(m, {"count": 0, "total": 0.0})
                bm["count"] += 1
                bm["total"] = round(bm["total"] + p, 2)
            else:
                out["unpaid"]["count"] += 1
                out["unpaid"]["total"] = round(out["unpaid"]["total"] + p, 2)
    except Exception as e:
        logger.warning(f"payments summary failed: {e}")
    return out


# ---------------------------------------------------------------------------
# Level 2: Square
# ---------------------------------------------------------------------------
#
# Everything Square-shaped goes through SquareClient so the rest of the app
# never sees a URL or a token, and so a test can hand it a fake `post`.
# The operator's tokens live in the settings KV under `square_connection`
# (written only by the OAuth callback and the disconnect route).

SQUARE_KEY = "square_connection"
OAUTH_SCOPES = "PAYMENTS_WRITE PAYMENTS_READ ORDERS_WRITE ORDERS_READ MERCHANT_PROFILE_READ"


def square_base(env):
    return "https://connect.squareupsandbox.com" if str(env or "").lower().startswith("sand") \
        else "https://connect.squareup.com"


def read_connection(raw):
    """The stored Square connection, or {} -- never raises."""
    try:
        if isinstance(raw, (bytes, str)):
            raw = json.loads(raw) if str(raw).strip() else {}
        return raw if isinstance(raw, dict) else {}
    except Exception:
        return {}


def is_connected(conn):
    return bool((conn or {}).get("access_token") and (conn or {}).get("location_id"))


def verify_webhook_signature(signature_key, notification_url, body_bytes, signature_header):
    """Square signs `notification_url + body` with HMAC-SHA256 and sends it
    base64 in x-square-hmacsha256-signature. Constant-time compare; any
    missing piece is a failure, never a pass."""
    try:
        if not (signature_key and notification_url and signature_header):
            return False
        mac = hmac.new(signature_key.encode("utf-8"),
                       notification_url.encode("utf-8") + (body_bytes or b""),
                       hashlib.sha256).digest()
        expected = base64.b64encode(mac).decode("ascii")
        return hmac.compare_digest(expected, str(signature_header).strip())
    except Exception:
        return False


def payment_link_request(order_number, amount, currency, location_id, name, redirect_url=None):
    """The body of POST /v2/online-checkout/payment-links for one order.
    Quick Pay: one line, one price, no catalog needed. Amount in the
    smallest unit (cents). The order number rides as reference_id so the
    webhook can find the order without a lookup table."""
    cents = int(round(float(amount) * 100))
    body = {
        "idempotency_key": str(uuid.uuid5(uuid.NAMESPACE_URL, f"cupq-order-{order_number}")),
        "quick_pay": {
            "name": str(name or f"Order #{order_number}")[:255],
            "price_money": {"amount": cents, "currency": str(currency or "AUD").upper()},
            "location_id": location_id,
        },
        "payment_note": f"CupQ order #{order_number}",
        "checkout_options": {"allow_tipping": False},
    }
    if redirect_url:
        body["checkout_options"]["redirect_url"] = redirect_url
    body["pre_populated_data"] = {}
    body["order_reference_id"] = str(order_number)
    return body


class SquareClient:
    """Thin, replaceable. `post`/`get` default to `requests`; tests pass
    fakes. Every call has a short timeout because these run inside an
    order being placed -- a slow Square must never hold up a coffee."""

    def __init__(self, env="sandbox", access_token="", timeout=4.0, post=None, get=None):
        self.base = square_base(env)
        self.token = access_token or ""
        self.timeout = timeout
        self._post = post
        self._get = get

    def _headers(self):
        return {"Authorization": f"Bearer {self.token}", "Content-Type": "application/json",
                "Square-Version": "2025-01-23"}

    def post(self, path, body):
        if self._post:
            return self._post(path, body)
        import requests
        r = requests.post(self.base + path, json=body, headers=self._headers(), timeout=self.timeout)
        try:
            data = r.json()
        except Exception:
            data = {"errors": [{"detail": r.text[:200]}]}
        return r.status_code, data

    def get(self, path):
        if self._get:
            return self._get(path)
        import requests
        r = requests.get(self.base + path, headers=self._headers(), timeout=self.timeout)
        try:
            data = r.json()
        except Exception:
            data = {"errors": [{"detail": r.text[:200]}]}
        return r.status_code, data

    def create_payment_link(self, order_number, amount, currency, location_id, name, redirect_url=None):
        """-> (url, payment_link_id) or (None, None). Never raises."""
        try:
            body = payment_link_request(order_number, amount, currency, location_id, name, redirect_url)
            status, data = self.post("/v2/online-checkout/payment-links", body)
            link = (data or {}).get("payment_link") or {}
            if status in (200, 201) and link.get("url"):
                return link["url"], link.get("id")
            logger.warning(f"square payment link failed ({status}): {str(data)[:200]}")
        except Exception as e:
            logger.warning(f"square payment link error: {e}")
        return None, None

    def locations(self):
        try:
            status, data = self.get("/v2/locations")
            if status == 200:
                return [{"id": l.get("id"), "name": l.get("name"),
                         "currency": (l.get("currency") or "AUD")}
                        for l in (data.get("locations") or []) if l.get("status", "ACTIVE") == "ACTIVE"]
        except Exception as e:
            logger.warning(f"square locations error: {e}")
        return []

    def terminal_checkout(self, device_id, order_number, amount, currency):
        """Level 3: push the amount to a paired Square Terminal.
        -> checkout id or None."""
        try:
            body = {
                "idempotency_key": str(uuid.uuid5(uuid.NAMESPACE_URL, f"cupq-terminal-{order_number}-{datetime.utcnow():%Y%m%d%H%M}")),
                "checkout": {
                    "amount_money": {"amount": int(round(float(amount) * 100)), "currency": str(currency or "AUD").upper()},
                    "reference_id": str(order_number),
                    "note": f"CupQ order #{order_number}",
                    "device_options": {"device_id": device_id, "skip_receipt_screen": True},
                },
            }
            status, data = self.post("/v2/terminals/checkouts", body)
            if status in (200, 201):
                return ((data or {}).get("checkout") or {}).get("id")
            logger.warning(f"square terminal checkout failed ({status}): {str(data)[:200]}")
        except Exception as e:
            logger.warning(f"square terminal checkout error: {e}")
        return None


def order_number_from_webhook(event):
    """The order number a Square webhook event is about, or ''.
    payment.* events carry reference_id on the payment (for Terminal) or
    order_id -> we set order_reference_id on the link; both are tried."""
    try:
        obj = ((event or {}).get("data") or {}).get("object") or {}
        pay = obj.get("payment") or obj.get("checkout") or {}
        ref = pay.get("reference_id") or (obj.get("order") or {}).get("reference_id") or ""
        return str(ref or "").strip()
    except Exception:
        return ""


def webhook_is_completed(event):
    try:
        t = str((event or {}).get("type") or "")
        obj = ((event or {}).get("data") or {}).get("object") or {}
        pay = obj.get("payment") or obj.get("checkout") or {}
        st = str(pay.get("status") or "").upper()
        return t.startswith("payment.") and st == "COMPLETED"
    except Exception:
        return False
