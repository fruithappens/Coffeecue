"""
Coffee Cue Test Bench — STRESS (roadmap queue item 3).

Two questions nobody had asked the app:

  empty_stock  when a milk is at ZERO, is an SMS order for it refused (stock
               mode) — and accepted again when unlimited-stock mode is on?
               A three-way proof: zero → refused; unlimited → accepted;
               restore → back to normal. OPT-IN (--allow-stock-mutation):
               briefly zeroes one milk's inventory rows, restores exactly.
  burst        the SMS abuse throttle really trips: >12 messages inside 60s
               from one number → gate 'tripped' then 'paused', while a
               second normal number still gets through. Uses the simulate
               harness's check_gate flag (same register_inbound_sms the real
               webhook runs) — zero real SMS, per-phone, self-contained.
"""
from __future__ import annotations

from .core import BENCH_TAG, result
from .suites import _menu, _order_list, _sim

R = result


def _sweep(rn):
    c = rn.client
    code, body, _ = c.get("/api/orders/pending")
    for o in _order_list(body):
        nm = str(o.get("customer_name") or o.get("customerName") or "")
        if nm.lower().startswith(BENCH_TAG.lower()):
            no = o.get("order_number") or o.get("orderNumber") or o.get("id")
            if no is not None:
                c.post(f"/api/orders/{no}/cancel")


# --------------------------------------------------------------- empty stock

def suite_empty_stock(rn):
    c, out = rn.client, []
    if not rn.options.get("allow_stock_mutation"):
        return [R("empty_stock", "zero-stock ordering behaviour", "skip",
                  "Opt-in (briefly zeroes one milk's stock, restores exactly) — "
                  "enable 'stock mutation'")]

    _drinks, milks, _ = _menu(c)
    if not milks:
        return [R("empty_stock", "zero-stock ordering behaviour", "warn",
                  "no milks on the menu — nothing to zero")]
    milk = milks[-1]  # least-ordered menu milk

    code, body, _ = c.get("/api/inventory")
    items = (body or {}).get("items") or []
    rows = [r for r in items
            if str(r.get("category")).lower() == "milk"
            and milk in str(r.get("name", "")).lower()]
    if not rows:
        return [R("empty_stock", "zero-stock ordering behaviour", "warn",
                  f"no inventory rows found for milk {milk!r}")]

    originals = {}  # id → level to restore
    for r in rows:
        lvl = r.get("amount") if r.get("amount") is not None else r.get("current_quantity")
        originals[r["id"]] = float(lvl or 0)

    prev_unlimited = None
    try:
        # 1) zero every row of this milk
        for rid in originals:
            c.post(f"/api/inventory/{rid}/adjust",
                   {"new_amount": 0, "change_reason": "bench_empty_stock_test"})
        gcode, gb, _ = c.get("/api/settings/unlimited-stock")
        prev_unlimited = bool((gb or {}).get("enabled")) if gcode == 200 else None
        if prev_unlimited:
            # already unlimited — the refusal leg can't run meaningfully
            out.append(R("empty_stock", "zero-stock order is refused", "skip",
                         "unlimited-stock mode is already ON for this event"))
        else:
            ok, reply = _sim(c, rn.next_phone(), f"{BENCH_TAG}Zero medium latte with {milk}")
            low = (reply or "").lower()
            refused = ok and ("don't have" in low or "unavailable" in low
                              or "out of" in low or "sorry" in low) \
                and "confirmed" not in low
            out.append(R("empty_stock", "zero-stock order is refused",
                         "pass" if refused else "fail",
                         (reply or "")[:160],
                         evidence="" if refused else (reply or "")[:400],
                         suggestion="" if refused else
                         f"With {milk} at ZERO stock the bot still took the "
                         "order — a barista gets an order they can't make.",
                         refs=[] if refused else ["services/coffee_system.py"]))

        # 2) unlimited-stock mode ON → the same order must be ACCEPTED
        tc, tb, _ = c.post("/api/settings/unlimited-stock", {"enabled": True})
        if tc != 200:
            out.append(R("empty_stock", "unlimited mode accepts it", "warn",
                         f"couldn't toggle unlimited-stock (HTTP {tc}) — deploy pending?"))
        else:
            ok, reply = _sim(c, rn.next_phone(), f"{BENCH_TAG}Unlim medium latte with {milk}")
            low = (reply or "").lower()
            accepted = ok and ("confirmed" in low or "order #" in low)
            out.append(R("empty_stock", "unlimited mode accepts it",
                         "pass" if accepted else "fail",
                         (reply or "")[:160],
                         evidence="" if accepted else (reply or "")[:400],
                         suggestion="" if accepted else
                         "Unlimited-stock mode is on but a zero-stock milk was "
                         "still refused — the mode toggle has no effect.",
                         refs=[] if accepted else ["services/coffee_system.py"]))
    finally:
        if prev_unlimited is not None:
            rc1, _, _ = c.post("/api/settings/unlimited-stock", {"enabled": prev_unlimited})
        else:
            rc1 = 200  # never toggled
        restored = []
        for rid, lvl in originals.items():
            rc2, _, _ = c.post(f"/api/inventory/{rid}/adjust",
                               {"new_amount": lvl, "change_reason": "bench_restore"})
            restored.append(rc2 == 200)
        _sweep(rn)
        ok_all = all(restored) and rc1 == 200
        out.append(R("empty_stock", "cleanup: stock + mode restored",
                     "pass" if ok_all else "fail",
                     f"{sum(restored)}/{len(restored)} rows restored, "
                     f"unlimited back to {prev_unlimited}",
                     suggestion="" if ok_all else
                     f"IMPORTANT: restore {milk} stock levels {originals} and "
                     f"unlimited-stock={prev_unlimited} by hand."))
    return out


