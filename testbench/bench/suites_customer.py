"""
Coffee Cue Test Bench — CUSTOMER MEMORY & SOCIAL FLOWS (roadmap queue item 1).

The "returning customer" domain — the app's memory of people — plus the
social/edit keywords real crowds use:

  usual       order once → text USUAL later → the app replays the SAME drink
              (customer_preferences memory actually works end to end)
  same_name   two different customers with the same first name at once →
              two DISTINCT order numbers, both visible (pickup-confusion guard)
  group3      FRIEND × 2 then DONE → a group of THREE all confirmed + queued
              (the 2-person group suite never exercised ANOTHER/DONE)
  change      CHANGE mid-confirmation ("change milk to X") edits ONLY that
              field and re-confirms — the targeted-edit path

All SMS via /api/sms/simulate (zero real SMS), fresh uuid-virgin phones,
ZZBench* names, everything cancelled/swept in cleanup.
"""
from __future__ import annotations

import re as _re

from .core import BENCH_TAG, result
from .suites import _menu, _order_list, _sim

R = result

_ORDNUM = _re.compile(r"[Oo]rder\s*#?\s*([A-Za-z]{0,3}\d+)")


def _order_number(reply):
    m = _ORDNUM.search(reply or "")
    return m.group(1) if m else None


def _pending_named(c, name_prefix):
    code, body, _ = c.get("/api/orders/pending")
    return [o for o in _order_list(body)
            if str(o.get("customer_name") or o.get("customerName") or "")
            .lower().startswith(name_prefix.lower())]


def _sweep(rn, prefix=BENCH_TAG):
    c = rn.client
    for o in _pending_named(c, prefix):
        no = o.get("order_number") or o.get("orderNumber") or o.get("id")
        if no is not None:
            c.post(f"/api/orders/{no}/cancel")


def _answer_until(c, ph, first_msg, stop_words, milk, max_turns=8):
    """Send first_msg then answer the bot's prompts (drink/milk/size/sugar/
    YES) until the reply contains one of stop_words or turns run out."""
    ok, reply = _sim(c, ph, first_msg)
    turns = 0
    while ok and turns < max_turns:
        low = (reply or "").lower()
        if any(w in low for w in stop_words):
            return ok, reply
        if "reply yes" in low or "yes to confirm" in low:
            ans = "YES"
        elif "milk" in low and "?" in low:
            ans = milk
        elif "size" in low:
            ans = "medium"
        elif "sugar" in low:
            ans = "no sugar"
        elif "coffee" in low or "drink" in low or "what can i get" in low:
            ans = "latte"
        else:
            return ok, reply
        ok, reply = _sim(c, ph, ans)
        turns += 1
    return ok, reply


# ------------------------------------------------------------------- usual

