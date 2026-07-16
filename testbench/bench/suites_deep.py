"""
Coffee Cue Test Bench — DEEP business-logic scenarios.

These go beyond "the endpoint answers": they place real orders and verify the
app's bookkeeping does what a barista/organiser expects —

  stock       an oat-milk order actually REDUCES the oat milk (and cup/coffee)
              counters in inventory, by the right amount, at the right moment;
              stock is restored to the pre-test level afterwards
  queue_wait  loading a station with 3 orders raises its queue count and its
              wait estimate; cancelling them brings it back down
  routing     an order for a milk only SOME stations can make lands on a
              capable station (live end-to-end, not just config comparison)
  group       a FRIEND group order creates linked orders for both people
  schedule    today's schedule endpoint works + honest notes on what the
              schedule does and does not control

All orders are phoneless or fake-numbered (no SMS can fire), named ZZBench*,
and cancelled in cleanup. Stock changes are measured then restored exactly.
"""
from __future__ import annotations

import re

from .core import BENCH_TAG, result
from .suites import _menu, _order_list, _sim, _stations

R = result


# ---------------------------------------------------------------- helpers

def _inventory(client):
    """GET /api/inventory → list of rows (tolerant of shape)."""
    code, body, _ = client.get("/api/inventory")
    if code != 200:
        return None
    if isinstance(body, dict):
        items = body.get("items") or body.get("data") or body.get("inventory") or []
    else:
        items = body if isinstance(body, list) else []
    return items if isinstance(items, list) else []


def _qty(row):
    for k in ("current_quantity", "amount", "quantity", "stock"):
        if row.get(k) is not None:
            try:
                return float(row[k])
            except (TypeError, ValueError):
                pass
    return None


def _inv_key(row):
    return (str(row.get("category") or "").lower(),
            str(row.get("name") or "").lower(),
            str(row.get("station_id") if row.get("station_id") is not None else ""))


def _snapshot(items):
    return {_inv_key(r): (_qty(r), r.get("id")) for r in items or []}


def _kiosk_order(client, name, drink, milk, size, station=None, debug_stock=False):
    body = {"name": name, "coffee_type": drink, "milk": milk, "size": size,
            "sugar": "No sugar", "phone": ""}
    if station is not None:
        body["preferred_station"] = station
    if debug_stock:
        body["debug_stock"] = True
    code, resp, ms = client.post("/api/display/order", body, auth=False)
    if code == 200 and isinstance(resp, dict) and resp.get("success"):
        no = (resp.get("order_number") or (resp.get("data") or {}).get("order_number")
              or resp.get("id"))
        st = resp.get("station_id") or (resp.get("data") or {}).get("station_id")
        _kiosk_order.last_debug = resp.get("stock_debug")
        return no, st, ms
    _kiosk_order.last_debug = None
    return None, f"HTTP {code}: {str(resp)[:200]}", ms
_kiosk_order.last_debug = None


def _cancel(client, order_no):
    code, _, _ = client.post(f"/api/orders/{order_no}/cancel")
    return code == 200


def _cleanup_bench_orders(rn, out, suite):
    """Safety net: cancel any still-pending ZZBench orders."""
    code, body, _ = rn.client.get("/api/orders/pending")
    leftovers = []
    for o in _order_list(body):
        nm = str(o.get("customer_name") or o.get("customerName") or "")
        if nm.lower().startswith(BENCH_TAG.lower()):
            no = o.get("order_number") or o.get("orderNumber") or o.get("id")
            if no is not None:
                leftovers.append(no)
    failed = [no for no in leftovers if not _cancel(rn.client, no)]
    if leftovers:
        out.append(R(suite, "cleanup: bench orders cancelled",
                     "pass" if not failed else "fail",
                     f"Cancelled {len(leftovers) - len(failed)}/{len(leftovers)} leftover "
                     f"{BENCH_TAG} orders",
                     suggestion="" if not failed else
                     f"Cancel these manually in the barista screen: {failed}"))


# ---------------------------------------------------------------- stock

