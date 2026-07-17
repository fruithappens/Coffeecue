"""
Coffee Cue Test Bench — CROSS-ACTOR JOURNEYS.

Steve's insight (2026-07-16): a working button is a testable promise. "Message
Customer" exists, therefore a customer can reply, therefore that reply must go
somewhere sensible. The matrix tests functions in isolation; JOURNEYS follow an
action all the way to what it triggers next — which is where the barista-reply
bug (a customer's "No sugar" fell into the order bot) was hiding.

The rule these encode: for every action the app offers, chase the response it
invites and assert it lands in the right place.

Safety: the barista "Message Customer" step uses dry_run=true so NO real SMS is
sent (production has TESTING_MODE off). Customer replies go through the
/api/sms/simulate harness (Twilio never in the loop). Orders are ZZBench* and
cancelled in cleanup; fake phones are virgin per run.
"""
from __future__ import annotations

from .core import BENCH_TAG, result
from .suites import _menu, _order_list, _sim, _stations

R = result


def _place_sms_order(rn, tag, drink, milk):
    """Place a one-shot SMS order on a fresh fake number; return (phone, order_no)."""
    c = rn.client
    phone = rn.next_phone()
    ok, reply = _sim(c, phone, f"{tag} large {drink} with {milk}")
    low, turns = (reply or "").lower(), 0
    while ok and turns < 3 and ("what size" in low or "what milk" in low):
        ok, reply = _sim(c, phone, "large" if "size" in low else milk)
        low = (reply or "").lower()
        turns += 1
    if not ("confirmed" in low or "order #" in low or "you're #" in low):
        return phone, None, reply
    # find the order number in the pending queue
    code, body, _ = c.get("/api/orders/pending")
    for o in _order_list(body):
        nm = str(o.get("customer_name") or o.get("customerName") or "")
        if nm.lower().startswith(tag.lower()):
            return phone, (o.get("order_number") or o.get("orderNumber") or o.get("id")), reply
    return phone, None, reply


def _questions(client):
    code, body, _ = client.get("/api/customer-questions?status=all")
    if code != 200 or not isinstance(body, dict):
        return []
    return body.get("data") or body.get("items") or []


# ---------------------------------------------------------------- journey 1

def journey_message_reply(rn):
    """Barista messages a customer → customer replies → reply must reach the
    barista Messages inbox (NOT be parsed as a new order). This is the exact
    live bug from 2026-07-16."""
    c, out = rn.client, []
    drinks, milks, _ = _menu(c)
    drink = "cappuccino" if "cappuccino" in drinks else (drinks[0] if drinks else "latte")
    milk = next((m for m in ("full cream", "skim") if m in milks), milks[0] if milks else "full cream")

    phone, order_no, reply = _place_sms_order(rn, f"{BENCH_TAG}Jrny", drink, milk)
    if not order_no:
        return [R("journeys", "message-reply: setup order", "fail",
                  f"Could not place the setup SMS order: {reply[:140]}",
                  refs=["services/coffee_system.py"])]

    # Barista taps "Message Customer" (dry_run — no real SMS).
    code, mbody, _ = c.post(f"/api/orders/{order_no}/message",
                            {"message": "did you want sugar?", "dry_run": True})
    if code != 200 or not (isinstance(mbody, dict) and mbody.get("success")):
        _sim(c, phone, "CANCEL")
        return [R("journeys", "message-reply: barista message sends", "fail",
                  f"POST /orders/{order_no}/message → HTTP {code}: {str(mbody)[:200]}",
                  refs=["routes/consolidated_api_routes.py"])]
    out.append(R("journeys", "message-reply: barista message sends", "pass",
                 f"Messaged order {order_no} (dry_run, no real SMS)"))

    # Customer replies.
    ok, rtext = _sim(c, phone, "No sugar")
    low = (rtext or "").lower()

    # ASSERT A: the reply must NOT be parsed as a new order (the bug signature).
    bug = "first name" in low or "welcome to" in low
    out.append(R("journeys", "message-reply: reply is NOT treated as a new order",
                 "fail" if bug else "pass",
                 rtext[:160],
                 evidence=rtext[:400] if bug else "",
                 suggestion="" if not bug else "The customer's reply fell into the order "
                            "bot again ('first name' / 'welcome') — the reply-routing link "
                            "is broken.",
                 refs=[] if not bug else ["services/coffee_system.py"]))

    # ASSERT B: the reply must land in the barista Messages inbox, tagged.
    qs = _questions(c)
    landed = [q for q in qs
              if str(q.get("phone") or "").endswith(phone[-8:])
              and "no sugar" in str(q.get("question") or "").lower()]
    tagged = any(f"#{order_no}" in str(q.get("question") or "") for q in landed)
    out.append(R("journeys", "message-reply: reply reaches the barista inbox",
                 "pass" if landed else "fail",
                 f"reply {'found' if landed else 'NOT found'} in Messages inbox"
                 + (f", tagged with order #{order_no}" if tagged else
                    (" (but not tagged to the order)" if landed else "")),
                 evidence="" if landed else f"customer confirm was: {rtext[:200]}",
                 suggestion="" if landed else "The customer replied but nothing reached the "
                            "barista — the message→reply loop is not closed.",
                 refs=[] if landed else ["services/coffee_system.py",
                                         "routes/consolidated_api_routes.py"]))

    _sim(c, phone, "CANCEL")
    # sweep
    code, body, _ = c.get("/api/orders/pending")
    for o in _order_list(body):
        nm = str(o.get("customer_name") or o.get("customerName") or "")
        if nm.lower().startswith(f"{BENCH_TAG}Jrny".lower()):
            no = o.get("order_number") or o.get("orderNumber") or o.get("id")
            if no is not None:
                c.post(f"/api/orders/{no}/cancel")
    return out


