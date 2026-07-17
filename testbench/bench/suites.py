"""
Coffee Cue Test Bench — the suites.

Each suite is a function (runner) -> list[result] exercising one slice of the
app. Suites marked needs_auth are skipped when the bench has no login. All
mutating checks are self-cleaning (orders cancelled) or opt-in via options:
  allow_lifecycle — run a full start→complete order lifecycle (phoneless, but
                    the completed order stays in today's stats, tagged ZZBench)
  allow_blocklist — exercise block/unblock with a fake number
"""
from __future__ import annotations

from .core import BENCH_TAG, Timer, result

R = result  # short alias


# ---------------------------------------------------------------- helpers

def _names(items):
    """Menu lists may be strings or dicts ({name}/{value}) — normalise."""
    out = []
    for it in items or []:
        if isinstance(it, str):
            out.append(it)
        elif isinstance(it, dict):
            out.append(str(it.get("value") or it.get("name") or it.get("id") or ""))
    return [x for x in out if x]


def _menu(client):
    """Fetch the public kiosk/SMS menu → (drinks, milks, sizes) lowercased."""
    code, body, _ = client.get("/api/display/menu", auth=False)
    if code != 200 or not isinstance(body, dict):
        return [], [], []
    menu = body.get("menu") or body
    return (
        [d.lower() for d in _names(menu.get("coffee_types"))],
        [m.lower() for m in _names(menu.get("milks"))],
        [s.lower() for s in _names(menu.get("sizes"))],
    )


def _stations(client):
    code, body, _ = client.get("/api/stations")
    if code != 200 or not isinstance(body, dict):
        return None
    return body.get("stations") or body.get("data") or []


def _order_list(body):
    if isinstance(body, list):
        return body
    if isinstance(body, dict):
        for k in ("orders", "data", "pending", "items"):
            if isinstance(body.get(k), list):
                return body[k]
    return []


def _sim(client, phone, text):
    """One /api/sms/simulate turn → (ok, reply_text)."""
    code, body, _ = client.post("/api/sms/simulate", {"from": phone, "body": text})
    if code != 200 or not isinstance(body, dict) or not body.get("success"):
        return False, f"HTTP {code}: {body}"
    return True, str(body.get("reply") or "")


# ---------------------------------------------------------------- suites

def suite_health(rn):
    """Reachability, response times, and the auth gate."""
    c, out = rn.client, []

    code, body, ms = c.get("/api/display/config", auth=False)
    if code == 200 and isinstance(body, dict):
        st = "warn" if ms > 3000 else "pass"
        out.append(R("health", "display config reachable", st,
                     f"HTTP 200 in {ms}ms" + (" (slow — cold start?)" if ms > 3000 else ""),
                     ms=ms))
    else:
        out.append(R("health", "display config reachable", "fail",
                     f"GET /api/display/config → HTTP {code}", evidence=str(body)[:300],
                     suggestion="The public display config endpoint is down — the Display "
                                "screen and kiosk depend on it.",
                     refs=["routes/consolidated_api_routes.py"], ms=ms))

    code, _, ms = c.req("GET", "/", auth=False)
    out.append(R("health", "frontend served", "pass" if code == 200 else "fail",
                 f"GET / → HTTP {code} in {ms}ms", ms=ms))

    # Security gate: /api/stations must NOT be readable without a token.
    code, body, ms = c.get("/api/stations", auth=False)
    if code in (401, 403, 422):
        out.append(R("health", "auth gate on stations API", "pass",
                     f"Unauthenticated GET /api/stations correctly rejected (HTTP {code})", ms=ms))
    elif code == 200:
        out.append(R("health", "auth gate on stations API", "fail",
                     "GET /api/stations returned 200 WITHOUT a token — the API is "
                     "exposing operational data publicly.",
                     evidence=str(body)[:300],
                     suggestion="Check the jwt_required decorator on the stations routes.",
                     refs=["routes/station_api_routes.py"], ms=ms))
    else:
        out.append(R("health", "auth gate on stations API", "warn",
                     f"Unexpected status {code} for unauthenticated stations call", ms=ms))
    return out