def suite_stock(rn):
    """Order → inventory counters tick down (milk/cups/coffee), then restore."""
    c, out = rn.client, []

    # Ground truth first: what does the DATABASE say about inventory_items,
    # and what does a LIVE heal attempt report? (Settles the 'column does not
    # exist' saga with facts instead of forensics.)
    code, diag, _ = c.get("/api/debug/inventory-schema")
    if code == 200 and isinstance(diag, dict):
        out.append(R("stock", "schema ground truth", "pass",
                     f"db={diag.get('database')} user={diag.get('user')} "
                     f"heal_flag {diag.get('heal_flag_before')}→{diag.get('heal_flag_after')}",
                     evidence=f"columns: {diag.get('columns')} | search_path: "
                              f"{diag.get('search_path')} | heal_notes: {diag.get('heal_notes')} "
                              f"| heal_exception: {diag.get('heal_exception')} "
                              f"| pid: {diag.get('worker_pid')}"))
    else:
        out.append(R("stock", "schema ground truth", "warn",
                     f"diagnostic endpoint not available (HTTP {code}) — deploy pending?"))

    items = _inventory(c)
    if items is None:
        return [R("stock", "inventory endpoint", "fail", "GET /api/inventory failed",
                  refs=["routes/consolidated_api_routes.py"])]
    if not items:
        return [R("stock", "inventory rows exist", "warn",
                  "Inventory is EMPTY — stock tracking is effectively off; nothing "
                  "decrements and organisers get no run-out warnings.",
                  suggestion="Seed inventory via Organiser → Inventory or Quick Setup.")]

    drinks, milks, _sizes = _menu(c)
    inv_milks = {r["name"].lower() if isinstance(r.get("name"), str) else ""
                 for r in items if str(r.get("category")).lower() == "milk"}
    milk = next((m for m in ("oat", *milks) if m in inv_milks and m in (milks or [m])), None)
    if not milk:
        return [R("stock", "trackable milk on menu", "warn",
                  f"No menu milk has an inventory row (menu={milks}, "
                  f"inventory milks={sorted(inv_milks)}) — milk stock can never move.",
                  suggestion="Name inventory milk rows to match the menu "
                             "('oat', 'full cream', ...).",
                  refs=["services/coffee_system.py"])]
    drink = "latte" if "latte" in drinks else (drinks[0] if drinks else "latte")

    before = _snapshot(items)
    no, st, ms = _kiosk_order(c, f"{BENCH_TAG} Stock", drink, milk, "medium",
                              debug_stock=True)
    server_account = _kiosk_order.last_debug  # what the SERVER says it did
    if not no:
        return [R("stock", "place stock-test order", "fail", str(st), ms=ms)]

    after_items = _inventory(c) or []
    after = _snapshot(after_items)

    def delta(category, name_match):
        """Sum of decreases across rows of a category whose name matches."""
        d, rows = 0.0, []
        for k, (q0, _id) in before.items():
            cat, nm, sid = k
            if cat == category and (name_match is None or name_match in nm):
                q1 = after.get(k, (None, None))[0]
                if q0 is not None and q1 is not None and q1 < q0:
                    d += q0 - q1
                    rows.append((nm, sid, q0, q1))
        return d, rows

    milk_d, milk_rows = delta("milk", milk.split()[0])
    if milk_d > 0:
        # medium = 200 mL = 0.2 L per scope (station row + event-wide row may
        # both tick — that's by design so both report scopes stay accurate)
        per_scope_ok = all(abs((q0 - q1) - 0.2) < 0.11 for _, _, q0, q1 in milk_rows)
        out.append(R("stock", f"{milk} milk decremented by the order",
                     "pass" if per_scope_ok else "warn",
                     f"Order {no} (medium {drink}, {milk}) reduced "
                     + "; ".join(f"{nm}[st={sid or 'event'}] {q0}→{q1}" for nm, sid, q0, q1 in milk_rows)
                     + (" — expected ~0.2 L per scope" if not per_scope_ok else ""),
                     refs=[] if per_scope_ok else ["services/coffee_system.py"]))
    else:
        out.append(R("stock", f"{milk} milk decremented by the order", "fail",
                     f"Order {no} used {milk} but NO milk inventory row went down. "
                     "Organisers will run out with no warning.",
                     evidence=f"server's own account (stock_debug): {server_account}",
                     suggestion="Check _decrement_stock_for_order name-matching vs "
                                "the inventory row names.",
                     refs=["services/coffee_system.py"]))

    cups_d, cup_rows = delta("cups", None)
    out.append(R("stock", "a cup was decremented", "pass" if cups_d >= 1 else "warn",
                 f"Cups down {cups_d:g} ({[f'{nm}:{q0}→{q1}' for nm, _s, q0, q1 in cup_rows]})"
                 if cups_d else
                 "No cups row decremented — either no 'cups' inventory rows match the "
                 "size, or cup tracking is off. The cup counter a barista sees never moves.",
                 refs=[] if cups_d else ["services/coffee_system.py"]))

    coffee_d, _cr = delta("coffee", None)
    out.append(R("stock", "coffee decremented", "pass" if coffee_d > 0 else "warn",
                 f"Coffee down {coffee_d:g}" if coffee_d else
                 "No coffee row decremented — decrement matches rows by DRINK name "
                 f"(category 'coffee', name '{drink}'); if inventory only has e.g. "
                 "'coffee beans', the bean counter never moves.",
                 refs=[] if coffee_d else ["services/coffee_system.py"]))

    # cancel + does cancelling restock? (observation, not judgement)
    _cancel(c, no)
    after_cancel = _snapshot(_inventory(c) or [])
    restocked = any(
        (after_cancel.get(k, (None, None))[0] or 0) > (after.get(k, (None, None))[0] or 0)
        for k in before
    )
    out.append(R("stock", "cancel restocks (observation)", "pass" if restocked else "warn",
                 "Cancelling the order restored stock" if restocked else
                 "Cancelling an order does NOT put the stock back — after a mis-order "
                 "+ cancel, counters drift low. Minor, but organisers should know.",
                 refs=[] if restocked else ["routes/consolidated_api_routes.py"]))

    # restore any rows still below their pre-test level (exact bench hygiene)
    restored, restore_fail = 0, 0
    for k, (q0, item_id) in before.items():
        q_now = after_cancel.get(k, (None, None))[0]
        if q0 is not None and q_now is not None and q_now < q0 and item_id is not None:
            code, _, _ = c.post(f"/api/inventory/{item_id}/adjust",
                                {"new_amount": q0, "change_reason": "bench_restore",
                                 "notes": f"Test Bench restore after order {no}"})
            restored += 1 if code == 200 else 0
            restore_fail += 0 if code == 200 else 1
    out.append(R("stock", "cleanup: stock restored to pre-test levels",
                 "pass" if restore_fail == 0 else "fail",
                 f"{restored} row(s) restored" + (f", {restore_fail} FAILED" if restore_fail else ""),
                 suggestion="" if restore_fail == 0 else
                 "Fix the counts manually in Organiser → Inventory."))
    _cleanup_bench_orders(rn, out, "stock")
    return out