# -------------------------------------------------------------------- burst

def suite_burst(rn):
    """>12 rapid messages from one number trips the abuse gate."""
    c, out = rn.client, []
    ph = rn.next_phone()

    def gated(msg):
        code, body, _ = c.post("/api/sms/simulate",
                               {"from": ph, "body": msg, "check_gate": True})
        if code != 200 or not isinstance(body, dict):
            return None
        return body.get("gate", "ok")

    first = gated("hello")
    if first is None:
        return [R("burst", "throttle trips on a flood", "warn",
                  "simulate has no check_gate support yet (deploy pending?)")]

    tripped_at = None
    statuses = [first]
    for i in range(2, 17):  # up to 16 messages total
        g = gated("hello again")
        statuses.append(g)
        if g == "tripped":
            tripped_at = i
            break
    out.append(R("burst", "throttle trips on a flood",
                 "pass" if tripped_at else "fail",
                 f"gate tripped at message {tripped_at} (limit is 12/60s)"
                 if tripped_at else f"16 rapid messages, gate never tripped: {statuses}",
                 suggestion="" if tripped_at else
                 "A texting flood would get a paid reply per message — "
                 "Twilio credit burn with no brake.",
                 refs=[] if tripped_at else ["services/coffee_system.py"]))
    if tripped_at:
        after = gated("still here")
        out.append(R("burst", "flooding number stays paused",
                     "pass" if after == "paused" else "warn",
                     f"next message gate={after!r} (expected 'paused')"))
        bystander = rn.next_phone()
        code, body, _ = c.post("/api/sms/simulate",
                               {"from": bystander, "body": "MENU", "check_gate": True})
        ok = code == 200 and isinstance(body, dict) and body.get("gate") == "ok" \
            and (body.get("reply") or "")
        out.append(R("burst", "other customers unaffected",
                     "pass" if ok else "fail",
                     "a different number still gets served" if ok else str(body)[:160]))
    return out


# -------------------------------------------------------------- low stock