def suite_auth(rn):
    """Login worked (runner already logged in) + token actually authorises."""
    c, out = rn.client, []
    code, body, ms = c.get("/api/stations")
    if code == 200:
        n = len(_stations(c) or [])
        out.append(R("auth", "token authorises API", "pass",
                     f"GET /api/stations with token → 200 ({n} stations)", ms=ms))
    else:
        out.append(R("auth", "token authorises API", "fail",
                     f"Token accepted at login but GET /api/stations → HTTP {code}",
                     evidence=str(body)[:300],
                     refs=["routes/auth_routes.py", "auth.py"], ms=ms))
    return out


def suite_stations(rn):
    """Station list sanity: status values, queue counts, wait estimates."""
    c, out = rn.client, []
    stations = _stations(c)
    if stations is None:
        return [R("stations", "list", "fail", "GET /api/stations failed",
                  refs=["routes/station_api_routes.py"])]
    if not stations:
        return [R("stations", "list", "fail", "No stations configured at all",
                  suggestion="Create stations in the Organiser before an event.")]

    active = [s for s in stations if (s.get("status") or "active") == "active"]
    out.append(R("stations", "at least one active", "pass" if active else "fail",
                 f"{len(active)} of {len(stations)} stations active",
                 suggestion="" if active else "No active stations — every order path "
                            "(SMS/kiosk/walk-in) will refuse or misroute.",
                 refs=[] if active else ["routes/station_api_routes.py"]))

    bad_status = [s for s in stations
                  if (s.get("status") or "active") not in ("active", "inactive", "maintenance")]
    out.append(R("stations", "status values canonical",
                 "pass" if not bad_status else "fail",
                 "All station.status in active/inactive/maintenance" if not bad_status
                 else f"Unexpected status values: {[(s.get('id'), s.get('status')) for s in bad_status]}",
                 suggestion="" if not bad_status else "station_stats.status is the canonical "
                            "field; something wrote a non-canonical value.",
                 refs=[] if not bad_status else ["routes/station_api_routes.py"]))

    for s in stations:
        sid = s.get("id") or s.get("station_id")
        q = s.get("queue_count", s.get("queueCount"))
        w = s.get("estimated_wait", s.get("estimatedWait"))
        if q is not None and (not isinstance(q, (int, float)) or q < 0):
            out.append(R("stations", f"queue count station {sid}", "fail",
                         f"queue_count is {q!r}",
                         refs=["routes/station_api_routes.py"]))
        if w is not None and isinstance(w, (int, float)) and (w < 0 or w > 240):
            out.append(R("stations", f"wait estimate station {sid}", "fail",
                         f"estimated_wait is {w} min — outside sane range 0–240. "
                         "This is the 'bogus 4320-minute wait' bug class.",
                         suggestion="Check _estimate_wait_from_queue / stale-order filtering "
                                    "in the wait model.",
                         refs=["services/coffee_system.py"]))
    if len(out) == 2:
        out.append(R("stations", "queue + wait sanity", "pass",
                     f"All {len(stations)} stations have sane queue counts and wait estimates"))
    return out