def suite_customer(rn):
    c, out = rn.client, []
    drinks, milks, _sizes = _menu(c)
    milk = next((m for m in ("skim", "full cream") if m in milks),
                milks[0] if milks else "full cream")
    other_milk = next((m for m in milks if m != milk), None)

    # ---- USUAL: order once, cancel, then the app must still remember ----
    ph = rn.next_phone()
    ok, reply = _answer_until(c, ph, f"{BENCH_TAG}Usu large cappuccino with {milk}",
                              ("confirmed", "order #"), milk)
    onum = _order_number(reply)
    placed = ok and onum is not None
    out.append(R("customer", "usual: first order confirms",
                 "pass" if placed else "fail", (reply or "")[:140],
                 refs=[] if placed else ["services/coffee_system.py"]))
    if placed:
        _sim(c, ph, "CANCEL")  # history lives in customer_preferences, not the order
        ok, reply = _sim(c, ph, "USUAL")
        low = (reply or "").lower()
        remembered = "usual" in low and "cappuccino" in low
        out.append(R("customer", "usual: USUAL replays the remembered drink",
                     "pass" if remembered else "fail",
                     (reply or "")[:160],
                     evidence="" if remembered else (reply or "")[:400],
                     suggestion="" if remembered else
                     "A customer who has ordered before texted USUAL and did not "
                     "get their saved drink back — customer memory is broken for "
                     "the one-shot order path.",
                     refs=[] if remembered else ["services/coffee_system.py"]))
        if remembered:
            right_milk = milk in low
            out.append(R("customer", "usual: remembers the milk too",
                         "pass" if right_milk else "warn",
                         f"expected '{milk}' in the usual summary: {(reply or '')[:120]}"))
        _sim(c, ph, "NO")  # decline — leave nothing in the queue

    # ---- SAME NAME: two customers, same first name, at the same time ----
    ph_a, ph_b = rn.next_phone(), rn.next_phone()
    ok_a, rep_a = _answer_until(c, ph_a, f"{BENCH_TAG}Twin medium latte with {milk}",
                                ("confirmed", "order #"), milk)
    ok_b, rep_b = _answer_until(c, ph_b, f"{BENCH_TAG}Twin medium latte with {milk}",
                                ("confirmed", "order #"), milk)
    na, nb = _order_number(rep_a), _order_number(rep_b)
    both = ok_a and ok_b and na and nb
    distinct = both and na != nb
    out.append(R("customer", "same name: both twins get orders",
                 "pass" if both else "fail",
                 f"A→#{na}, B→#{nb}" if both else
                 f"A: {(rep_a or '')[:80]} / B: {(rep_b or '')[:80]}",
                 refs=[] if both else ["services/coffee_system.py"]))
    if both:
        out.append(R("customer", "same name: order numbers are distinct",
                     "pass" if distinct else "fail",
                     f"#{na} vs #{nb}",
                     suggestion="" if distinct else
                     "Two customers with the same first name got the same order "
                     "number — pickup will hand one of them the wrong coffee."))
        twins = _pending_named(c, f"{BENCH_TAG}Twin")
        out.append(R("customer", "same name: both visible in pending",
                     "pass" if len(twins) >= 2 else "fail",
                     f"{len(twins)} {BENCH_TAG}Twin orders in pending"))
    for p in (ph_a, ph_b):
        _sim(c, p, "CANCEL")

    # ---- GROUP OF 3: primary + FRIEND + ANOTHER friend + DONE ----
    ph = rn.next_phone()
    ok, reply = _answer_until(c, ph, f"{BENCH_TAG}Grp3 medium latte with {milk}",
                              ("confirmed", "order #"), milk)
    if not (ok and _order_number(reply)):
        out.append(R("customer", "group3: primary confirms", "fail",
                     (reply or "")[:160], refs=["services/coffee_system.py"]))
    else:
        friends_done = 0
        for friend in (f"{BENCH_TAG}MateA", f"{BENCH_TAG}MateB"):
            ok, reply = _sim(c, ph, "FRIEND")
            if not ok or "name" not in (reply or "").lower():
                break
            ok, reply = _answer_until(c, ph, friend,
                                      ("confirmed", "order #", "friend to add",
                                       "done to finish"), milk)
            if ok and (_order_number(reply) or "confirmed" in (reply or "").lower()):
                friends_done += 1
            else:
                break
        out.append(R("customer", "group3: two friends confirm",
                     "pass" if friends_done == 2 else "fail",
                     f"{friends_done}/2 friend orders confirmed; last reply: {(reply or '')[:110]}",
                     refs=[] if friends_done == 2 else ["services/coffee_system.py"]))
        ok, reply = _sim(c, ph, "DONE")
        low = (reply or "").lower()
        # STRICT: the summary must say THREE coffees. First live run said
        # "group order of 2 coffees" while 3 orders sat in pending — the
        # group counter loses a friend.
        counted3 = ok and "3" in low and "group" in low
        out.append(R("customer", "group3: DONE reports a group of 3",
                     "pass" if counted3 else ("warn" if ok else "fail"),
                     (reply or "")[:160],
                     evidence="" if counted3 else (reply or "")[:300],
                     suggestion="" if counted3 else
                     "DONE's summary under-counts the group (says 2, but 3 "
                     "orders are queued) — group_orders loses a friend "
                     "somewhere in the FRIEND→YES→FRIEND loop.",
                     refs=[] if counted3 else ["services/coffee_system.py"]))
        grp = _pending_named(c, BENCH_TAG)
        out.append(R("customer", "group3: all 3 orders reach the queue",
                     "pass" if len(grp) >= 3 else "fail",
                     f"{len(grp)} {BENCH_TAG}* orders in pending"))
        # The deeper promise: ONE group. The second FRIEND used to re-derive
        # the group anchor from the most recent order, silently splitting the
        # barista's group badge into two groups. The pending API doesn't
        # expose group_id, so fetch each order's detail; fall back to the
        # batchGroup key with an honest note if details aren't available.
        gids, source = set(), "order_details.group_id"
        for o in grp:
            no = o.get("order_number") or o.get("orderNumber") or o.get("id")
            dc, db_, _ = c.get(f"/api/orders/{no}")
            det = {}
            if dc == 200 and isinstance(db_, dict):
                det = (db_.get("order") or db_.get("data") or db_)
                det = det.get("order_details") or det.get("orderDetails") or {}
                if isinstance(det, str):
                    try:
                        import json as _json
                        det = _json.loads(det)
                    except Exception:
                        det = {}
            gid = det.get("group_id") if isinstance(det, dict) else None
            if gid is None:
                source = "batchGroup (order detail endpoint has no group_id)"
                gid = o.get("batchGroup") or o.get("batch_group")
            gids.add(str(gid) if gid else None)
        one_group = len(grp) >= 3 and len(gids) == 1 and None not in gids
        out.append(R("customer", "group3: all 3 share ONE group id",
                     "pass" if one_group else "warn",
                     f"via {source}: {sorted(str(g) for g in gids)}",
                     suggestion="" if one_group else
                     "The group's orders don't share a single group_id — the "
                     "barista's group badge / 'Start group' will split or miss "
                     "coffees.",
                     refs=[] if one_group else ["services/coffee_system.py"]))

    _sweep(rn)

    # ---- CHANGE: targeted edit at the confirmation step (via USUAL) ----
    if other_milk is None:
        out.append(R("customer", "change: targeted edit", "skip",
                     "menu has only one milk — cannot test changing it"))
    else:
        ph = rn.next_phone()
        ok, reply = _answer_until(c, ph, f"{BENCH_TAG}Chg medium latte with {milk}",
                                  ("confirmed", "order #"), milk)
        if ok and _order_number(reply):
            _sim(c, ph, "CANCEL")
            ok, reply = _sim(c, ph, "USUAL")  # opens an awaiting_confirmation window
            if ok and "usual" in (reply or "").lower():
                ok, reply = _sim(c, ph, f"CHANGE milk to {other_milk}")
                low = (reply or "").lower()
                edited = ok and other_milk in low
                kept_drink = "latte" in low
                out.append(R("customer", "change: CHANGE milk swaps only the milk",
                             "pass" if (edited and kept_drink) else
                             ("warn" if edited else "fail"),
                             (reply or "")[:160],
                             evidence="" if edited else (reply or "")[:400],
                             suggestion="" if edited else
                             f"'CHANGE milk to {other_milk}' at the confirmation "
                             "step did not produce an updated order summary.",
                             refs=[] if edited else ["services/coffee_system.py"]))
                _sim(c, ph, "NO")  # decline the edited order — nothing queued
            else:
                out.append(R("customer", "change: targeted edit", "warn",
                             f"couldn't open a confirmation window via USUAL: {(reply or '')[:120]}"))
        else:
            out.append(R("customer", "change: targeted edit", "warn",
                         f"setup order didn't confirm: {(reply or '')[:120]}"))

    _sweep(rn)

    # ---- STATUS with an ACTIVE order ("where's my coffee?") -------------
    ph = rn.next_phone()
    ok, reply = _answer_until(c, ph, f"{BENCH_TAG}Sta medium latte with {milk}",
                              ("confirmed", "order #"), milk)
    onum = _order_number(reply)
    if onum:
        ok, sreply = _sim(c, ph, "STATUS")
        low = (sreply or "").lower()
        has_num = onum in (sreply or "")
        informative = ("#" in (sreply or "")) and ("queue" in low or "position" in low
                       or "station" in low or "being made" in low or "pending" in low
                       or "waiting" in low or "in line" in low)
        out.append(R("customer", "STATUS with an active order is informative",
                     "pass" if (has_num and informative) else "fail",
                     (sreply or "")[:160],
                     evidence="" if (has_num and informative) else (sreply or "")[:300],
                     suggestion="" if (has_num and informative) else
                     "A queueing customer texting STATUS should be told their "
                     "order number and where it is.",
                     refs=[] if (has_num and informative) else ["services/coffee_system.py"]))
        _sim(c, ph, "CANCEL")
    else:
        out.append(R("customer", "STATUS with an active order is informative",
                     "warn", f"setup order didn't confirm: {(reply or '')[:120]}"))

    # ---- WELCOME BACK: a known customer's greeting gets recognised ------
    ph = rn.next_phone()
    ok, reply = _answer_until(c, ph, f"{BENCH_TAG}Wel large latte with {milk}",
                              ("confirmed", "order #"), milk)
    if _order_number(reply):
        _sim(c, ph, "CANCEL")
        ok, greet = _sim(c, ph, "hi")
        low = (greet or "").lower()
        recognised = "welcome back" in low and "wel" in low  # name is title-cased
        suggested = "usual" in low or "coffee would you like" in low
        out.append(R("customer", "welcome back: greeting recognises the customer",
                     "pass" if (recognised and suggested) else
                     ("warn" if recognised else "fail"),
                     (greet or "")[:160],
                     evidence="" if recognised else (greet or "")[:300],
                     suggestion="" if recognised else
                     "A returning customer saying 'hi' was greeted as a "
                     "stranger — customer memory isn't reaching the greeting.",
                     refs=[] if recognised else ["services/coffee_system.py"]))
        _sim(c, ph, "CANCEL")
    else:
        out.append(R("customer", "welcome back: greeting recognises the customer",
                     "warn", f"setup order didn't confirm: {(reply or '')[:120]}"))

    # ---- SECOND ORDER while one is pending (impatient double-order) ------
    ph = rn.next_phone()
    ok, r1 = _answer_until(c, ph, f"{BENCH_TAG}Two medium latte with {milk}",
                           ("confirmed", "order #"), milk)
    n1 = _order_number(r1)
    if n1:
        ok, r2 = _answer_until(c, ph, f"large cappuccino with {milk}",
                               ("confirmed", "order #"), milk)
        n2 = _order_number(r2)
        both = n2 is not None and n2 != n1
        pend = _pending_named(c, f"{BENCH_TAG}Two")
        out.append(R("customer", "second order while pending stacks cleanly",
                     "pass" if (both and len(pend) >= 2) else "fail",
                     f"first #{n1}, second #{n2}, {len(pend)} orders in pending",
                     evidence="" if both else (r2 or "")[:300],
                     suggestion="" if both else
                     "A customer ordering again while one is queued should get "
                     "a SECOND order (or a clear explanation) — not confusion.",
                     refs=[] if both else ["services/coffee_system.py"]))
        _sim(c, ph, "CANCEL")  # cancels most recent
        _sim(c, ph, "CANCEL")  # then the first
    else:
        out.append(R("customer", "second order while pending stacks cleanly",
                     "warn", f"setup order didn't confirm: {(r1 or '')[:120]}"))

    _sweep(rn)
    return out


CUSTOMER_SUITES = [
    ("customer", suite_customer, True),
]
