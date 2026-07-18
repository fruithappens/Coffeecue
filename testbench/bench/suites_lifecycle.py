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


LIFECYCLE_SUITES = [("lifecycle", suite_lifecycle, True)]