def suite_display(rn):
    """Public display/kiosk surface + menu-vs-capability consistency."""
    c, out = rn.client, []

    code, body, ms = c.get("/api/display/config", auth=False)
    if code == 200 and isinstance(body, dict):
        cfg = body.get("config") or body
        missing = [k for k in ("event_name", "sms_number") if not cfg.get(k)]
        out.append(R("display", "config fields", "pass" if not missing else "warn",
                     "event_name + sms_number present" if not missing
                     else f"Missing/empty: {missing} — the display will show defaults",
                     refs=[] if not missing else ["routes/consolidated_api_routes.py"], ms=ms))
    else:
        out.append(R("display", "config fields", "fail", f"HTTP {code}", ms=ms))

    drinks, milks, sizes = _menu(c)
    if drinks and milks:
        out.append(R("display", "menu populated", "pass",
                     f"{len(drinks)} drinks, {len(milks)} milks, {len(sizes)} sizes"))
    else:
        out.append(R("display", "menu populated", "fail",
                     f"Menu incomplete: drinks={len(drinks)}, milks={len(milks)} — kiosk "
                     "and SMS ordering can't offer a full menu",
                     suggestion="Check event inventory is enabled and _kiosk_menu_data.",
                     refs=["routes/consolidated_api_routes.py"]))

    code, body, ms = c.get("/api/display/orders", auth=False)
    out.append(R("display", "orders board endpoint", "pass" if code == 200 else "fail",
                 f"GET /api/display/orders → HTTP {code}", ms=ms))

    # THE #165 CLASS: every milk offered on the menu must be makeable by at
    # least one ACTIVE station (empty capability list = wildcard station).
    if rn.client.token and milks:
        stations = _stations(c) or []
        active = [s for s in stations if (s.get("status") or "active") == "active"]
        orphan = []
        for milk in milks:
            ok = False
            for s in active:
                caps = s.get("capabilities") or {}
                mt = [str(x).lower().replace(" milk", "") for x in (caps.get("milk_types") or [])]
                if not mt or milk.replace(" milk", "") in mt:
                    ok = True
                    break
            if not ok:
                orphan.append(milk)
        out.append(R("display", "every menu milk has a capable active station",
                     "pass" if not orphan else "fail",
                     "Menu and station capabilities agree" if not orphan
                     else f"Offered on the menu but NO active station lists it: {orphan}. "
                          "Orders for these will be refused or strand (the oat/#165 bug class).",
                     suggestion="" if not orphan else "Either enable the milk on a station's "
                                "capabilities or disable it at event level.",
                     refs=[] if not orphan else ["services/coffee_system.py",
                                                 "routes/consolidated_api_routes.py"]))
    return out


def suite_orders(rn):
    """Order pipeline: kiosk create → visible in queue → cancel.
    Opt-in: full lifecycle start→complete (phoneless, so no SMS)."""
    c, out = rn.client, []
    drinks, milks, sizes = _menu(c)
    drink = next((d for d in ("latte", "flat white", "cappuccino") if d in drinks),
                 drinks[0] if drinks else "latte")
    milk = next((m for m in ("full cream", "skim") if m in milks),
                milks[0] if milks else "full cream")
    size = "medium" if "medium" in sizes else (sizes[0] if sizes else "medium")

    def cancel(order_no, label):
        code, body, _ = c.post(f"/api/orders/{order_no}/cancel")
        ok = code == 200 and (not isinstance(body, dict) or body.get("success") is not False)
        out.append(R("orders", f"cleanup: cancel {label}", "pass" if ok else "fail",
                     f"Cancel {order_no} → HTTP {code}",
                     suggestion="" if ok else f"Bench order {order_no} was left behind — "
                                "cancel it manually in the barista screen.",
                     refs=[] if ok else ["routes/consolidated_api_routes.py"]))
        return ok

    # 1. create (public kiosk endpoint, phoneless — no SMS possible)
    code, body, ms = c.post("/api/display/order", {
        "name": f"{BENCH_TAG} Kiosk", "coffee_type": drink, "milk": milk,
        "size": size, "sugar": "No sugar", "phone": "",
    }, auth=False)
    order_no = None
    if code == 200 and isinstance(body, dict) and body.get("success"):
        order_no = (body.get("order_number") or (body.get("data") or {}).get("order_number")
                    or body.get("id"))
        st = body.get("station_id") or (body.get("data") or {}).get("station_id")
        out.append(R("orders", "kiosk order created (no phone)", "pass",
                     f"Order {order_no} → station {st} ({drink}/{milk}/{size})", ms=ms))
    else:
        out.append(R("orders", "kiosk order created (no phone)", "fail",
                     f"POST /api/display/order → HTTP {code}",
                     evidence=str(body)[:400],
                     suggestion="Kiosk ordering is broken — customers at the touchscreen "
                                "can't order.",
                     refs=["routes/consolidated_api_routes.py"], ms=ms))
        return out

    # 2. shows up in the pending queue
    code, body, ms = c.get("/api/orders/pending")
    pend = _order_list(body)
    found = any(str(o.get("order_number") or o.get("orderNumber") or o.get("id")) == str(order_no)
                for o in pend)
    out.append(R("orders", "appears in pending queue", "pass" if found else "fail",
                 f"Order {order_no} {'found' if found else 'NOT found'} in pending "
                 f"({len(pend)} pending)",
                 suggestion="" if found else "A created order that never reaches the barista "
                            "queue is a P1 — check station assignment + pending query.",
                 refs=[] if found else ["routes/consolidated_api_routes.py"], ms=ms))

    # 3. optional full lifecycle on a second order
    if rn.options.get("allow_lifecycle"):
        code, body, _ = c.post("/api/display/order", {
            "name": f"{BENCH_TAG} Lifecycle", "coffee_type": drink, "milk": milk,
            "size": size, "sugar": "No sugar", "phone": "",
        }, auth=False)
        no2 = (body.get("order_number") if isinstance(body, dict) else None) or \
              ((body.get("data") or {}).get("order_number") if isinstance(body, dict) else None)
        if code == 200 and no2:
            c1, b1, _ = c.post(f"/api/orders/{no2}/start")
            c2, b2, _ = c.post(f"/api/orders/{no2}/complete")
            ok = c1 == 200 and c2 == 200
            out.append(R("orders", "lifecycle start→complete", "pass" if ok else "fail",
                         f"start → {c1}, complete → {c2} (order {no2}, phoneless so no SMS). "
                         f"NOTE: stays in today's stats tagged {BENCH_TAG}.",
                         evidence="" if ok else f"start: {b1} | complete: {b2}"[:400],
                         refs=[] if ok else ["routes/consolidated_api_routes.py"]))
        else:
            out.append(R("orders", "lifecycle start→complete", "fail",
                         f"Could not create lifecycle order (HTTP {code})"))

    # 4. cleanup
    cancel(order_no, "kiosk order")
    return out


