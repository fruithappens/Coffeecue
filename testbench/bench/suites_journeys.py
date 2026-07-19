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


# ---------------------------------------------------------------- journey 4

def journey_cancel_while_making(rn):
    """Customer texts CANCEL while the barista is mid-make. The app must do
    ONE of two sensible things: actually cancel it (and remove it from the
    barista's in-progress board) or clearly tell the customer it's too late.
    The failure mode: 'cancelled' to the customer while the barista keeps
    making it. Uses test_no_send on /start so no real SMS fires."""
    if not rn.options.get("allow_lifecycle"):
        return [R("journeys", "cancel-while-making", "skip",
                  "Opt-in (starts a real order mid-test) — enable 'lifecycle'")]
    c, out = rn.client, []
    drinks, milks, _ = _menu(c)
    drink = "latte" if "latte" in drinks else (drinks[0] if drinks else "latte")
    milk = next((m for m in ("full cream", "skim") if m in milks),
                milks[0] if milks else "full cream")

    phone, order_no, reply = _place_sms_order(rn, f"{BENCH_TAG}Mid", drink, milk)
    if not order_no:
        return [R("journeys", "cancel-while-making: setup order", "fail",
                  f"setup order failed: {(reply or '')[:140]}")]

    sc, sb, _ = c.post(f"/api/orders/{order_no}/start", {"test_no_send": True})
    if sc != 200 or not (isinstance(sb, dict) and sb.get("success")):
        _sim(c, phone, "CANCEL")
        return [R("journeys", "cancel-while-making: barista starts the order",
                  "warn", f"/start → HTTP {sc} (test_no_send flag not deployed yet?): "
                  f"{str(sb)[:150]}")]
    out.append(R("journeys", "cancel-while-making: barista starts the order",
                 "pass", f"order {order_no} → in-progress (test_no_send, no SMS)"))

    def _in_progress_has(no):
        code, body, _ = c.get("/api/display/orders")
        wrap = (body or {}).get("orders") if isinstance(body, dict) else {}
        rows = (wrap or {}).get("inProgress") or [] if isinstance(wrap, dict) else []
        return any(str(o.get("order_number") or o.get("orderNumber")
                       or o.get("id")) == str(no)
                   for o in rows if isinstance(o, dict))

    making = _in_progress_has(order_no)
    ok, ctext = _sim(c, phone, "CANCEL")
    low = (ctext or "").lower()
    told_too_late = ("being made" in low or "too late" in low) \
        and str(order_no) in (ctext or "")
    misleading_denial = "don't have any pending" in low or "no pending" in low
    said_cancelled = "cancelled" in low and not told_too_late
    still_making = _in_progress_has(order_no)

    if said_cancelled and still_making:
        status = "fail"
        detail = (f"Bot told the customer '{(ctext or '')[:80]}' but order "
                  f"{order_no} is STILL on the barista's in-progress board — "
                  "the coffee gets made for nobody.")
    elif said_cancelled and not still_making:
        status = "pass"
        detail = f"cancelled cleanly mid-make; gone from in-progress. Reply: {(ctext or '')[:90]}"
    elif told_too_late:
        status = "pass"
        detail = f"customer told honestly it's mid-make: {(ctext or '')[:120]}"
    elif misleading_denial:
        status = "warn"
        detail = (f"customer with an in-progress coffee was told they have "
                  f"no orders — reads as 'we lost your order': {(ctext or '')[:110]}")
    else:
        status = "warn"
        detail = (f"unclear reply to a mid-make CANCEL: {(ctext or '')[:140]} "
                  f"(was-making={making}, still-making={still_making})")
    out.append(R("journeys", "cancel-while-making: customer CANCEL is consistent",
                 status, detail,
                 evidence=(ctext or "")[:300] if status != "pass" else "",
                 suggestion="" if status == "pass" else
                 "Pick one truth: either cancel + pull it off the barista board, "
                 "or tell the customer it's too late. Never both.",
                 refs=[] if status == "pass" else ["services/coffee_system.py"]))

    # cleanup: make sure it's gone whatever happened
    c.post(f"/api/orders/{order_no}/cancel")
    return out


# ---------------------------------------------------------------- journey 5

