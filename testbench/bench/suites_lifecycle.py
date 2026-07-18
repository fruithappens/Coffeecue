"""
Coffee Cue Test Bench — VIP + STATION LIFECYCLE (Phase B).

  vip       texting the VIP code activates VIP, and a VIP customer's order is
            prioritised — end to end via the simulate harness (no real SMS)
  station_lifecycle  create a station → it's active & routable → pause
            (maintenance) → it's excluded → reopen → delete → it's gone.
            OPT-IN (creates/deletes a real station; self-cleaning).

Fake phones virgin per run; ZZBench* orders + stations swept in cleanup.
"""
from __future__ import annotations

from .core import BENCH_TAG, result
from .suites import _menu, _order_list, _sim, _stations

R = result


def _sweep_orders(rn, prefix):
    c = rn.client
    code, body, _ = c.get("/api/orders/pending")
    for o in _order_list(body):
        nm = str(o.get("customer_name") or o.get("customerName") or "")
        if nm.lower().startswith(prefix.lower()):
            no = o.get("order_number") or o.get("orderNumber") or o.get("id")
            if no is not None:
                c.post(f"/api/orders/{no}/cancel")


# ---------------------------------------------------------------- VIP

def suite_vip(rn):
    """The VIP code activates VIP, and a VIP order is prioritised."""
    c, out = rn.client, []
    drinks, milks, _ = _menu(c)
    drink = "latte" if "latte" in drinks else (drinks[0] if drinks else "latte")
    milk = next((m for m in ("full cream", "skim") if m in milks), milks[0] if milks else "full cream")

    ph = rn.next_phone()
    ok, r1 = _sim(c, ph, "VIP")
    low1 = (r1 or "").lower()
    activated = ok and ("vip" in low1 and ("activ" in low1 or "priorit" in low1 or "free" in low1))
    out.append(R("vip", "VIP code activates VIP status", "pass" if activated else "fail",
                 r1[:150],
                 evidence="" if activated else r1[:300],
                 suggestion="" if activated else "Texting the VIP code should activate VIP.",
                 refs=[] if activated else ["services/coffee_system.py"]))
    if not activated:
        return out

    # Order after VIP — the flow routes through the NAME step, so send name+order.
    ok, r2 = _sim(c, ph, f"{BENCH_TAG}Vip large {drink} with {milk}")
    low2, turns = (r2 or "").lower(), 0
    while ok and turns < 3 and ("what size" in low2 or "what milk" in low2 or "first name" in low2):
        ans = ("large" if "size" in low2 else (milk if "milk" in low2 else f"{BENCH_TAG}Vip"))
        ok, r2 = _sim(c, ph, ans)
        low2 = (r2 or "").lower()
        turns += 1
    confirmed = "confirmed" in low2 or "order #" in low2 or "you're #" in low2
    out.append(R("vip", "VIP customer can place an order", "pass" if confirmed else "warn",
                 r2[:150], refs=[] if confirmed else ["services/coffee_system.py"]))

    # Is the resulting order actually flagged VIP / prioritised?
    if confirmed:
        code, body, _ = c.get("/api/orders/pending")
        mine = next((o for o in _order_list(body)
                     if str(o.get("customer_name") or o.get("customerName") or "")
                     .lower().startswith(f"{BENCH_TAG}Vip".lower())), None)
        vip_flag = False
        if mine:
            det = mine.get("order_details") or mine
            vip_flag = bool(mine.get("vip") or mine.get("is_vip")
                            or (isinstance(det, dict) and det.get("vip"))
                            or str(mine.get("queue_priority") or mine.get("queuePriority") or "") in ("1", "high"))
        out.append(R("vip", "VIP order is flagged / prioritised",
                     "pass" if vip_flag else "warn",
                     "order carries a VIP/priority flag" if vip_flag else
                     "order placed but no visible VIP/priority flag on the pending record",
                     evidence="" if vip_flag else str(mine)[:300] if mine else "order not found",
                     suggestion="" if vip_flag else "VIP customers' orders should jump the "
                                "queue — confirm queue_priority/vip is set on the order.",
                     refs=[] if vip_flag else ["services/coffee_system.py"]))
    _sweep_orders(rn, f"{BENCH_TAG}Vip")
    return out