def suite_sms(rn):
    """SMS conversation flows via /api/sms/simulate — NO real SMS is sent.
    Uses fake +6140000xxx numbers; created orders are cancelled via CANCEL."""
    c, out = rn.client, []
    drinks, milks, sizes = _menu(c)
    milk = next((m for m in ("full cream", "skim") if m in milks),
                milks[0] if milks else "full cream")

    # 1. one-shot order → confirm → CANCEL (self-cleaning)
    ph = rn.next_phone()
    with Timer() as t:
        ok, reply = _sim(c, ph, f"{BENCH_TAG} large latte with {milk}")
    if not ok:
        out.append(R("sms", "simulate endpoint", "fail", reply,
                     suggestion="The /api/sms/simulate harness is broken — SMS QA "
                                "can't run without real texts.",
                     refs=["routes/consolidated_api_routes.py"], ms=t.ms))
        return out
    # bot may ask size/milk first — answer up to 2 turns then expect a confirm
    turns = 0
    low = reply.lower()
    while turns < 3 and ("what size" in low or "what milk" in low):
        answer = ("large" if "size" in low else milk)
        ok, reply = _sim(c, ph, answer)
        low = reply.lower()
        turns += 1
    confirmed = ("confirmed" in low or "order #" in low or "being made" in low
                 or "you're #" in low or "order placed" in low)
    out.append(R("sms", "one-shot order reaches confirmation",
                 "pass" if confirmed else "fail",
                 f"After {turns + 1} turn(s): {reply[:160]}",
                 evidence=reply[:400] if not confirmed else "",
                 suggestion="" if confirmed else "A simple complete order should confirm "
                            "without stalling.",
                 refs=[] if confirmed else ["services/coffee_system.py"], ms=t.ms))
    if confirmed:
        ok, reply = _sim(c, ph, "CANCEL")
        out.append(R("sms", "cleanup: CANCEL cancels the order",
                     "pass" if ok and "cancel" in reply.lower() else "warn",
                     reply[:160],
                     suggestion="" if "cancel" in reply.lower() else
                     f"A {BENCH_TAG} order may be left in the queue — cancel it manually."))

    # 2. re-order words must not become a customer name ("Thanks Last!")
    ph = rn.next_phone()
    ok, reply = _sim(c, ph, "Last latte")
    low = reply.lower()
    good = ok and "thanks last" not in low
    asks_name = "name" in low
    out.append(R("sms", "'Last latte' not greeted as 'Thanks Last'",
                 "pass" if good and asks_name else ("warn" if good else "fail"),
                 reply[:160],
                 suggestion="" if good else "Re-order/filler words are being taken as names "
                            "again — check _extract_name_and_order's filler set.",
                 refs=[] if good else ["services/coffee_system.py"]))

    # 3. MENU lists real drinks
    ph = rn.next_phone()
    ok, reply = _sim(c, ph, "MENU")
    has_drink = ok and any(d in reply.lower() for d in (drinks[:5] or ["latte"]))
    out.append(R("sms", "MENU lists the real menu", "pass" if has_drink else "fail",
                 reply[:160],
                 refs=[] if has_drink else ["services/coffee_system.py"]))

    # 4. a milk we can't make must be refused, never silently confirmed
    candidates = [m for m in ("macadamia", "coconut", "lactose free") if m not in milks]
    if candidates:
        ph = rn.next_phone()
        ok, reply = _sim(c, ph, f"latte with {candidates[0]} milk")
        low = reply.lower()
        refused = ok and ("confirmed" not in low and "being made" not in low)
        out.append(R("sms", "unavailable milk is refused (not silently confirmed)",
                     "pass" if refused else "fail",
                     f"Asked for {candidates[0]}: {reply[:160]}",
                     evidence=reply[:400] if not refused else "",
                     suggestion="" if refused else "An order was CONFIRMED for a milk no "
                                "station can make — the #165 silent-strand bug class is back.",
                     refs=[] if refused else ["services/coffee_system.py"]))
    else:
        out.append(R("sms", "unavailable milk is refused (not silently confirmed)", "skip",
                     "Every candidate test milk is on the menu — nothing unmakeable to try"))

    # 5. STATUS with no order is graceful
    ph = rn.next_phone()
    ok, reply = _sim(c, ph, "STATUS")
    graceful = ok and "traceback" not in reply.lower() and len(reply) > 0
    out.append(R("sms", "STATUS with no order is graceful", "pass" if graceful else "fail",
                 reply[:160]))
    return out


