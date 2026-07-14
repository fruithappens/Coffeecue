"""
Coffee Cue Test Bench — the SCENARIO MATRIX.

Steve's ask: "surely there's a matrix — work out what could happen, make it
happen, and test that it gets the expected result in the expected place."

This module does that with ALL-PAIRS COMBINATORIAL TESTING. The dimensions
(order channel, drink, milk, size, sugar) are read LIVE from the target's
menu — so the matrix adapts to however the event is configured — plus one
deliberately-unavailable milk to exercise the refusal path. A full cartesian
product would be thousands of live orders; the pairwise generator guarantees
every PAIR of factor values occurs together at least once in ~15-25 scenarios.

Every generated scenario is then RUN for real and judged against an ORACLE of
expected outcomes:

  E1 accepted/refused correctly — an order every station can make must be
     ACCEPTED; an order with the unavailable milk must be REFUSED (never
     silently confirmed — the #165 class)
  E2 lands in the right place — an accepted order appears in the pending
     queue, assigned to a station that can actually make its milk
  E3 reversible — cancelling removes it from the queue

Cleanup: all orders cancelled, stock snapshot taken before and restored after
(kiosk orders decrement stock at creation and cancel doesn't restock).
Phoneless + simulate harness only — zero real SMS.
"""
from __future__ import annotations

import itertools
import re

from .core import BENCH_TAG, result
from .suites import _menu, _order_list, _sim, _stations
from .suites_deep import _cancel, _inventory, _kiosk_order, _snapshot

R = result

MAX_SCENARIOS_DEFAULT = 18   # cap on live orders per matrix run


# ---------------------------------------------------------------- pairwise

def allpairs(dimensions):
    """Greedy all-pairs generator.

    dimensions: list of (name, [values]). Returns a list of dicts, each a full
    combination, such that every pair of values from any two dimensions
    appears in at least one combination. Classic greedy construction — small,
    deterministic, no external libs.
    """
    names = [n for n, _ in dimensions]
    values = [v for _, v in dimensions]
    # all uncovered pairs: ((dim_i, val), (dim_j, val))
    uncovered = set()
    for (i, vi), (j, vj) in itertools.combinations(enumerate(values), 2):
        for a in vi:
            for b in vj:
                uncovered.add((i, a, j, b))

    scenarios = []
    while uncovered:
        best, best_gain = None, -1
        # try candidate combos seeded from an uncovered pair, greedily filling
        seed = next(iter(uncovered))
        si, sa, sj, sb = seed
        combo = [None] * len(names)
        combo[si], combo[sj] = sa, sb
        for k in range(len(names)):
            if combo[k] is not None:
                continue
            best_v, best_v_gain = values[k][0], -1
            for v in values[k]:
                gain = 0
                for m in range(len(names)):
                    if m == k or combo[m] is None:
                        continue
                    pair = (m, combo[m], k, v) if m < k else (k, v, m, combo[m])
                    if pair in uncovered:
                        gain += 1
                if gain > best_v_gain:
                    best_v, best_v_gain = v, gain
            combo[k] = best_v
        # mark covered
        newly = set()
        for (i2, j2) in itertools.combinations(range(len(names)), 2):
            p = (i2, combo[i2], j2, combo[j2])
            if p in uncovered:
                newly.add(p)
        uncovered -= newly
        best, best_gain = combo, len(newly)
        scenarios.append(dict(zip(names, best)))
        if len(scenarios) > 200:  # safety: should never happen
            break
    return scenarios


# ---------------------------------------------------------------- oracle bits

def _capable_ids(active_stations, milk):
    """Active station ids that can make `milk` (empty capability = wildcard)."""
    out = []
    m = (milk or "").replace(" milk", "").lower()
    for s in active_stations:
        mt = [str(x).lower().replace(" milk", "")
              for x in ((s.get("capabilities") or {}).get("milk_types") or [])]
        if not mt or not m or m in ("no milk",) or m in mt:
            out.append(s.get("id") or s.get("station_id"))
    return out


def _find_pending(client, name_tag):
    code, body, _ = client.get("/api/orders/pending")
    for o in _order_list(body):
        nm = str(o.get("customer_name") or o.get("customerName") or "")
        if nm.lower().startswith(name_tag.lower()):
            return o
    return None