# ---------------------------------------------------------------- station lifecycle

def suite_station_lifecycle(rn):
    """Create → active → pause → reopen → delete, verified at each step."""
    c, out = rn.client, []
    if not rn.options.get("allow_station_lifecycle"):
        return [R("station_lifecycle", "create→pause→reopen→delete", "skip",
                  "Opt-in (creates/deletes a real station) — enable 'station lifecycle' to run")]

    name = f"{BENCH_TAG} Temp Station"

    # sweep any leftover temp station from a prior aborted run
    for s in (_stations(c) or []):
        if str(s.get("name") or "").startswith(BENCH_TAG):
            c.req("DELETE", f"/api/stations/{s.get('id') or s.get('station_id')}")

    # 1. create
    code, body, _ = c.post("/api/stations", {
        "name": name, "status": "active",
        "capabilities": {"milk_types": ["full cream", "skim"],
                         "coffee_types": ["latte", "flat white"], "sizes": ["small", "medium"]},
    })
    sid = None
    if code in (200, 201) and isinstance(body, dict):
        st = body.get("station") or body.get("data") or body
        if isinstance(st, dict):
            sid = st.get("station_id") or st.get("id")
        sid = sid or body.get("station_id") or body.get("id")
    if not sid:
        return [R("station_lifecycle", "create a station", "fail",
                  f"POST /api/stations → HTTP {code}: {str(body)[:200]}",
                  refs=["routes/station_api_routes.py"])]
    out.append(R("station_lifecycle", "create a station", "pass", f"created station {sid}"))

    def status_of():
        for s in (_stations(c) or []):
            if (s.get("id") or s.get("station_id")) == sid:
                return (s.get("status") or "active")
        return None

    # 2. it's active
    out.append(R("station_lifecycle", "new station is active",
                 "pass" if status_of() == "active" else "fail",
                 f"status={status_of()}"))

    # 3. pause → maintenance
    pc, pb, _ = c.req("PATCH", f"/api/stations/{sid}/status", body={"status": "maintenance"})
    paused = status_of()
    out.append(R("station_lifecycle", "pause → maintenance",
                 "pass" if pc == 200 and paused == "maintenance" else "fail",
                 f"PATCH status→maintenance → HTTP {pc}, now status={paused}",
                 refs=[] if paused == "maintenance" else ["routes/station_api_routes.py"]))

    # 4. reopen → active
    rc, rb, _ = c.req("PATCH", f"/api/stations/{sid}/status", body={"status": "active"})
    reopened = status_of()
    out.append(R("station_lifecycle", "reopen → active",
                 "pass" if rc == 200 and reopened == "active" else "fail",
                 f"PATCH status→active → HTTP {rc}, now status={reopened}"))

    # 5. delete → gone
    dc, db_, _ = c.req("DELETE", f"/api/stations/{sid}")
    gone = not any((s.get("id") or s.get("station_id")) == sid for s in (_stations(c) or []))
    out.append(R("station_lifecycle", "delete → gone",
                 "pass" if gone else "fail",
                 f"DELETE → HTTP {dc}, gone={gone}",
                 evidence="" if gone else str(db_)[:200],
                 suggestion="" if gone else f"Temp station {sid} was not removed — delete it "
                            "manually in Organiser → Stations.",
                 refs=[] if gone else ["routes/station_api_routes.py"]))
    # final safety sweep
    for s in (_stations(c) or []):
        if str(s.get("name") or "").startswith(BENCH_TAG):
            c.req("DELETE", f"/api/stations/{s.get('id') or s.get('station_id')}")
    return out


def suite_lifecycle(rn):
    return suite_vip(rn) + suite_station_lifecycle(rn)


# ------------------------------------------------------- pickup + batch