def suite_stats(rn):
    """Reports + statistics endpoints respond with the expected shape."""
    c, out = rn.client, []
    code, body, ms = c.get("/api/reports/today")
    if code == 200 and isinstance(body, dict):
        data = body.get("data") or body.get("report") or body
        # Actual response shape (get_today_report): order data is TOP-LEVEL
        # (total_orders, status_breakdown), not under an 'orders' key. The
        # bench's first prod run flagged a false 'missing orders' warn here.
        expected = ("total_orders", "status_breakdown", "per_station",
                    "sms", "errors", "issues")
        have = [k for k in expected if k in data]
        missing = [k for k in expected if k not in data]
        out.append(R("stats", "today report shape", "pass" if not missing else "warn",
                     f"Report has {have}" + (f", missing {missing}" if missing else ""),
                     refs=[] if not missing else ["routes/consolidated_api_routes.py"], ms=ms))
    else:
        out.append(R("stats", "today report shape", "fail",
                     f"GET /api/reports/today → HTTP {code}", evidence=str(body)[:300],
                     suggestion="The post-event report is a headline feature — this "
                                "endpoint failing breaks the Dashboard report card.",
                     refs=["routes/consolidated_api_routes.py"], ms=ms))

    code, _, ms = c.get("/api/orders/statistics")
    out.append(R("stats", "order statistics endpoint", "pass" if code == 200 else "warn",
                 f"GET /api/orders/statistics → HTTP {code}", ms=ms))
    return out