# ---------------------------------------------------------------- queue/wait

def suite_queue_wait(rn):
    """3 extra orders on one station must raise its queue + wait, then fall."""
    c, out = rn.client, []
    stations = _stations(c) or []
    active = [s for s in stations if (s.get("status") or "active") == "active"]
    if not active:
        return [R("queue_wait", "precondition", "skip", "No active stations")]
    target = min(active, key=lambda s: s.get("queue_count", s.get("queueCount", 0)) or 0)
    sid = target.get("id") or target.get("station_id")
    q0 = int(target.get("queue_count", target.get("queueCount", 0)) or 0)
    w0 = target.get("estimated_wait", target.get("estimatedWait"))

    drinks, milks, _ = _menu(c)
    drink = "latte" if "latte" in drinks else (drinks[0] if drinks else "latte")
    # Order a milk the TARGET station can make — run 3 ordered almond (first
    # menu milk) pinned to a full-cream-only station, and the app CORRECTLY
    # overrode the preference. The queue test must not fight capability.
    st_milks = [str(x).lower().replace(" milk", "")
                for x in ((target.get("capabilities") or {}).get("milk_types") or [])]
    milk = next((m for m in milks if not st_milks or m.replace(" milk", "") in st_milks),
                milks[0] if milks else "full cream")

    nos, landed = [], []
    for i in range(3):
        no, st, _ = _kiosk_order(c, f"{BENCH_TAG} Q{i+1}", drink, milk, "medium", station=sid)
        if no:
            nos.append(no)
            landed.append(st)
    if len(nos) < 3:
        out.append(R("queue_wait", "load station with 3 orders", "fail",
                     f"Only {len(nos)}/3 orders created on station {sid}"))
    elif any(st != sid for st in landed):
        # asked for station `sid` but the kiosk routed elsewhere — that's the
        # real story behind a flat queue count, so surface it as its own check
        out.append(R("queue_wait", "orders honour the requested station", "fail",
                     f"Asked for station {sid}, but orders landed on {landed} — "
                     "preferred_station was not honoured.",
                     refs=["routes/consolidated_api_routes.py"]))

    code, body, _ = c.get("/api/stations")
    now = next((s for s in (body.get("stations") or body.get("data") or [])
                if (s.get("id") or s.get("station_id")) == sid), {}) if code == 200 else {}
    q1 = int(now.get("queue_count", now.get("queueCount", 0)) or 0)
    w1 = now.get("estimated_wait", now.get("estimatedWait"))

    out.append(R("queue_wait", "queue count rises with load",
                 "pass" if q1 >= q0 + len(nos) else "fail",
                 f"Station {sid}: queue {q0} → {q1} after +{len(nos)} orders",
                 evidence="" if q1 >= q0 + len(nos) else
                 f"created orders {nos} landed on stations {landed}; "
                 f"station row after: {str(now)[:400]}",
                 suggestion="" if q1 >= q0 + len(nos) else
                 "The live queue count isn't reflecting created orders.",
                 refs=[] if q1 >= q0 + len(nos) else ["routes/station_api_routes.py"]))
    if isinstance(w0, (int, float)) and isinstance(w1, (int, float)):
        out.append(R("queue_wait", "wait estimate responds to load",
                     "pass" if w1 >= w0 else "warn",
                     f"Station {sid}: wait {w0} → {w1} min with {len(nos)} extra orders",
                     suggestion="" if w1 >= w0 else
                     "Wait estimate didn't rise as the queue grew — check the wait model.",
                     refs=[] if w1 >= w0 else ["services/coffee_system.py"]))
    else:
        out.append(R("queue_wait", "wait estimate responds to load", "warn",
                     f"No numeric estimated_wait exposed (before={w0!r}, after={w1!r})"))

    for no in nos:
        _cancel(c, no)
    code, body, _ = c.get("/api/stations")
    fin = next((s for s in (body.get("stations") or body.get("data") or [])
                if (s.get("id") or s.get("station_id")) == sid), {}) if code == 200 else {}
    q2 = int(fin.get("queue_count", fin.get("queueCount", 0)) or 0)
    out.append(R("queue_wait", "queue falls after cancellations",
                 "pass" if q2 < q1 else "fail",
                 f"Station {sid}: queue {q1} → {q2} after cancelling the bench orders"))
    _cleanup_bench_orders(rn, out, "queue_wait")
    return out