def suite_order_extras(rn):
    """The last untested order transitions: batch-process (Barista UI's
    'Batch Process' button) and picked-up. Phoneless kiosk orders only —
    zero SMS risk. OPT-IN (orders transit real lifecycle states)."""
    from .suites_deep import _kiosk_order
    if not rn.options.get("allow_lifecycle"):
        return [R("order_extras", "batch + pickup transitions", "skip",
                  "Opt-in (runs real order transitions) — enable 'lifecycle'")]
    c, out = rn.client, []
    drinks, milks, sizes = _menu(c)
    drink = "latte" if "latte" in drinks else (drinks[0] if drinks else "latte")
    milk = next((m for m in ("full cream", "skim") if m in milks),
                milks[0] if milks else "full cream")

    n1, st1, _ = _kiosk_order(c, f"{BENCH_TAG}Bat1", drink, milk, "medium")
    n2, st2, _ = _kiosk_order(c, f"{BENCH_TAG}Bat2", drink, milk, "medium")
    if not (n1 and n2):
        return out + [R("order_extras", "batch: setup orders", "fail",
                        f"kiosk orders failed: {st1} / {st2}")]
    try:
        bc, bb, _ = c.post("/api/orders/batch/process", {"order_ids": [n1, n2]})
        results = (bb or {}).get("results") or (bb or {}).get("data") or []
        succ = sum(1 for r in results if isinstance(r, dict) and r.get("success"))
        batch_ok = bc == 200 and (succ == 2 or (bb or {}).get("success"))
        out.append(R("order_extras", "batch: two orders start together",
                     "pass" if batch_ok else "fail",
                     f"POST batch/process → HTTP {bc}, {succ or '?'}/2 succeeded",
                     evidence="" if batch_ok else str(bb)[:250],
                     refs=[] if batch_ok else ["routes/consolidated_api_routes.py"]))

        def _board():
            code, body, _ = c.get("/api/display/orders")
            wrap = (body or {}).get("orders") if isinstance(body, dict) else {}
            return wrap if isinstance(wrap, dict) else {}

        prog = {str(o.get("order_number") or o.get("orderNumber") or o.get("id"))
                for o in (_board().get("inProgress") or []) if isinstance(o, dict)}
        both_visible = str(n1) in prog and str(n2) in prog
        out.append(R("order_extras", "batch: both on the in-progress board",
                     "pass" if both_visible else "warn",
                     f"board in-progress has {sorted(prog)[:6]}"))

        cc, cb, _ = c.post(f"/api/orders/{n1}/complete", {"test_no_send": True})
        ready = {str(o.get("order_number") or o.get("orderNumber") or o.get("id"))
                 for o in (_board().get("ready") or []) if isinstance(o, dict)}
        on_ready = cc == 200 and str(n1) in ready
        out.append(R("order_extras", "pickup: completed order reaches the ready board",
                     "pass" if on_ready else "warn",
                     f"complete → HTTP {cc}; ready board has {sorted(ready)[:6]}"))

        pc, pb, _ = c.post(f"/api/orders/{n1}/pickup")
        ready2 = {str(o.get("order_number") or o.get("orderNumber") or o.get("id"))
                  for o in (_board().get("ready") or []) if isinstance(o, dict)}
        picked = pc == 200 and (isinstance(pb, dict) and pb.get("success") is not False) \
            and str(n1) not in ready2
        out.append(R("order_extras", "pickup: picked-up order leaves the ready board",
                     "pass" if picked else "fail",
                     f"pickup → HTTP {pc}; still on ready board: {str(n1) in ready2}",
                     evidence="" if picked else str(pb)[:200],
                     suggestion="" if picked else
                     "Picked-up orders lingering on the board confuse the "
                     "next customer looking for their name.",
                     refs=[] if picked else ["routes/consolidated_api_routes.py"]))
    finally:
        c.post(f"/api/orders/{n2}/cancel")
        c.post(f"/api/orders/{n1}/cancel")
        _sweep_orders(rn, f"{BENCH_TAG}Bat")
    return out


# ------------------------------------------------------- break windows