def suite_inventory(rn):
    """The 'multiple inventory stores' consistency class."""
    c, out = rn.client, []
    code, ev_body, ms = c.get("/api/event-inventory")
    out.append(R("inventory", "event inventory endpoint", "pass" if code == 200 else "fail",
                 f"GET /api/event-inventory → HTTP {code}", ms=ms,
                 refs=[] if code == 200 else ["routes/consolidated_api_routes.py"]))

    code, cfg_body, ms = c.get("/api/settings/station-inventory-configs")
    out.append(R("inventory", "station inventory configs endpoint",
                 "pass" if code == 200 else "fail",
                 f"GET /api/settings/station-inventory-configs → HTTP {code}", ms=ms))

    # every ACTIVE station should have a per-station inventory config
    # (unconfigured stations showed 0/52 items — PR #75 class)
    stations = _stations(c) or []
    active_ids = [str(s.get("id") or s.get("station_id"))
                  for s in stations if (s.get("status") or "active") == "active"]
    cfgs = {}
    if isinstance(cfg_body, dict):
        cfgs = cfg_body.get("data") or cfg_body.get("value") or cfg_body.get("configs") or {}
        if not isinstance(cfgs, dict):
            cfgs = {}
    missing = [sid for sid in active_ids if sid not in {str(k) for k in cfgs.keys()}]
    if active_ids:
        out.append(R("inventory", "every active station has an inventory config",
                     "pass" if not missing else "warn",
                     "All active stations configured" if not missing
                     else f"Active stations with NO station-inventory config: {missing}. "
                          "They rely on the auto-default (full menu).",
                     refs=[] if not missing else
                     ["Barista Front End/src/components/organiser/StationInventoryConfig.js"]))
    return out


def suite_blocklist(rn):
    """SMS abuse protection: block → listed → unblock (opt-in, fake number)."""
    c, out = rn.client, []
    if not rn.options.get("allow_blocklist"):
        return [R("blocklist", "block/unblock roundtrip", "skip",
                  "Opt-in (mutates settings) — enable 'blocklist roundtrip' to run")]
    fake = "+61400000990"
    code, body, _ = c.get("/api/sms/blocklist")
    if code != 200:
        return [R("blocklist", "list endpoint", "fail",
                  f"GET /api/sms/blocklist → HTTP {code}",
                  refs=["routes/consolidated_api_routes.py"])]
    c1, b1, _ = c.post("/api/sms/block", {"phone": fake, "reason": "bench roundtrip"})
    code, body, _ = c.get("/api/sms/blocklist")
    listed = any(fake in str(e.get("phone", "")) for e in
                 ((body.get("data") or {}).get("blocked") if isinstance(body, dict) else []) or [])
    c2, b2, _ = c.post("/api/sms/unblock", {"phone": fake})
    code, body, _ = c.get("/api/sms/blocklist")
    still = any(fake in str(e.get("phone", "")) for e in
                ((body.get("data") or {}).get("blocked") if isinstance(body, dict) else []) or [])
    ok = c1 == 200 and listed and c2 == 200 and not still
    out.append(R("blocklist", "block/unblock roundtrip", "pass" if ok else "fail",
                 f"block → {c1}, listed={listed}, unblock → {c2}, still-listed={still}",
                 evidence="" if ok else f"{b1} | {b2}"[:300],
                 suggestion="" if ok else ("The number may still be blocked — unblock "
                            f"{fake} in Support → SMS Block."),
                 refs=[] if ok else ["services/coffee_system.py",
                                     "routes/consolidated_api_routes.py"]))
    return out


# Base suites defined in this module. The full registry (base + deep + matrix)
# lives in bench.registry — import ALL_SUITES from there, not here, so the
# suite modules can depend on this module's helpers without a circular import.
BASE_SUITES = [
    ("health", suite_health, False),
    ("auth", suite_auth, True),
    ("stations", suite_stations, True),
    ("display", suite_display, False),
    ("orders", suite_orders, True),
    ("sms", suite_sms, True),
    ("stats", suite_stats, True),
    ("inventory", suite_inventory, True),
    ("blocklist", suite_blocklist, True),
]