# ---------------------------------------------------------------- routing

def suite_routing(rn):
    """A live SMS order for a restricted milk lands on a capable station."""
    c, out = rn.client, []
    stations = _stations(c) or []
    active = [s for s in stations if (s.get("status") or "active") == "active"]
    _drinks, milks, _ = _menu(c)

    # find a milk that only a PROPER subset of active stations lists
    pick, capable_ids = None, []
    for milk in milks:
        caps_sets = []
        for s in active:
            mt = [str(x).lower().replace(" milk", "")
                  for x in ((s.get("capabilities") or {}).get("milk_types") or [])]
            caps_sets.append((s.get("id") or s.get("station_id"), mt))
        cap = [sid for sid, mt in caps_sets if not mt or milk.replace(" milk", "") in mt]
        explicit = [sid for sid, mt in caps_sets if mt and milk.replace(" milk", "") in mt]
        if explicit and len(cap) < len(active):
            pick, capable_ids = milk, cap
            break
    if not pick:
        return [R("routing", "restricted-milk live routing", "skip",
                  "Every menu milk is makeable at every active station (or all "
                  "stations are wildcard) — no restricted case to exercise. "
                  "Configure differing station milk capabilities to enable this test.")]

    ph = rn.next_phone()
    ok, reply = _sim(c, ph, f"{BENCH_TAG}Route latte with {pick} milk")
    turns, low = 0, reply.lower()
    while ok and turns < 3 and ("what size" in low or "what milk" in low):
        ok, reply = _sim(c, ph, "medium" if "size" in low else pick)
        low = reply.lower()
        turns += 1
    m = re.search(r"[Ss]tation\s+(\d+)", reply)
    confirmed = ok and ("confirmed" in low or "order #" in low or "being made" in low
                        or "you're #" in low)
    if not confirmed:
        out.append(R("routing", "restricted-milk live routing", "fail",
                     f"Order for {pick} did not confirm: {reply[:160]}",
                     refs=["services/coffee_system.py"]))
        _sim(c, ph, "CANCEL")
        return out

    # which station did it land on? (from the reply if present, else pending)
    landed = int(m.group(1)) if m else None
    if landed is None:
        code, body, _ = c.get("/api/orders/pending")
        for o in _order_list(body):
            nm = str(o.get("customer_name") or o.get("customerName") or "")
            if nm.lower().startswith(f"{BENCH_TAG}Route".lower()):
                landed = o.get("station_id") or o.get("stationId")
                break
    good = landed is not None and landed in capable_ids
    row_ev = ""
    if not good:
        code, body, _ = c.get("/api/orders/pending")
        rows = [o for o in _order_list(body)
                if str(o.get("customer_name") or o.get("customerName") or "")
                .lower().startswith(f"{BENCH_TAG}Route".lower())]
        row_ev = (f"confirm reply: {reply[:200]} | matching pending rows: "
                  + "; ".join(
                      f"#{o.get('order_number') or o.get('orderNumber') or o.get('id')}"
                      f" station={o.get('station_id') or o.get('stationId')}"
                      f" created={str(o.get('created_at') or o.get('createdAt'))[:19]}"
                      for o in rows) )
    out.append(R("routing", "restricted-milk live routing",
                 "pass" if good else ("warn" if landed is None else "fail"),
                 f"Live {pick} order landed on station {landed} "
                 f"(capable stations: {capable_ids})",
                 evidence=row_ev,
                 suggestion="" if good else
                 ("Couldn't determine the landing station" if landed is None else
                  f"An order for {pick} was assigned to station {landed}, which does "
                  "not list that milk — the #165 routing class."),
                 refs=[] if good else ["services/coffee_system.py"]))
    ok, reply = _sim(c, ph, "CANCEL")
    out.append(R("routing", "cleanup: order cancelled",
                 "pass" if "cancel" in reply.lower() else "warn", reply[:120]))
    _cleanup_bench_orders(rn, out, "routing")
    return out


