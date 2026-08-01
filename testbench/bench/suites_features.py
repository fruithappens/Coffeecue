"""
Coffee Cue Test Bench — guards for the 2026-07-30 feature wave.

Two suites:

  features_ro    read-only, always runs:
                   - sugar model: ONE sugar stock item, not five "N sugars"
                     count-rows (the "5 teaspoon sachet" absurdity, #163)
                   - /inventory/low-stock answers and its items are really
                     low (the data the barista alert + walk-in dialog read,
                     #169)
                   - broadcast audience 'preorders' is recognised by the
                     zero-send preview endpoint; junk audiences refused
                     (#172)

  features_flow  opt-in via --allow-lifecycle (drives real SMS-simulator
                 conversations; pre-order leg also needs --allow-settings
                 because it briefly flips pre-event mode ON):
                   - milk default: "medium latte" with no milk never asks
                     for milk and lands as full cream, visibly (#166/#168)
                   - ETA scheduling: "im 15 mins away" from a known
                     customer books a scheduled order (#173)
                   - pre-event mode: an order-shaped SMS diverts to a
                     saved preference, creates NO live order (#171)

Zero real SMS (simulator + uuid-virgin numbers). Self-cleaning: every
order cancelled, pre-event settings restored exactly.
"""
from __future__ import annotations

import re as _re

from .core import BENCH_TAG, result
from .suites import _order_list, _sim

R = result


def _pending(client):
    _c, b, _ = client.get("/api/orders/pending")
    return _order_list(b)


def _find_order(rows, number):
    return next((o for o in rows if str(o.get("order_number")
                or o.get("orderNumber") or o.get("id")) == str(number)), None)


# ---------------------------------------------------------------- read-only

def suite_features_ro(rn):
    c, out = rn.client, []

    # --- sugar model -------------------------------------------------------
    _ic, ib, _ = c.get("/api/inventory")
    rows = (ib or {}).get("items") or (ib or {}).get("data") or []
    if isinstance(rows, dict):
        rows = [r for cat in rows.values() if isinstance(cat, list) for r in cat]
    count_rows = [r for r in rows
                  if _re.fullmatch(r"[2-9]\s*sugars?", str(r.get("name", "")).strip().lower())]
    sugar_rows = [r for r in rows if "sugar" in str(r.get("name", "")).lower()]
    ok = not count_rows and len(sugar_rows) >= 1
    out.append(R("features_ro", "sugar is ONE stock item, not count-rows",
                 "pass" if ok else "fail",
                 f"sugar rows: {[r.get('name') for r in sugar_rows][:4]}, "
                 f"count-rows: {[r.get('name') for r in count_rows]}",
                 suggestion="" if ok else
                 "The '2 sugars/3 sugars' pseudo-products are back — sugar is a "
                 "quantity, one sachet item depletes per teaspoon (#163).",
                 refs=[] if ok else ["routes/consolidated_api_routes.py"]))

    # --- low-stock endpoint ------------------------------------------------
    lc, lb, _ = c.get("/api/inventory/low-stock")
    items = (lb or {}).get("items") or (lb or {}).get("low_stock") or []
    shape_ok = lc == 200 and isinstance(lb, dict)
    honest = True
    detail_bits = []
    for it in items[:10]:
        try:
            amount = float(it.get("amount") or 0)
            capacity = float(it.get("capacity") or 0)
            if capacity > 0 and amount / capacity > 0.5:
                honest = False
                detail_bits.append(f"{it.get('name')} {amount}/{capacity}")
        except Exception:
            continue
    out.append(R("features_ro", "low-stock feed answers and reports honestly",
                 "pass" if (shape_ok and honest) else "fail",
                 f"HTTP {lc}, {len(items)} low item(s)"
                 + (f"; NOT actually low: {detail_bits}" if detail_bits else ""),
                 suggestion="" if (shape_ok and honest) else
                 "The barista low-stock alert reads this feed (#169) — a wrong "
                 "feed either cries wolf or hides a real outage.",
                 refs=[] if (shape_ok and honest) else ["routes/inventory_routes.py"]))

    # --- broadcast audience ------------------------------------------------
    gc, gb, _ = c.get("/api/support/broadcast/preview?audience=preorders")
    good = gc == 200 and isinstance(gb, dict)
    bc, _bb, _ = c.get("/api/support/broadcast/preview?audience=zzbench_bogus")
    out.append(R("features_ro", "broadcast knows the 'preorders' audience (and refuses junk)",
                 "pass" if (good and bc == 400) else "fail",
                 f"preorders={gc} (recipients={gb.get('recipient_count') if isinstance(gb, dict) else '?'}), "
                 f"bogus={bc}",
                 refs=[] if (good and bc == 400) else ["routes/support_api_routes.py"]))
    return out