# Plain-English catalogue of what each suite actually does — shown in the UI
# so the depth of testing is visible, not buried in code.
CATALOG = {
    "health": [
        "Public display config answers (the screen & kiosk depend on it)",
        "The web app itself is served",
        "SECURITY: the stations API rejects calls with no login (must 401)",
    ],
    "auth": ["Your login token actually authorises real API calls"],
    "stations": [
        "Every station's status is a valid value (active/inactive/maintenance)",
        "Queue counts are sane non-negative numbers",
        "Wait estimates are within 0–240 min (catches the bogus 72-hour wait bug class)",
        "At least one station is active (else every order path fails)",
    ],
    "display": [
        "Display config has the event name + SMS number",
        "The kiosk/SMS menu is populated (drinks, milks, sizes)",
        "The order board endpoint answers",
        "CONSISTENCY: every milk on the menu is makeable by at least one active "
        "station (the oat/#165 silent-strand bug class)",
    ],
    "orders": [
        "A kiosk order (no phone) is created and returns a station",
        "It actually appears in the barista pending queue",
        "It can be cancelled (and is, as cleanup)",
        "Opt-in: full start → complete lifecycle",
    ],
    "sms": [
        "A texted order conversation reaches a confirmation (via the simulator — no real SMS)",
        "CANCEL cancels it",
        "'Last latte' asks for your name (regression: it once replied 'Thanks Last!')",
        "MENU lists the real menu",
        "A milk no station offers is REFUSED, never silently confirmed",
        "STATUS with no order answers gracefully",
    ],
    "stats": [
        "Today's report has the real sections: totals, status breakdown, per-station, SMS, errors, issues",
        "The order statistics endpoint answers",
    ],
    "inventory": [
        "Event inventory + per-station config endpoints answer",
        "Every ACTIVE station has a station-inventory config (the '0/52 items' bug class)",
    ],
    "blocklist": ["Opt-in: block a fake number → it's listed → unblock → it's gone"],
    "stock": [
        "DEEP: places a real (phoneless) milk order and verifies the milk inventory "
        "counter goes DOWN by the right amount (~0.2 L for a medium)",
        "Checks whether a cup and coffee are decremented too (reports honestly if "
        "those counters never move)",
        "Observes whether cancelling an order puts stock back",
        "Restores all counters to their pre-test levels afterwards",
    ],
    "queue_wait": [
        "DEEP: loads one station with 3 real orders → its queue count must rise by 3 "
        "and its wait estimate must not fall",
        "Cancels them → the queue must drop back",
    ],
    "routing": [
        "DEEP: live end-to-end — an SMS order for a milk only SOME stations can make "
        "must land on one of the capable stations (not just config comparison)",
    ],
    "group": [
        "DEEP: a FRIEND group order — customer orders, adds a friend's coffee — and "
        "both orders reach the queue",
    ],
    "schedule": [
        "Today's schedule endpoint answers + warns if no shifts are configured",
        "HONEST DESIGN NOTE (always shown): barista shifts are informational — "
        "routing only respects station status and event breaks, not the roster",
    ],
    "journeys": [
        "CROSS-ACTOR JOURNEYS — follow an action to what it triggers next "
        "(where design-gap bugs hide, like the barista-reply one)",
        "Barista 'Message Customer' → customer replies → the reply must reach "
        "the barista Messages inbox tagged to the order, and must NOT be parsed "
        "as a new order ('what's your first name?'). Uses dry_run so NO real SMS",
        "FORGET ME → asks to confirm → YES erases → a fresh order afterwards "
        "asks the name again (the privacy promise, proven not just claimed)",
        "More journeys to add: reply to a reminder SMS, CANCEL mid-make, "
        "edit conflicts, two same-name customers",
    ],
    "matrix": [
        "THE SCENARIO MATRIX: dimensions are read from YOUR live configuration — "
        "order channel (kiosk/SMS) × drinks × every menu milk (+ one deliberately "
        "unavailable milk) × sizes × sugar",
        "All-pairs combinatorial generation: every PAIR of factor values is "
        "exercised together at least once (~15-20 live scenarios instead of "
        "thousands), capped at 18 orders per run for safety",
        "Each scenario is judged against an expected-outcome oracle: "
        "(1) accepted vs refused correctly — the unavailable milk must be REFUSED, "
        "(2) an accepted order appears in the pending queue on a station that can "
        "actually make its milk, (3) cancelling removes it from the queue",
        "Cleanup: all matrix orders cancelled and stock restored to pre-run levels",
        "Not yet in the matrix (honest gaps): time-of-day/break variations, "
        "roster/barista variations (shifts don't gate routing today), VIP codes, "
        "and real Twilio delivery — tell us which matter and they get added",
    ],
}