# ---------------------------------------------------------------- group

def suite_group(rn):
    """FRIEND flow: one customer orders for two people; both orders exist."""
    c, out = rn.client, []
    _drinks, milks, _ = _menu(c)
    milk = next((m for m in ("full cream", "skim") if m in milks),
                milks[0] if milks else "full cream")
    ph = rn.next_phone()

    ok, reply = _sim(c, ph, f"{BENCH_TAG}Grp medium latte with {milk}")
    low, turns = reply.lower(), 0
    while ok and turns < 3 and ("what size" in low or "what milk" in low):
        ok, reply = _sim(c, ph, "medium" if "size" in low else milk)
        low = reply.lower()
        turns += 1
    if not ("confirmed" in low or "order #" in low or "friend" in low):
        out.append(R("group", "primary order confirms", "fail", reply[:160],
                     refs=["services/coffee_system.py"]))
        _sim(c, ph, "CANCEL")
        return out
    out.append(R("group", "primary order confirms", "pass", reply[:120]))

    ok, reply = _sim(c, ph, "FRIEND")
    low = reply.lower()
    if "name" not in low:
        out.append(R("group", "FRIEND starts a friend order",
                     "fail", f"Expected a friend-name prompt, got: {reply[:160]}",
                     refs=["services/coffee_system.py"]))
    else:
        out.append(R("group", "FRIEND starts a friend order", "pass", reply[:120]))
        ok, reply = _sim(c, ph, f"{BENCH_TAG}Mate")
        low, turns = reply.lower(), 0
        # answer prompts until confirmed (drink → milk → size, any order)
        while ok and turns < 7 and not ("confirmed" in low or "order #" in low
                                        or "friend" in low and "another" in low):
            if "reply yes" in low or ("yes to confirm" in low):
                # the friend flow has an explicit YES confirmation step
                ans = "YES"
            elif "what can i get" in low or "drink" in low or "coffee" in low and "?" in low:
                ans = "latte"
            elif "milk" in low:
                ans = milk
            elif "size" in low:
                ans = "medium"
            else:
                break
            ok, reply = _sim(c, ph, ans)
            low = reply.lower()
            turns += 1
        friend_ok = "confirmed" in low or "order #" in low or "#" in reply
        out.append(R("group", "friend's coffee confirms",
                     "pass" if friend_ok else "fail", reply[:160],
                     refs=[] if friend_ok else ["services/coffee_system.py"]))
        _sim(c, ph, "NO")  # end the friend loop politely

    # both orders visible?
    code, body, _ = c.get("/api/orders/pending")
    bench = [o for o in _order_list(body)
             if str(o.get("customer_name") or o.get("customerName") or "")
             .lower().startswith(BENCH_TAG.lower())]
    out.append(R("group", "both group orders reach the queue",
                 "pass" if len(bench) >= 2 else "warn",
                 f"{len(bench)} {BENCH_TAG}* orders in pending after the group flow"))
    _cleanup_bench_orders(rn, out, "group")
    return out