# ---------------------------------------------------------------- journey 2

def journey_forget_me(rn):
    """A returning customer's FORGET ME must (a) ask to confirm, (b) on YES
    erase them, (c) leave them a STRANGER — a fresh order afterwards must ask
    their name again, not greet them. Tests the privacy promise end to end."""
    c, out = rn.client, []
    drinks, milks, _ = _menu(c)
    drink = "latte" if "latte" in drinks else (drinks[0] if drinks else "latte")
    milk = next((m for m in ("full cream", "skim") if m in milks), milks[0] if milks else "full cream")

    # Become a known customer: place an order (saves name/prefs), then cancel it.
    phone, order_no, _ = _place_sms_order(rn, f"{BENCH_TAG}Forget", drink, milk)
    if order_no:
        c.post(f"/api/orders/{order_no}/cancel")

    # FORGET ME → must ask to confirm (not delete instantly).
    ok, r1 = _sim(c, phone, "FORGET ME")
    low1 = (r1 or "").lower()
    confirms = "yes" in low1 and ("delete" in low1 or "confirm" in low1 or "erase" in low1)
    out.append(R("journeys", "forget-me: asks to confirm before deleting",
                 "pass" if confirms else "warn", r1[:160],
                 suggestion="" if confirms else "FORGET ME should confirm before erasing data.",
                 refs=[] if confirms else ["services/coffee_system.py"]))

    ok, r2 = _sim(c, phone, "YES")
    low2 = (r2 or "").lower()
    deleted = "deleted" in low2 or "erased" in low2 or "removed" in low2
    out.append(R("journeys", "forget-me: confirms the data was deleted",
                 "pass" if deleted else "fail", r2[:160],
                 evidence="" if deleted else r2[:300],
                 suggestion="" if deleted else "After YES, the bot should confirm deletion.",
                 refs=[] if deleted else ["services/coffee_system.py"]))

    # Now a STRANGER: a fresh order must ask for the name again.
    ok, r3 = _sim(c, phone, f"{drink}")
    low3 = (r3 or "").lower()
    forgotten = "name" in low3
    out.append(R("journeys", "forget-me: customer is truly forgotten (asked name again)",
                 "pass" if forgotten else "fail", r3[:160],
                 evidence="" if forgotten else r3[:300],
                 suggestion="" if forgotten else "The customer's name survived FORGET ME — the "
                            "erase is incomplete (a privacy-promise failure).",
                 refs=[] if forgotten else ["services/coffee_system.py"]))
    # cleanup any order the stranger flow created
    ok, _ = _sim(c, phone, "CANCEL")
    code, body, _ = c.get("/api/orders/pending")
    for o in _order_list(body):
        nm = str(o.get("customer_name") or o.get("customerName") or "")
        if nm.lower().startswith(f"{BENCH_TAG}Forget".lower()):
            no = o.get("order_number") or o.get("orderNumber") or o.get("id")
            if no is not None:
                c.post(f"/api/orders/{no}/cancel")
    return out


# ---------------------------------------------------------------- journey 3

def journey_cancel_after_confirm(rn):
    """Customer places an order, then texts CANCEL — the order must actually
    leave the pending queue (a barista shouldn't make a cancelled coffee)."""
    c, out = rn.client, []
    drinks, milks, _ = _menu(c)
    drink = "latte" if "latte" in drinks else (drinks[0] if drinks else "latte")
    milk = next((m for m in ("full cream", "skim") if m in milks), milks[0] if milks else "full cream")

    phone, order_no, reply = _place_sms_order(rn, f"{BENCH_TAG}Cxl", drink, milk)
    if not order_no:
        return [R("journeys", "cancel-after-confirm: setup order", "fail",
                  f"setup order failed: {reply[:140]}")]
    # present in queue?
    code, body, _ = c.get("/api/orders/pending")
    present = any(str(o.get("order_number") or o.get("orderNumber") or o.get("id")) == str(order_no)
                 for o in _order_list(body))
    ok, ctext = _sim(c, phone, "CANCEL")
    cancelled_msg = "cancel" in (ctext or "").lower()
    # gone from queue?
    code, body, _ = c.get("/api/orders/pending")
    gone = not any(str(o.get("order_number") or o.get("orderNumber") or o.get("id")) == str(order_no)
                   for o in _order_list(body))
    good = present and cancelled_msg and gone
    out.append(R("journeys", "cancel-after-confirm: CANCEL removes the order from the queue",
                 "pass" if good else "fail",
                 f"order {order_no}: in-queue={present} → CANCEL said '{ctext[:60]}' → gone={gone}",
                 suggestion="" if good else "A texted CANCEL must remove the order from the "
                            "barista queue, or a cancelled coffee gets made.",
                 refs=[] if good else ["services/coffee_system.py",
                                       "routes/consolidated_api_routes.py"]))
    if not gone and order_no:
        c.post(f"/api/orders/{order_no}/cancel")
    return out


def suite_journeys(rn):
    out = []
    out += journey_message_reply(rn)
    out += journey_forget_me(rn)
    out += journey_cancel_after_confirm(rn)
    return out


JOURNEY_SUITES = [("journeys", suite_journeys, True)]