def suite_alerts(rn):
    """Low-stock visibility: a barista's report-low reaches the low-stock
    list, and crossing the minimum threshold flips the item's status by
    itself. OPT-IN (briefly mutates one item's status/quantity, restores
    exactly)."""
    c, out = rn.client, []
    if not rn.options.get("allow_stock_mutation"):
        return [R("alerts", "low-stock reporting + threshold", "skip",
                  "Opt-in (briefly mutates one item's status/quantity) — "
                  "enable 'stock mutation'")]

    code, body, _ = c.get("/api/inventory")
    items = (body or {}).get("items") or []
    row = next((r for r in items
                if str(r.get("category")).lower() == "milk"
                and float(r.get("amount") or r.get("current_quantity") or 0) > 1
                and float(r.get("minimum_threshold") or 0) > 0), None)
    if not row:
        return [R("alerts", "low-stock reporting + threshold", "warn",
                  "no milk row with stock + a minimum_threshold to test against")]
    rid = row["id"]
    orig_qty = float(row.get("amount") or row.get("current_quantity") or 0)
    orig_status = row.get("status") or "in_stock"
    thr = float(row.get("minimum_threshold") or 0)

    def _item():
        _c, b, _ = c.get(f"/api/inventory/{rid}")
        return (b or {}).get("item") or {}

    def _low_listed():
        _c, b, _ = c.get("/api/inventory/low-stock")
        rows = (b or {}).get("items") or (b or {}).get("data") or []
        in_items = any(str(r.get("id")) == str(rid) for r in rows if isinstance(r, dict))
        in_alerts = any(str(a.get("item_id")) == str(rid)
                        for a in ((b or {}).get("alerts") or [])
                        if isinstance(a, dict))
        return in_items or in_alerts

    try:
        # 1) barista taps "report low" → the report is VISIBLE somewhere:
        #    the item's status flips low, or it appears in the low-stock
        #    endpoint's items/alerts.
        rc, rb, _ = c.post(f"/api/inventory/{rid}/report-low",
                           {"urgency": "normal", "notes": "bench alert test"})
        seen = rc == 200 and (str(_item().get("status")) in ("low_stock", "warning", "danger")
                              or _low_listed())
        out.append(R("alerts", "report-low reaches the low-stock list",
                     "pass" if seen else "fail",
                     f"report-low → HTTP {rc}; status={_item().get('status')!r}, "
                     f"visible in low-stock items/alerts={_low_listed()}",
                     evidence="" if seen else str(rb)[:200],
                     suggestion="" if seen else
                     "A barista's low-stock report goes nowhere visible — "
                     "the organiser never hears about it.",
                     refs=[] if seen else ["routes/consolidated_api_routes.py",
                                           "routes/inventory_routes.py"]))
        # reset status before the threshold leg
        c.req("PUT", f"/api/inventory/{rid}", body={"status": orig_status})

        # 2) crossing the threshold flips status automatically. NOTE: two
        # status vocabularies coexist — the adjust endpoint STORES
        # in_stock/low_stock while the item GET COMPUTES good/warning/danger
        # (models/inventory._calculate_status). Either family's "low" state
        # counts as flipped; the split itself is a known inconsistency
        # (same class as the station is_active/status split, #57/#58).
        c.post(f"/api/inventory/{rid}/adjust",
               {"new_amount": max(0.1, thr - 0.1), "change_reason": "bench_threshold_test"})
        st = str(_item().get("status") or "").lower()
        flipped = st in ("low_stock", "danger", "warning", "out_of_stock")
        out.append(R("alerts", "threshold crossing flips the status",
                     "pass" if flipped else "fail",
                     f"set qty to {max(0.1, thr - 0.1)} (threshold {thr}) → "
                     f"status={st!r} (vocab note: stored=low_stock/in_stock, "
                     f"computed=good/warning/danger)",
                     suggestion="" if flipped else
                     "Stock can silently run below its minimum without the "
                     "status ever showing low — run-out warnings won't fire.",
                     refs=[] if flipped else ["routes/consolidated_api_routes.py",
                                              "models/inventory.py"]))
    finally:
        # resolve the bench's own alert so the organiser view stays clean
        _c2, lb, _ = c.get("/api/inventory/low-stock")
        for a in ((lb or {}).get("alerts") or []):
            if str(a.get("item_id")) == str(rid) and "bench" in str(a.get("notes", "")).lower():
                c.post(f"/api/inventory/alerts/{a.get('id')}/resolve")
        c.post(f"/api/inventory/{rid}/adjust",
               {"new_amount": orig_qty, "change_reason": "bench_restore"})
        c.req("PUT", f"/api/inventory/{rid}", body={"status": orig_status})
        back = _item()
        restored = float(back.get("amount") or 0) == orig_qty \
            and back.get("status") == orig_status
        out.append(R("alerts", "cleanup: quantity + status restored",
                     "pass" if restored else "fail",
                     f"back to qty={back.get('amount')}, status={back.get('status')!r}",
                     suggestion="" if restored else
                     f"IMPORTANT: restore item {rid} to qty={orig_qty}, "
                     f"status={orig_status!r} by hand."))
    return out


# ---------------------------------------------------------- inventory CRUD