def journey_ready_reply(rn):
    """After the 'your coffee is ready' SMS, customers reply things like
    'coming!'. That reply must not crash the bot, must not silently CREATE a
    new order, and ideally shouldn't re-run the new-customer interview. Uses
    test_no_send on /start + /complete so no real SMS fires."""
    if not rn.options.get("allow_lifecycle"):
        return [R("journeys", "ready-reply", "skip",
                  "Opt-in (completes a real order; stays in today's stats) — "
                  "enable 'lifecycle'")]
    c, out = rn.client, []
    drinks, milks, _ = _menu(c)
    drink = "latte" if "latte" in drinks else (drinks[0] if drinks else "latte")
    milk = next((m for m in ("full cream", "skim") if m in milks),
                milks[0] if milks else "full cream")

    phone, order_no, reply = _place_sms_order(rn, f"{BENCH_TAG}Rdy", drink, milk)
    if not order_no:
        return [R("journeys", "ready-reply: setup order", "fail",
                  f"setup order failed: {(reply or '')[:140]}")]
    sc, _sb, _ = c.post(f"/api/orders/{order_no}/start", {"test_no_send": True})
    cc, cb, _ = c.post(f"/api/orders/{order_no}/complete", {"test_no_send": True})
    if cc != 200 or not (isinstance(cb, dict) and cb.get("success")):
        c.post(f"/api/orders/{order_no}/cancel")
        return [R("journeys", "ready-reply: order completes", "warn",
                  f"/complete → HTTP {cc} (test_no_send not deployed yet?): {str(cb)[:150]}")]
    out.append(R("journeys", "ready-reply: order start→complete (no SMS)", "pass",
                 f"order {order_no} completed with test_no_send"))

    before, _ = _pending_count(c)
    ok, rtext = _sim(c, phone, "coming now, thanks!")
    low = (rtext or "").lower()
    absorbed = ok and not (rtext or "").strip()  # empty = no reply, no cost
    crashy = (not ok) or "traceback" in low or "internal server error" in low
    after, _ = _pending_count(c)
    ordered = after > before
    interview = "first name" in low
    if crashy or ordered:
        status = "fail"
        why = "reply CREATED a pending order" if ordered else "reply crashed"
    elif absorbed:
        status = "pass"
        why = "absorbed silently (no reply SMS, no cost)"
    elif interview:
        status = "warn"
        why = "reply restarted the new-customer interview (noise after pickup)"
    else:
        status = "pass"
        why = "handled gracefully"
    out.append(R("journeys", "ready-reply: 'coming now' after pickup SMS is harmless",
                 status, f"{why} — reply: {(rtext or '')[:120]}",
                 evidence=(rtext or "")[:300] if status != "pass" else "",
                 suggestion="" if status == "pass" else
                 "A courtesy reply after the ready SMS should be absorbed "
                 "politely, not treated as a new order.",
                 refs=[] if status == "pass" else ["services/coffee_system.py"]))
    if ordered:
        _sim(c, phone, "CANCEL")
    # Collect the completed order so it doesn't linger on the public ready
    # board (completed-but-never-picked-up is visible to real customers).
    c.post(f"/api/orders/{order_no}/pickup")
    return out


def _pending_count(c):
    code, body, _ = c.get("/api/orders/pending")
    rows = _order_list(body)
    return len(rows), rows


# ---------------------------------------------------------------- journey 6

def journey_cancel_after_ready(rn):
    """Customer texts CANCEL when their coffee is READY on the shelf. The
    honest answer is 'it's made and waiting at Station X', never 'you don't
    have any orders' (the mid-make honesty fix, one state later)."""
    if not rn.options.get("allow_lifecycle"):
        return [R("journeys", "cancel-after-ready", "skip",
                  "Opt-in (completes a real order) — enable 'lifecycle'")]
    c, out = rn.client, []
    drinks, milks, _ = _menu(c)
    drink = "latte" if "latte" in drinks else (drinks[0] if drinks else "latte")
    milk = next((m for m in ("full cream", "skim") if m in milks),
                milks[0] if milks else "full cream")

    phone, order_no, reply = _place_sms_order(rn, f"{BENCH_TAG}Rdc", drink, milk)
    if not order_no:
        return [R("journeys", "cancel-after-ready: setup order", "fail",
                  f"setup order failed: {(reply or '')[:140]}")]
    c.post(f"/api/orders/{order_no}/start", {"test_no_send": True})
    cc, _cb, _ = c.post(f"/api/orders/{order_no}/complete", {"test_no_send": True})
    if cc != 200:
        c.post(f"/api/orders/{order_no}/cancel")
        return [R("journeys", "cancel-after-ready", "warn",
                  f"couldn't complete the setup order (HTTP {cc})")]

    ok, ctext = _sim(c, phone, "CANCEL")
    low = (ctext or "").lower()
    honest = str(order_no) in (ctext or "") and \
        ("ready" in low or "waiting" in low or "made" in low) and "station" in low
    misleading = "don't have any" in low or "no pending" in low
    out.append(R("journeys", "cancel-after-ready: told the coffee is waiting",
                 "pass" if honest else ("fail" if misleading else "warn"),
                 (ctext or "")[:160],
                 evidence="" if honest else (ctext or "")[:300],
                 suggestion="" if honest else
                 "A customer whose coffee is on the shelf texted CANCEL and "
                 "was told they have no orders — reads as 'we lost it'.",
                 refs=[] if honest else ["services/coffee_system.py"]))
    c.post(f"/api/orders/{order_no}/pickup")
    return out