# ---------------------------------------------------------------- the suite

def suite_matrix(rn):
    c, out = rn.client, []
    drinks, milks, sizes = _menu(c)
    stations = _stations(c) or []
    active = [s for s in stations if (s.get("status") or "active") == "active"]
    if not (drinks and milks and active):
        return [R("matrix", "preconditions", "skip",
                  f"Need menu + active stations (drinks={len(drinks)}, "
                  f"milks={len(milks)}, active stations={len(active)})")]

    # ---- dimensions, read from the LIVE configuration -------------------
    rep_drinks = [d for d in ("latte", "flat white", "cappuccino", "long black",
                              "hot chocolate") if d in drinks][:4] or drinks[:3]
    # one milk no station offers → the refusal path gets matrix coverage
    unavailable = next((m for m in ("macadamia", "buffalo") if m not in milks), None)
    dim_milks = milks[:4] + (["__unavailable__"] if unavailable else [])
    dims = [
        ("channel", ["kiosk", "sms"]),
        ("drink", rep_drinks),
        ("milk", dim_milks),
        ("size", sizes[:3] or ["medium"]),
        ("sugar", ["no sugar", "2 sugars"]),
    ]
    scenarios = allpairs(dims)
    cap = int(rn.options.get("matrix_max") or MAX_SCENARIOS_DEFAULT)
    trimmed = len(scenarios) > cap
    scenarios = scenarios[:cap]
    out.append(R("matrix", "scenario generation", "pass",
                 f"Dimensions: {', '.join(f'{n}×{len(v)}' for n, v in dims)} → "
                 f"{len(scenarios)} all-pairs scenarios"
                 + (f" (trimmed to the {cap}-order safety cap)" if trimmed else "")
                 + (f"; refusal milk: {unavailable}" if unavailable else "")))

    stock_before = _snapshot(_inventory(c) or [])
    black_drinks = ("long black", "espresso", "short black", "americano")

    for i, sc in enumerate(scenarios, 1):
        sid_tag = f"{BENCH_TAG}Mx{i:02d}"
        milk = unavailable if sc["milk"] == "__unavailable__" else sc["milk"]
        is_black = sc["drink"] in black_drinks
        eff_milk = "no milk" if is_black else milk
        expect_refusal = (sc["milk"] == "__unavailable__") and not is_black
        label = f"{sc['channel']}: {sc['size']} {sc['drink']} / {eff_milk} / {sc['sugar']}"

        try:
            if sc["channel"] == "kiosk":
                no, st, _ = _kiosk_order(c, sid_tag, sc["drink"], eff_milk, sc["size"])
                accepted = no is not None
                landing = st if accepted else None
                order_no = no
            else:
                ph = rn.next_phone()
                text = f"{sid_tag} {sc['size']} {sc['drink']}"
                if not is_black:
                    text += f" with {eff_milk}"
                if sc["sugar"] != "no sugar":
                    text += f", {sc['sugar']}"
                ok, reply = _sim(c, ph, text)
                turns, low = 0, (reply or "").lower()
                while ok and turns < 3 and ("what size" in low or "what milk" in low
                                            or "which milk" in low):
                    ans = sc["size"] if "size" in low else eff_milk
                    ok, reply = _sim(c, ph, ans)
                    low = (reply or "").lower()
                    turns += 1
                accepted = ok and ("confirmed" in low or "order #" in low
                                   or "being made" in low or "you're #" in low)
                mm = re.search(r"[Ss]tation\s+(\d+)", reply or "")
                landing = int(mm.group(1)) if mm else None
                order_no = None
                if accepted:
                    row = _find_pending(c, sid_tag)
                    if row:
                        order_no = (row.get("order_number") or row.get("orderNumber")
                                    or row.get("id"))
                        landing = landing or row.get("station_id") or row.get("stationId")

            # ---- oracle ---------------------------------------------------
            if expect_refusal:
                if accepted:
                    out.append(R("matrix", f"mx{i:02d} {label}", "fail",
                                 f"EXPECTED REFUSAL (no station offers {milk}) but the "
                                 f"order was ACCEPTED (#{order_no}, station {landing}) — "
                                 "the silent-strand #165 class.",
                                 refs=["services/coffee_system.py",
                                       "routes/consolidated_api_routes.py"]))
                    if order_no:
                        _cancel(c, order_no)
                    elif sc["channel"] == "sms":
                        _sim(c, ph, "CANCEL")
                else:
                    out.append(R("matrix", f"mx{i:02d} {label}", "pass",
                                 f"Correctly refused ({milk} unavailable)"))
                continue

            if not accepted:
                out.append(R("matrix", f"mx{i:02d} {label}", "fail",
                             "Expected ACCEPTANCE (all ingredients on the menu) but the "
                             "order did not confirm"
                             + (f" — last reply: {reply[:140]}" if sc["channel"] == "sms" else
                                f" — {st}"),
                             refs=["services/coffee_system.py",
                                   "routes/consolidated_api_routes.py"]))
                continue

            # E2: right place — visible in pending on a milk-capable station
            row = _find_pending(c, sid_tag)
            visible = row is not None
            order_no = order_no or (row and (row.get("order_number")
                                             or row.get("orderNumber") or row.get("id")))
            landing = landing or (row and (row.get("station_id") or row.get("stationId")))
            cap_ids = _capable_ids(active, eff_milk)
            placed_ok = visible and (landing in cap_ids if landing is not None and cap_ids
                                     else visible)
            # E3: reversible. SMS orders without a resolvable order_no are
            # cancelled in-conversation (the customer's own CANCEL path).
            if order_no:
                cancelled = _cancel(c, order_no)
            elif sc["channel"] == "sms":
                ok2, rep2 = _sim(c, ph, "CANCEL")
                cancelled = ok2 and "cancel" in (rep2 or "").lower()
            else:
                cancelled = False
            gone = cancelled and _find_pending(c, sid_tag) is None

            if placed_ok and gone:
                out.append(R("matrix", f"mx{i:02d} {label}", "pass",
                             f"accepted → station {landing} (capable: {cap_ids}) → "
                             "visible in queue → cancelled & gone"))
            else:
                problems = []
                if not visible:
                    problems.append("NOT visible in the pending queue")
                elif landing is not None and cap_ids and landing not in cap_ids:
                    problems.append(f"landed on station {landing} which can't make "
                                    f"{eff_milk} (capable: {cap_ids})")
                if not gone:
                    problems.append("cancel did not remove it from the queue")
                out.append(R("matrix", f"mx{i:02d} {label}", "fail",
                             "; ".join(problems) or "unexpected state",
                             suggestion="Reproduce with the same combination via the "
                                        "kiosk/simulate harness.",
                             refs=["services/coffee_system.py",
                                   "routes/consolidated_api_routes.py"]))
        except Exception as e:
            out.append(R("matrix", f"mx{i:02d} {label}", "fail",
                         f"Scenario crashed: {e}"))

    # ---- cleanup: sweep leftovers + restore stock ------------------------
    code, body, _ = c.get("/api/orders/pending")
    leftovers = [o.get("order_number") or o.get("orderNumber") or o.get("id")
                 for o in _order_list(body)
                 if str(o.get("customer_name") or o.get("customerName") or "")
                 .lower().startswith(f"{BENCH_TAG}Mx".lower())]
    for no in leftovers:
        if no is not None:
            _cancel(c, no)
    stock_after = _snapshot(_inventory(c) or [])
    restored = fail_restore = 0
    for k, (q0, item_id) in stock_before.items():
        q1 = stock_after.get(k, (None, None))[0]
        if q0 is not None and q1 is not None and q1 < q0 and item_id is not None:
            code, _, _ = c.post(f"/api/inventory/{item_id}/adjust",
                                {"new_amount": q0, "change_reason": "bench_restore",
                                 "notes": "Test Bench matrix restore"})
            restored += 1 if code == 200 else 0
            fail_restore += 0 if code == 200 else 1
    out.append(R("matrix", "cleanup: orders swept + stock restored",
                 "pass" if fail_restore == 0 else "fail",
                 f"{len(leftovers)} leftover order(s) cancelled, {restored} stock row(s) "
                 f"restored" + (f", {fail_restore} restore(s) FAILED" if fail_restore else ""),
                 suggestion="" if fail_restore == 0 else
                 "Fix counts manually in Organiser → Inventory."))
    return out


MATRIX_SUITES = [("matrix", suite_matrix, True)]