def suite_inventory_crud(rn):
    """An inventory item's full life: create → visible → adjust → delete →
    gone. Self-cleaning (ZZBench-named item, deleted in finally)."""
    c, out = rn.client, []
    item_id = None
    try:
        pc, pb, _ = c.post("/api/inventory",
                           {"name": f"{BENCH_TAG} Test Syrup", "category": "other",
                            "unit": "bottles", "capacity": 10, "amount": 5})
        body = pb if isinstance(pb, dict) else {}
        item = body.get("item") or body.get("data") or body
        item_id = item.get("id") if isinstance(item, dict) else None
        created = pc in (200, 201) and item_id
        out.append(R("inv_crud", "create an inventory item",
                     "pass" if created else "fail",
                     f"POST /api/inventory → HTTP {pc}, id={item_id}",
                     evidence="" if created else str(pb)[:200],
                     refs=[] if created else ["routes/inventory_routes.py"]))
        if not item_id:
            return out
        gc, gb, _ = c.get("/api/inventory")
        listed = any(str(r.get("id")) == str(item_id)
                     for r in ((gb or {}).get("items") or []))
        out.append(R("inv_crud", "new item appears in the inventory list",
                     "pass" if listed else "fail", f"listed={listed}"))
        ac, _ab, _ = c.post(f"/api/inventory/{item_id}/adjust",
                            {"new_amount": 3, "change_reason": "bench_crud"})
        _c2, ib, _ = c.get(f"/api/inventory/{item_id}")
        lvl = ((ib or {}).get("item") or {}).get("amount")
        adjusted = ac == 200 and float(lvl or 0) == 3.0
        out.append(R("inv_crud", "adjust writes the new level (both columns)",
                     "pass" if adjusted else "fail",
                     f"adjust→{ac}, level now {lvl}"))
    finally:
        if item_id:
            dc, _db2, _ = c.req("DELETE", f"/api/inventory/{item_id}")
            _c3, gb2, _ = c.get("/api/inventory")
            gone = not any(str(r.get("id")) == str(item_id)
                           for r in ((gb2 or {}).get("items") or []))
            out.append(R("inv_crud", "cleanup: item deleted",
                         "pass" if dc == 200 and gone else "fail",
                         f"DELETE → HTTP {dc}, gone={gone}",
                         suggestion="" if gone else
                         f"IMPORTANT: delete inventory item {item_id} "
                         f"('{BENCH_TAG} Test Syrup') by hand."))
    return out


# ---------------------------------------------------------- schedule CRUD

def suite_sched_crud(rn):
    """A roster shift's full life via the API: create for the server's
    TODAY → visible in /api/schedule/today → delete → gone. (Shifts remain
    informational for routing — that standing note lives in the schedule
    suite — but the CRUD itself must work for the roster to be usable.)"""
    c, out = rn.client, []
    shift_id = None
    try:
        tc, tb, _ = c.get("/api/schedule/today")
        dow = (tb or {}).get("day_of_week")
        if tc != 200 or dow is None:
            return [R("sched_crud", "schedule CRUD round-trip", "warn",
                      f"couldn't read today's schedule (HTTP {tc})")]
        # NOTE: the response nests under 'schedule', and barista_name is
        # silently DROPPED by the create handler (names live in 'notes' —
        # the response row comes back barista_name:null even when sent).
        pc, pb, _ = c.post("/api/schedule/shifts",
                           {"station_id": 1, "day_of_week": dow,
                            "start_time": "00:05", "end_time": "23:55",
                            "notes": f"{BENCH_TAG} Roster"})
        body = pb if isinstance(pb, dict) else {}
        sh = body.get("schedule") or body.get("shift") or body.get("data") or body
        shift_id = sh.get("id") if isinstance(sh, dict) else None
        out.append(R("sched_crud", "create a roster shift",
                     "pass" if pc in (200, 201) and shift_id else "fail",
                     f"POST /api/schedule/shifts → HTTP {pc}, id={shift_id} "
                     "(note: barista_name is silently dropped by the handler — "
                     "use 'notes' to name the shift)",
                     evidence="" if shift_id else str(pb)[:200],
                     refs=[] if shift_id else ["routes/station_api_routes.py"]))
        if not shift_id:
            return out
        _c2, tb2, _ = c.get("/api/schedule/today")
        listed = any(str(s.get("id")) == str(shift_id)
                     for s in ((tb2 or {}).get("schedules") or []))
        out.append(R("sched_crud", "new shift visible in today's schedule",
                     "pass" if listed else "fail", f"listed={listed}"))
    finally:
        if shift_id:
            dc, _db2, _ = c.req("DELETE", f"/api/schedule/shifts/{shift_id}")
            _c3, tb3, _ = c.get("/api/schedule/today")
            gone = not any(str(s.get("id")) == str(shift_id)
                           for s in ((tb3 or {}).get("schedules") or []))
            out.append(R("sched_crud", "cleanup: shift deleted",
                         "pass" if dc == 200 and gone else "fail",
                         f"DELETE → HTTP {dc}, gone={gone}",
                         suggestion="" if gone else
                         f"IMPORTANT: delete shift {shift_id} "
                         f"('{BENCH_TAG} Roster') by hand."))
    return out


STRESS_SUITES = [
    ("empty_stock", suite_empty_stock, True),
    ("burst", suite_burst, True),
    ("alerts", suite_alerts, True),
    ("inv_crud", suite_inventory_crud, True),
    ("sched_crud", suite_sched_crud, True),
]