# ---------------------------------------------------------------- schedule

def suite_schedule(rn):
    """Schedule endpoints work + honest notes on what schedule controls."""
    c, out = rn.client, []
    code, body, ms = c.get("/api/schedule/today")
    if code == 200:
        data = body.get("data") if isinstance(body, dict) else None
        shifts = data if isinstance(data, list) else (
            (data or {}).get("shifts") if isinstance(data, dict) else None)
        n = len(shifts) if isinstance(shifts, list) else "unknown"
        out.append(R("schedule", "today's schedule endpoint", "pass",
                     f"GET /api/schedule/today → 200 ({n} shift(s) today)", ms=ms))
        if n == 0:
            out.append(R("schedule", "shifts configured", "warn",
                         "No shifts configured for today — the Schedule screen shows "
                         "nothing and gives baristas no roster.",
                         suggestion="If you use the roster, add shifts in Organiser → Schedule."))
    else:
        out.append(R("schedule", "today's schedule endpoint", "fail",
                     f"GET /api/schedule/today → HTTP {code}", evidence=str(body)[:200],
                     refs=["routes/consolidated_api_routes.py"], ms=ms))

    # Honest design note, surfaced as a result so it's visible in every report:
    out.append(R("schedule", "what the schedule controls (design note)", "warn",
                 "Barista shifts are INFORMATIONAL — order routing only respects "
                 "station status (online/offline) and event BREAKS, not who is "
                 "rostered. A station with no barista on shift still receives orders "
                 "if its status is active.",
                 suggestion="If you want the roster to gate routing (e.g. auto-offline "
                            "a station with nobody rostered), that's a feature to build.",
                 refs=["services/coffee_system.py"]))
    return out


DEEP_SUITES = [
    ("stock", suite_stock, True),
    ("queue_wait", suite_queue_wait, True),
    ("routing", suite_routing, True),
    ("group", suite_group, True),
    ("schedule", suite_schedule, True),
]