def suite_breaks(rn):
    """Break-window routing gets its first live guard (the #92 fix class):
    during a break where only ONE station is open, every order that station
    can make must land there. Creates a temporary break via the new
    /api/event-breaks CRUD and deletes it in finally. OPT-IN."""
    from .suites_deep import _kiosk_order
    if not rn.options.get("allow_breaks"):
        return [R("breaks", "break-window routing", "skip",
                  "Opt-in (creates + deletes a temporary event break) — "
                  "enable 'breaks'")]
    c, out = rn.client, []
    drinks, milks, _ = _menu(c)
    drink = "latte" if "latte" in drinks else (drinks[0] if drinks else "latte")
    milk = next((m for m in ("full cream", "skim") if m in milks),
                milks[0] if milks else "full cream")

    gc, gb, _ = c.get("/api/event-breaks")
    if gc != 200:
        return [R("breaks", "break-window routing", "warn",
                  f"/api/event-breaks not available (HTTP {gc}) — deploy pending?")]

    stations = _stations(c) or []
    mnorm = milk.replace(" milk", "").lower()
    capable = []
    for s in stations:
        if (s.get("status") or "active") != "active":
            continue
        mt = [str(x).lower().replace(" milk", "")
              for x in ((s.get("capabilities") or {}).get("milk_types") or [])]
        if not mt or mnorm in mt:
            capable.append(s.get("id") or s.get("station_id"))
    if len(capable) < 2:
        return [R("breaks", "break-window routing", "skip",
                  f"needs 2+ active stations capable of {milk} to prove the "
                  f"break forces routing (have {capable})")]
    open_station = capable[-1]  # not the load-balancer's usual first pick

    # Server-local time from a probe order's createdAt (the server may not
    # share the operator's timezone; the break gate uses SERVER now()).
    pn, _pst, _ = _kiosk_order(c, f"{BENCH_TAG}BrkProbe", drink, milk, "medium")
    server_now = None
    code, body, _ = c.get("/api/orders/pending")
    for o in _order_list(body):
        if str(o.get("order_number") or "") == str(pn):
            raw = str(o.get("createdAt") or o.get("created_at") or "")
            try:
                from datetime import datetime as _dt
                server_now = _dt.fromisoformat(raw.replace("Z", "").split(".")[0])
            except Exception:
                server_now = None
    if pn:
        c.post(f"/api/orders/{pn}/cancel")
    if server_now is None:
        return out + [R("breaks", "break-window routing", "warn",
                        "couldn't read server time from a probe order")]

    from datetime import timedelta as _td
    start = (server_now - _td(minutes=10)).strftime("%H:%M")
    end = (server_now + _td(minutes=20)).strftime("%H:%M")
    dow = server_now.weekday()
    bid = None
    try:
        pc, pb, _ = c.post("/api/event-breaks",
                           {"title": f"{BENCH_TAG}Break", "day_of_week": dow,
                            "start_time": start, "end_time": end,
                            "stations": [open_station]})
        bid = (pb or {}).get("id")
        out.append(R("breaks", "create a temporary break",
                     "pass" if pc == 200 and bid else "fail",
                     f"break {start}-{end} dow={dow}, only station {open_station} open "
                     f"→ HTTP {pc} id={bid}",
                     refs=[] if bid else ["routes/consolidated_api_routes.py"]))
        if bid:
            landings = []
            nums = []
            for i in range(3):
                no, st, _ = _kiosk_order(c, f"{BENCH_TAG}Brk{i}", drink, milk, "medium")
                if no:
                    nums.append(no)
                    landings.append(st)
            forced = len(landings) == 3 and all(str(s) == str(open_station)
                                                for s in landings)
            out.append(R("breaks", "during the break, orders go to the open station",
                         "pass" if forced else "fail",
                         f"3 {milk} orders landed on stations {landings} "
                         f"(only {open_station} is open; capable: {capable})",
                         suggestion="" if forced else
                         "Break windows aren't constraining routing — orders "
                         "go to closed stations where nobody is working.",
                         refs=[] if forced else ["services/coffee_system.py"]))
            for no in nums:
                c.post(f"/api/orders/{no}/cancel")
    finally:
        if bid:
            dc, _db2, _ = c.req("DELETE", f"/api/event-breaks/{bid}")
            out.append(R("breaks", "cleanup: temporary break deleted",
                         "pass" if dc == 200 else "fail",
                         f"DELETE break {bid} → HTTP {dc}",
                         suggestion="" if dc == 200 else
                         f"IMPORTANT: delete break id {bid} ('{BENCH_TAG}Break') "
                         "by hand or routing stays constrained."))
        _sweep_orders(rn, f"{BENCH_TAG}Brk")
    return out


LIFECYCLE_SUITES = [
    ("lifecycle", suite_lifecycle, True),
    ("order_extras", suite_order_extras, True),
    ("breaks", suite_breaks, True),
]