# ---------------------------------------------------------------- journey 7

def journey_reassign(rn):
    """Barista moves an order to another station: the move must stick, and a
    station that can't make the drink must be REFUSED (capability gate)."""
    c, out = rn.client, []
    drinks, milks, _ = _menu(c)
    stations = _stations(c) or []
    active = [s for s in stations if (s.get("status") or "active") == "active"]

    def capable_ids(milk_name):
        m = (milk_name or "").replace(" milk", "").lower()
        ids = []
        for s in active:
            mt = [str(x).lower().replace(" milk", "")
                  for x in ((s.get("capabilities") or {}).get("milk_types") or [])]
            if not mt or m in mt:
                ids.append(s.get("id") or s.get("station_id"))
        return ids

    # A restricted milk gives us both a capable target AND an incapable one.
    restricted = None
    for m in milks:
        cap = capable_ids(m)
        if 0 < len(cap) < len(active):
            restricted = (m, cap)
            break
    if not restricted:
        return [R("journeys", "reassign: capability gate", "skip",
                  "needs a milk some-but-not-all stations offer")]
    milk, cap = restricted
    incapable = next((s.get("id") or s.get("station_id") for s in active
                      if (s.get("id") or s.get("station_id")) not in cap), None)

    phone, order_no, reply = _place_sms_order(rn, f"{BENCH_TAG}Rea", "latte", milk)
    if not order_no:
        return [R("journeys", "reassign: setup order", "fail",
                  f"setup order failed: {(reply or '')[:140]}")]
    try:
        row = next((o for o in _order_list(c.get("/api/orders/pending")[1])
                    if str(o.get("order_number")) == str(order_no)), {})
        origin = row.get("station_id") or row.get("stationId")
        target = next((sid for sid in cap if sid != origin), None)
        if target is None:
            out.append(R("journeys", "reassign: to a capable station", "skip",
                         f"only one station ({origin}) can make {milk}"))
        else:
            rc, rb, _ = c.post(f"/api/orders/{order_no}/reassign",
                               {"target_station_id": target})
            row2 = next((o for o in _order_list(c.get("/api/orders/pending")[1])
                         if str(o.get("order_number")) == str(order_no)), {})
            landed = row2.get("station_id") or row2.get("stationId")
            moved = rc == 200 and str(landed) == str(target)
            out.append(R("journeys", "reassign: to a capable station",
                         "pass" if moved else "fail",
                         f"station {origin} → {target}: HTTP {rc}, now on {landed}",
                         evidence="" if moved else str(rb)[:200],
                         refs=[] if moved else ["routes/consolidated_api_routes.py"]))
        if incapable is not None:
            rc, rb, _ = c.post(f"/api/orders/{order_no}/reassign",
                               {"target_station_id": incapable})
            refused = rc != 200 or not (isinstance(rb, dict) and rb.get("success"))
            out.append(R("journeys", "reassign: incapable station is refused",
                         "pass" if refused else "fail",
                         f"reassign {milk} order to station {incapable} "
                         f"(can't make it) → HTTP {rc}",
                         suggestion="" if refused else
                         f"An order needing {milk} was moved to a station that "
                         "can't make it — it will strand there.",
                         refs=[] if refused else ["routes/consolidated_api_routes.py"]))
    finally:
        _sim(c, phone, "CANCEL")
        c.post(f"/api/orders/{order_no}/cancel")
    return out


def suite_journeys(rn):
    out = []
    out += journey_message_reply(rn)
    out += journey_forget_me(rn)
    out += journey_cancel_after_confirm(rn)
    out += journey_cancel_while_making(rn)
    out += journey_ready_reply(rn)
    out += journey_cancel_after_ready(rn)
    out += journey_reassign(rn)
    return out


JOURNEY_SUITES = [("journeys", suite_journeys, True)]