# ---------------------------------------------------------------- flows

def suite_features_flow(rn):
    c, out = rn.client, []
    if not rn.options.get("allow_lifecycle"):
        return [R("features_flow", "feature-wave conversation flows", "skip",
                  "Opt-in (drives simulator conversations) — enable 'lifecycle'")]

    def step(name, ok, detail, suggestion=""):
        out.append(R("features_flow", name, "pass" if ok else "fail", detail,
                     suggestion="" if ok else suggestion,
                     refs=[] if ok else ["services/coffee_system.py"]))
        return ok

    # --- milk default (#166/#168) -----------------------------------------
    # NB: the fake name must contain no drink/milk keywords — an earlier
    # run used "...Milkdef" and the name parser saw 'milk' in it.
    ph = rn.next_phone()
    no1 = None
    try:
        ok1, r1 = _sim(c, ph, "medium latte")
        asked_milk = "milk" in (r1 or "").lower() and "?" in (r1 or "")
        ok2, r2 = _sim(c, ph, f"{BENCH_TAG}Dana")
        m = _re.search(r"#([A-Za-z]{0,3}\d+)", (r2 or "") + (r1 or ""))
        no1 = m.group(1) if m else None
        step("milk default: bare 'medium latte' never asks for milk",
             ok1 and not asked_milk, (r1 or "")[:100],
             suggestion="Unspecified milk must default to full cream with a "
                        "visible recap, not a question (Steve 2026-07-21).")
        row = _find_order(_pending(c), no1) if no1 else None
        milk = str((row or {}).get("milkType") or (row or {}).get("milk_type") or "")
        recap_ok = "full cream" in ((r2 or "") + (r1 or "")).lower()
        step("milk default: lands as full cream and the recap SAYS so",
             bool(no1) and "full cream" in milk.lower() and recap_ok,
             f"order #{no1}, card milk={milk!r}, recap_mentions={recap_ok}")
    finally:
        if no1:
            c.post(f"/api/orders/{no1}/cancel")

    # --- ETA scheduling (#173) --------------------------------------------
    ph2 = rn.next_phone()
    no2 = sched_no = None
    try:
        _sim(c, ph2, "large flat white with skim")
        okn, rn2 = _sim(c, ph2, f"{BENCH_TAG}Eta")
        m = _re.search(r"#([A-Za-z]{0,3}\d+)", rn2 or "")
        no2 = m.group(1) if m else None
        if no2:
            c.post(f"/api/orders/{no2}/cancel")
        oke, re_ = _sim(c, ph2, "im 15 mins away")
        m = _re.search(r"#([A-Za-z]{0,3}\d+)", re_ or "")
        sched_no = m.group(1) if m else None
        step("ETA: 'im 15 mins away' books a scheduled order with a time",
             oke and bool(sched_no) and ("about" in (re_ or "").lower()
                                         or ":" in (re_ or "")),
             (re_ or "")[:120],
             suggestion="ETA scheduling (#173) regressed — known customers "
                        "should get a timed order, not confusion.")
        if sched_no:
            pend = _pending(c)
            step("ETA: scheduled order is NOT already in the live queue",
                 not _find_order(pend, sched_no),
                 f"scheduled #{sched_no} hidden until ~5 min before arrival")
    finally:
        for n in (no2, sched_no):
            if n:
                c.post(f"/api/orders/{n}/cancel")

    # --- pre-event divert (#171) ------------------------------------------
    if not rn.options.get("allow_settings"):
        out.append(R("features_flow", "pre-event divert", "skip",
                     "Needs --allow-settings (briefly flips pre-event mode ON)"))
        return out
    _gc, gb, _ = c.get("/api/settings/pre-event")
    orig = (gb or {}).get("settings") or {}
    before = int((gb or {}).get("saved_preorders") or 0)
    ph3 = rn.next_phone()
    try:
        c.req("PUT", "/api/settings/pre-event",
              body={**orig, "enabled": True})
        okp, rp = _sim(c, ph3, f"{BENCH_TAG}Pre medium cappuccino with oat")
        has_order_number = bool(_re.search(r"#\d+", rp or ""))
        _gc2, gb2, _ = c.get("/api/settings/pre-event")
        after = int((gb2 or {}).get("saved_preorders") or 0)
        step("pre-event: order-shaped SMS diverts to a preference, no live order",
             okp and not has_order_number and after >= before + 1,
             f"reply={((rp or '')[:80])!r}, preorders {before}->{after}",
             suggestion="Pre-event mode (#171) must save a preference and "
                        "reply with the configured wording — never queue a "
                        "real order before the event opens.")
        # Regression caught on this suite's first run: the reply opened
        # "Thanks Zzbenchpre! Thanks Zzbenchpre!" — prefix + self-greeting
        # template doubled up.
        name_count = (rp or "").lower().count("zzbench")
        step("pre-event: greeting is not doubled",
             name_count <= 1, f"name appears {name_count}x in reply",
             suggestion="_place_order prepends 'Thanks {name}! ' onto a "
                        "template that already greets by name.")
    finally:
        c.req("PUT", "/api/settings/pre-event", body=orig)

    # --- self-serve sugar mode (#199) -------------------------------------
    ph4 = rn.next_phone()
    no4 = None
    try:
        c.req("PUT", "/api/settings", body={"sugar_self_serve": True})
        _sim(c, ph4, "medium latte with 2 sugars")
        ok4, r4 = _sim(c, ph4, f"{BENCH_TAG}Sasha")
        m = _re.search(r"#([A-Za-z]{0,3}\d+)", r4 or "")
        no4 = m.group(1) if m else None
        row = _find_order(_pending(c), no4) if no4 else None
        card_sugar = str((row or {}).get("sugar") or "").lower()
        step("self-serve sugar: reply says help-yourself, card carries NO sugar",
             bool(no4) and "help-yourself" in (r4 or "").lower()
             and card_sugar in ("no sugar", ""),
             f"order #{no4}, card sugar={card_sugar!r}, reply={((r4 or '')[:90])!r}",
             suggestion="Self-serve venues: a requested sugar must never land "
                        "on the barista card; the customer is told where to "
                        "find it (#199).")
    finally:
        if no4:
            c.post(f"/api/orders/{no4}/cancel")
        c.req("PUT", "/api/settings", body={"sugar_self_serve": False})

    # --- team-mode stage ticks (#200) -------------------------------------
    ph5 = rn.next_phone()
    no5 = None
    try:
        _sim(c, ph5, "medium latte")
        ok5, r5 = _sim(c, ph5, f"{BENCH_TAG}Toby")
        m = _re.search(r"#([A-Za-z]{0,3}\d+)", r5 or "")
        no5 = m.group(1) if m else None
        if no5:
            c.post(f"/api/orders/{no5}/start")
            sc, sb, _ = c.post(f"/api/orders/{no5}/stage",
                               {"stage": "shots", "done": True})
            _c6, ib, _ = c.get("/api/orders?status=in-progress")
            rows = ib.get("data") or ib.get("orders") or []
            row = _find_order(rows if isinstance(rows, list) else [], no5)
            got = ((row or {}).get("stages") or {})
            step("team mode: a shots tick survives to the next poll",
                 sc == 200 and (sb or {}).get("success") is True
                 and bool(got.get("shots")),
                 f"order #{no5}, POST={sc}, polled stages={got}",
                 suggestion="Stage ticks must be server-backed — a tick only "
                            "on one device tells the other barista a lie.")
            bc, _bb, _ = c.post(f"/api/orders/{no5}/stage",
                                {"stage": "espresso", "done": True})
            step("team mode: unknown stage names are refused",
                 bc == 400, f"HTTP {bc} (expected 400)")
    finally:
        if no5:
            c.post(f"/api/orders/{no5}/cancel")

    # --- no-coffee drinks must not burn beans (bug #19, #201) -------------
    def _beans_total():
        from .suites_deep import _inventory
        total = 0.0
        for r in (_inventory(c) or []):
            if str(r.get("category")).lower() == "coffee":
                total += float(r.get("amount") or r.get("current_quantity") or 0)
        return round(total, 3)

    ph6 = rn.next_phone()
    no6 = None
    try:
        beans_before = _beans_total()
        _sim(c, ph6, "medium hot chocolate")
        ok6, r6 = _sim(c, ph6, f"{BENCH_TAG}Harper")
        m = _re.search(r"#([A-Za-z]{0,3}\d+)", r6 or "")
        no6 = m.group(1) if m else None
        if no6:
            c.post(f"/api/orders/{no6}/start")
            c.post(f"/api/orders/{no6}/complete", {"test_no_send": True})
            beans_after = _beans_total()
            step("hot chocolate burns NO coffee beans",
                 beans_after == beans_before,
                 f"order #{no6}, beans {beans_before} -> {beans_after}",
                 suggestion="The shot decrement excluded only TEA and "
                            "defaulted everything else to 1 shot — every hot "
                            "chocolate/chai/babycino drained 8g of beans "
                            "(bug #19). Non-coffee drinks must leave the "
                            "coffee category untouched.")
            c.post(f"/api/orders/{no6}/pickup")
        else:
            step("hot chocolate burns NO coffee beans", False,
                 f"couldn't place hot chocolate: {((r6 or '')[:80])!r}")
    finally:
        if no6:
            c.post(f"/api/orders/{no6}/cancel")

    # --- bean dose: a latte burns exactly ONE configured dose (#202) ------
    ph7 = rn.next_phone()
    no7 = None
    try:
        _sc, sb, _ = c.get("/api/settings")
        cfg = (sb or {}).get("settings") or (sb or {}).get("data") or {}
        try:
            dose_kg = float(cfg.get("beans_grams_per_shot") or 22) / 1000.0
        except (TypeError, ValueError):
            dose_kg = 0.022
        beans_before = _beans_total()
        _sim(c, ph7, "medium latte")
        ok7, r7 = _sim(c, ph7, f"{BENCH_TAG}Piper")
        m = _re.search(r"#([A-Za-z]{0,3}\d+)", r7 or "")
        no7 = m.group(1) if m else None
        if no7:
            c.post(f"/api/orders/{no7}/start")
            c.post(f"/api/orders/{no7}/complete", {"test_no_send": True})
            burned = round(beans_before - _beans_total(), 3)
            step("a latte burns exactly one configured bean dose",
                 abs(burned - round(dose_kg, 3)) <= 0.002,
                 f"order #{no7}, burned {burned}kg vs dose {round(dose_kg, 3)}kg "
                 f"(beans_grams_per_shot={cfg.get('beans_grams_per_shot') or '22 default'})",
                 suggestion="Bean depletion must follow the configured dose "
                            "(AU standard 20-22g; default 22g high-side for "
                            "wastage) — 8g was the wrong-context Italian "
                            "single (#202).")
            c.post(f"/api/orders/{no7}/pickup")
        else:
            step("a latte burns exactly one configured bean dose", False,
                 f"couldn't place latte: {((r7 or '')[:80])!r}")
    finally:
        if no7:
            c.post(f"/api/orders/{no7}/cancel")

    # --- express batch: tray complete + table wording (#203) --------------
    ph8, ph9 = rn.next_phone(), rn.next_phone()
    batch_nos = []
    try:
        for ph, nm in ((ph8, f"{BENCH_TAG}Quinn"), (ph9, f"{BENCH_TAG}Reese")):
            _sim(c, ph, "medium latte")
            _ok, rr = _sim(c, ph, nm)
            m = _re.search(r"#([A-Za-z]{0,3}\d+)", rr or "")
            if m:
                batch_nos.append(m.group(1))
        if len(batch_nos) == 2:
            for n in batch_nos:
                c.post(f"/api/orders/{n}/start")
            label = "the FLAT WHITE table at Coffee Station 1"
            bc, bb, _ = c.post("/api/orders/batch-complete",
                               {"order_ids": batch_nos,
                                "collection_label": label,
                                "test_no_send": True})
            done = (bb or {}).get("completed") or []
            step("express batch: one tap completes the whole tray",
                 bc == 200 and len(done) == 2 and not (bb or {}).get("failed"),
                 f"orders {batch_nos}, completed={len(done)}, "
                 f"failed={(bb or {}).get('failed')}",
                 suggestion="Batch complete must finish EVERY order it was "
                            "given and report per-order failures — orders "
                            "must never be lost to the bulk process (Steve).")
            _mc, mb, _ = c.get(f"/api/orders/{batch_nos[0]}/messages")
            texts = " ".join(str(m.get("body") or m.get("message") or "")
                             for m in ((mb or {}).get("messages") or []))
            step("express batch: ready-SMS says collect from the table",
                 "FLAT WHITE table" in texts,
                 f"recorded SMS mentions table: {'FLAT WHITE table' in texts}",
                 suggestion="The collection note must ride the {station} "
                            "placeholder into the ready SMS — otherwise "
                            "customers walk to the wrong counter.")
            for n in batch_nos:
                c.post(f"/api/orders/{n}/pickup")
        else:
            step("express batch: one tap completes the whole tray", False,
                 f"could only place {len(batch_nos)}/2 lattes")
    finally:
        for n in batch_nos:
            c.post(f"/api/orders/{n}/cancel")

    # --- self-clean: purge the preference rows these flows created --------
    hc, hb, _ = c.post("/api/support/bench-hygiene")
    deleted = (hb or {}).get("deleted") if isinstance(hb, dict) else None
    out.append(R("features_flow", "cleanup: bench preference rows purged",
                 "pass" if hc == 200 else "warn",
                 f"HTTP {hc}, deleted={deleted}",
                 suggestion="" if hc == 200 else
                 "Bench phones accumulate in customer_preferences and "
                 "inflate the preorders broadcast audience."))
    return out


FEATURE_SUITES = [
    ("features_ro", suite_features_ro, True),
    ("features_flow", suite_features_flow, True),
]
