"""
Coffee Cue Test Bench — COVERAGE EXPANSION (Phase A of COVERAGE_MAP.md).

Three suites that widen coverage of the parts real customers and operators
touch every event:

  sms_vocab   every SMS keyword the bot understands (~32) produces a sensible,
              non-crashing, on-topic reply — not a traceback, not silence
  edge_input  the bot survives hostile input (emoji, 600-char text, empty-ish,
              numbers-only, unicode) without erroring or leaking a stack trace
  settings    a config value written via the API actually round-trips (set →
              read-back → restore). OPT-IN (mutates settings; restores after).

All SMS goes through /api/sms/simulate (no real SMS). Fake phones virgin per
run. No order is left behind (vocab/edge don't complete orders; any stray
ZZBench order is swept).
"""
from __future__ import annotations

from .core import BENCH_TAG, result
from .suites import _menu, _order_list, _sim

R = result

# text that means "the bot blew up" — any of these in a reply is a fail
_CRASH_MARKERS = ("traceback", "internal server error", "none type",
                  "nonetype", "500", "stack trace", "unhandled")


def _looks_crashy(reply):
    low = (reply or "").lower()
    if not reply or not reply.strip():
        return True, "empty reply"
    for m in _CRASH_MARKERS:
        if m in low:
            return True, f"contains '{m}'"
    return False, ""


def _sweep(rn, prefix):
    c = rn.client
    code, body, _ = c.get("/api/orders/pending")
    for o in _order_list(body):
        nm = str(o.get("customer_name") or o.get("customerName") or "")
        if nm.lower().startswith(prefix.lower()):
            no = o.get("order_number") or o.get("orderNumber") or o.get("id")
            if no is not None:
                c.post(f"/api/orders/{no}/cancel")


# ---------------------------------------------------------------- sms_vocab

def suite_sms_vocab(rn):
    """Every SMS keyword returns a sane, on-topic, non-crashing reply."""
    c, out = rn.client, []
    drinks, _milks, _sizes = _menu(c)

    # (keyword, must-contain-any [lowercased], note). Empty must-contain = only
    # the non-crash check applies. Each uses a FRESH phone so there's no
    # cross-keyword state bleed.
    checks = [
        ("MENU", [d for d in drinks[:3]] or ["coffee", "menu"], "lists the menu"),
        ("OPTIONS", ["menu", "order", "cancel", "friend", "status"], "command list"),
        ("COMMANDS", ["menu", "order", "cancel", "friend", "status"], "command list"),
        ("INFO", ["order", "menu", "text", "help", "coffee"], "help text"),
        ("HELPME", ["team", "barista", "help", "question", "ask"], "routes to staff"),
        ("STATUS", ["order", "no ", "don't have", "pending", "ready"], "order status"),
        ("USUAL", ["usual", "don't", "no ", "order", "what"], "usual-order path"),
        ("STAFF", ["team", "barista", "help", "question", "ask"], "routes to staff"),
        ("CANCEL", ["cancel", "no ", "don't have", "order"], "cancel path"),
        ("MYDATA", ["data", "order", "name", "no ", "don't"], "data summary"),
        ("RESET", ["reset", "start", "fresh", "order", "name"], "reset path"),
    ]
    crashy = 0
    for kw, must, note in checks:
        ph = rn.next_phone()
        ok, reply = _sim(c, ph, kw)
        crash, why = _looks_crashy(reply) if ok else (True, reply)
        on_topic = (not must) or any(m in (reply or "").lower() for m in must)
        status = "fail" if (crash or not ok) else ("pass" if on_topic else "warn")
        if status == "fail":
            crashy += 1
        out.append(R("sms_vocab", f"keyword {kw}", status,
                     (f"{note}: " if status != "pass" else "") + (reply or why)[:150],
                     evidence=(reply or "")[:400] if status != "pass" else "",
                     suggestion="" if status == "pass" else
                     (f"'{kw}' crashed/empty ({why})" if crash else
                      f"'{kw}' reply seems off-topic (expected one of {must})"),
                     refs=[] if status == "pass" else ["services/coffee_system.py"]))

    # BARISTA <question> — inline question path reaches the inbox
    ph = rn.next_phone()
    ok, reply = _sim(c, ph, f"BARISTA is the {BENCH_TAG} milk fresh today?")
    good = ok and ("team" in reply.lower() or "barista" in reply.lower()
                   or "sent" in reply.lower() or "ask" in reply.lower())
    out.append(R("sms_vocab", "keyword BARISTA <question>", "pass" if good else "warn",
                 reply[:150], refs=[] if good else ["services/coffee_system.py"]))

    out.append(R("sms_vocab", "no keyword crashed the bot",
                 "pass" if crashy == 0 else "fail",
                 f"{len(checks)} keywords exercised, {crashy} crashed/empty"))

    # Standing truth note: as of 2026-07-20 the READY and STARTED SMS are
    # template-driven (settings keys sms_ready_message /
    # sms_started_message; placeholders {name} {drink} {order_number}
    # {station}; blank = default wording; renderer warns if a template
    # leaves single-segment GSM-7). The CONFIRM message remains hardcoded
    # by design — it is deeply dynamic (queue position, group totals,
    # price tail).
    tc, tb, _ = c.get("/api/sms/templates")
    out.append(R("sms_vocab", "SMS templates: endpoint alive (design note)",
                 "pass" if tc == 200 else "warn",
                 f"GET /api/sms/templates → HTTP {tc}. Ready/started SMS are "
                 "template-driven (sms_ready_message / sms_started_message); "
                 "the confirm message stays hardcoded by design (dynamic "
                 "queue/group/price content).",
                 refs=[] if tc == 200 else ["routes/consolidated_api_routes.py"]))
    _sweep(rn, BENCH_TAG)
    return out


# ---------------------------------------------------------------- edge_input

def suite_edge_input(rn):
    """The bot survives hostile / weird input without crashing."""
    c, out = rn.client, []
    cases = [
        ("emoji only", "☕☕☕🥛🔥"),
        ("very long text", "latte " * 120),
        ("single dot", "."),
        ("numbers only", "1234567890"),
        ("unicode / accents", "café crème très chaud ☕ naïve"),
        ("sql-ish", "latte'; DROP TABLE orders;--"),
        ("mixed case shout", "LaTtE WiTh OaT MiLk!!!"),
        ("newlines", "latte\n\n\nwith oat"),
    ]
    fails = 0
    for name, text in cases:
        ph = rn.next_phone()
        ok, reply = _sim(c, ph, text)
        crash, why = _looks_crashy(reply) if ok else (True, str(reply))
        if crash:
            fails += 1
        out.append(R("edge_input", name, "pass" if not crash else "fail",
                     (reply or why)[:140],
                     evidence=(reply or "")[:400] if crash else "",
                     suggestion="" if not crash else f"Hostile input crashed the bot ({why}).",
                     refs=[] if not crash else ["services/coffee_system.py", "services/nlp.py"]))
    if fails == 0:
        out.append(R("edge_input", "bot is robust to hostile input", "pass",
                     f"All {len(cases)} edge inputs handled gracefully"))
    _sweep(rn, BENCH_TAG)
    return out


# ---------------------------------------------------------------- settings

def _get_setting(c, path, keys):
    code, body, _ = c.get(path)
    if code != 200 or not isinstance(body, dict):
        return None, None
    data = body.get("data") or body.get("config") or body.get("settings") or body
    for k in keys:
        if isinstance(data, dict) and k in data:
            return data.get(k), data
    return None, data


import re as _re


def _current_prefix(c, rn):
    """Read the TRUE live order_prefix by its EFFECT: place a phoneless probe
    order and read the non-digit lead of its number ('ZT538' → 'ZT', '539' →
    ''). GET /api/settings does NOT return order_prefix, so this is the only
    honest way to read it — and it means we can always restore exactly."""
    code, mb, _ = c.post("/api/display/order",
                         {"name": f"{BENCH_TAG}SetProbe", "coffee_type": "latte",
                          "milk": "full cream", "size": "medium", "sugar": "No sugar",
                          "phone": ""}, auth=False)
    onum = str((mb or {}).get("order_number") or "") if isinstance(mb, dict) else ""
    if onum:
        c.post(f"/api/orders/{onum}/cancel")
    m = _re.match(r"^([A-Za-z]+)", onum)
    return (m.group(1) if m else ""), onum


def suite_settings(rn):
    """order_prefix round-trips by its real EFFECT: capture the current prefix
    from a probe order → write a test prefix → confirm new orders wear it →
    RESTORE the exact original. (Settings have no per-key endpoint; the only
    writer is bulk PUT /api/settings, and GET /api/settings doesn't echo
    order_prefix — so we read it via its effect and always restore it. Learned
    the hard way: an earlier version left 'ZT' on production.)"""
    c, out = rn.client, []
    if not rn.options.get("allow_settings"):
        return [R("settings", "order_prefix round-trip", "skip",
                  "Opt-in (mutates a setting, then restores it) — enable 'settings round-trip'")]

    orig, _n0 = _current_prefix(c, rn)
    test_val = "ZZ"
    restored_ok = False
    try:
        wc, wb, _ = c.req("PUT", "/api/settings", body={"order_prefix": test_val})
        out.append(R("settings", "write order_prefix (bulk PUT)",
                     "pass" if wc in (200, 201) else "fail",
                     f"PUT order_prefix='{test_val}' → HTTP {wc}",
                     evidence="" if wc in (200, 201) else str(wb)[:200],
                     refs=[] if wc in (200, 201) else ["routes/consolidated_api_routes.py"]))
        # the real effect: does a NEW order number wear the prefix?
        eff, num = _current_prefix(c, rn)
        wore = eff == test_val
        out.append(R("settings", "order_prefix reaches new order numbers",
                     "pass" if wore else "fail",
                     f"new order number was {num!r} (prefix {eff!r}, expected {test_val!r})",
                     suggestion="" if wore else "A written order_prefix didn't reach new "
                                "order numbers — operator config change had no effect.",
                     refs=[] if wore else ["services/coffee_system.py"]))
    finally:
        # ALWAYS restore, whatever happened above.
        rc, _, _ = c.req("PUT", "/api/settings", body={"order_prefix": orig})
        eff_after, _n = _current_prefix(c, rn)
        restored_ok = rc in (200, 201) and eff_after == orig
        out.append(R("settings", "cleanup: order_prefix restored",
                     "pass" if restored_ok else "fail",
                     f"restored to {orig!r} → HTTP {rc}, new orders now prefix {eff_after!r}",
                     suggestion="" if restored_ok else
                     f"IMPORTANT: set order_prefix back to {orig!r} in Organiser settings."))
    out.extend(_event_name_roundtrip(rn))
    out.extend(_pricing_roundtrip(rn))
    out.extend(_sms_template_roundtrip(rn))
    _sweep(rn, BENCH_TAG)
    return out


def _sms_template_roundtrip(rn):
    """The ready-SMS template actually drives the message (wired
    2026-07-20 — templates used to be decorative). Set a marked template
    → run an order to completed with test_no_send (which now RECORDS the
    rendered message without sending) → the recorded message carries the
    marker with placeholders substituted → restore (empty = default
    wording). Needs allow_lifecycle too (completes a real order)."""
    c, out = rn.client, []
    if not rn.options.get("allow_lifecycle"):
        return [R("settings", "SMS template round-trip", "skip",
                  "needs 'lifecycle' too (completes an order with test_no_send)")]
    tpl = "BENCHTPL {name} your {drink} #{order_number} is at {station}"
    order_no, phone = None, None
    try:
        wc, _wb, _ = c.req("PUT", "/api/settings", body={"sms_ready_message": tpl})
        out.append(R("settings", "sms template: write accepted",
                     "pass" if wc in (200, 201) else "fail", f"PUT → HTTP {wc}"))
        phone = rn.next_phone()
        ok, reply = _sim(c, phone, f"{BENCH_TAG}Tpl medium latte with full cream")
        import re as _re
        m = _re.search(r"#([A-Za-z]{0,3}\d+)", reply or "")
        order_no = m.group(1) if m else None
        if not order_no:
            out.append(R("settings", "sms template reaches the ready message",
                         "warn", f"setup order didn't confirm: {(reply or '')[:120]}"))
            return out
        c.post(f"/api/orders/{order_no}/start", {"test_no_send": True})
        c.post(f"/api/orders/{order_no}/complete", {"test_no_send": True})
        mc, mb, _ = c.get(f"/api/orders/{order_no}/messages")
        msgs = (mb or {}).get("messages") or []
        rendered = next((str(x.get("message") or "") for x in msgs
                         if "BENCHTPL" in str(x.get("message") or "")), "")
        substituted = rendered and "{name}" not in rendered \
            and f"#{order_no}" in rendered and "latte" in rendered.lower()
        out.append(R("settings", "sms template reaches the ready message",
                     "pass" if substituted else "fail",
                     f"recorded: {rendered[:120]!r}" if rendered else
                     f"no BENCHTPL message recorded (HTTP {mc}, {len(msgs)} messages)",
                     evidence="" if substituted else str(msgs)[:300],
                     suggestion="" if substituted else
                     "An operator-edited SMS template never reached the "
                     "customer's ready message.",
                     refs=[] if substituted else ["routes/consolidated_api_routes.py"]))
    finally:
        rc, _, _ = c.req("PUT", "/api/settings", body={"sms_ready_message": ""})
        if order_no:
            c.post(f"/api/orders/{order_no}/pickup")
            c.post(f"/api/orders/{order_no}/cancel")
        out.append(R("settings", "cleanup: sms template restored",
                     "pass" if rc in (200, 201) else "fail",
                     f"restored to default wording → HTTP {rc}",
                     suggestion="" if rc in (200, 201) else
                     "IMPORTANT: clear sms_ready_message in settings by hand."))
    return out


def _pricing_roundtrip(rn):
    """pricing_settings: enable → an SMS confirmation carries the computed
    price and the pending card carries the price fields → restore EXACT
    previous pricing → a fresh order carries no price again (when pricing
    was off, which is the normal free-event state)."""
    c, out = rn.client, []
    gc, orig, _ = c.get("/api/pricing-settings")
    if gc != 200 or not isinstance(orig, dict):
        return [R("settings", "pricing round-trip", "warn",
                  f"couldn't read pricing settings (HTTP {gc})")]
    was_enabled = bool(orig.get("enabled"))
    try:
        wc, _wb, _ = c.req("PUT", "/api/pricing-settings",
                           body={**orig, "enabled": True,
                                 "per_drink": {**(orig.get("per_drink") or {}),
                                               "latte": 4.50}})
        ph = rn.next_phone()
        ok, reply = _sim(c, ph, f"{BENCH_TAG}Prc medium latte with full cream")
        low = (reply or "").lower()
        priced_sms = ok and ("$" in (reply or "") or "4.50" in (reply or "")
                             or "pay" in low)
        row = {}
        for o in _order_list(c.get("/api/orders/pending")[1]):
            if str(o.get("customerName") or "").lower().startswith(f"{BENCH_TAG}Prc".lower()):
                row = o
                c.post(f"/api/orders/{o.get('order_number')}/cancel")
        priced_card = row.get("price") is not None or row.get("priceFormatted")
        good = wc in (200, 201) and priced_sms and priced_card
        out.append(R("settings", "pricing: enabled price reaches SMS + card",
                     "pass" if good else "fail",
                     f"PUT → {wc}; SMS priced={priced_sms}; card price="
                     f"{row.get('priceFormatted') or row.get('price')!r} — "
                     f"reply: {(reply or '')[:90]}",
                     evidence="" if good else (reply or "")[:300],
                     suggestion="" if good else
                     "Pricing is enabled but the customer/barista never see "
                     "a price — the honour-payment flow can't work.",
                     refs=[] if good else ["routes/consolidated_api_routes.py",
                                           "services/coffee_system.py"]))
    finally:
        rc, _, _ = c.req("PUT", "/api/pricing-settings", body=orig)
        ph = rn.next_phone()
        ok, reply2 = _sim(c, ph, f"{BENCH_TAG}Prc2 medium latte with full cream")
        for o in _order_list(c.get("/api/orders/pending")[1]):
            if str(o.get("customerName") or "").lower().startswith(f"{BENCH_TAG}Prc".lower()):
                c.post(f"/api/orders/{o.get('order_number')}/cancel")
        unpriced_again = was_enabled or ("$" not in (reply2 or ""))
        out.append(R("settings", "cleanup: pricing restored",
                     "pass" if rc in (200, 201) and unpriced_again else "fail",
                     f"restore PUT → HTTP {rc}; fresh order priced again="
                     f"{'yes (was enabled before)' if was_enabled else ('no' if unpriced_again else 'YES — restore failed')}",
                     suggestion="" if rc in (200, 201) and unpriced_again else
                     "IMPORTANT: re-check Organiser pricing settings."))
    return out


def _event_name_roundtrip(rn):
    """event_name: write via the branding blob → the SMS welcome and the
    display config must carry it → restore the EXACT original blob.

    The SMS side caches the name for 30s, so both the effect check and the
    restore check POLL (fresh virgin phone per attempt — a first message
    always gets the welcome greeting)."""
    import time as _t
    c, out = rn.client, []

    gc, gb, _ = c.get("/api/settings/branding")
    blob = (gb or {}).get("settings") if isinstance(gb, dict) else None
    if gc != 200 or not isinstance(blob, dict):
        return [R("settings", "event_name round-trip", "warn",
                  f"couldn't read branding blob (HTTP {gc}) — skipping")]

    test_name = "ZZBench Event"

    def _display_name():
        _cd, cb, _ = c.get("/api/display/config", auth=False)
        if not isinstance(cb, dict):
            return ""
        cfg = cb.get("config") if isinstance(cb.get("config"), dict) else cb
        return str(cfg.get("event_name") or cfg.get("eventName") or "")

    def _welcome_has(needle, tries=10, gap=5):
        for _ in range(tries):
            ok, reply = _sim(c, rn.next_phone(), "INFO")
            if ok and needle.lower() in (reply or "").lower():
                return True
            _t.sleep(gap)
        return False

    orig_display = _display_name()
    try:
        newblob = dict(blob)
        newblob["event_name"] = test_name
        newblob["eventName"] = test_name
        wc, _wb, _ = c.req("PUT", "/api/settings/branding", body={"settings": newblob})
        out.append(R("settings", "event_name: branding write accepted",
                     "pass" if wc in (200, 201) else "fail", f"PUT → HTTP {wc}"))
        disp = ""
        for _ in range(6):
            disp = _display_name()
            if test_name.lower() in disp.lower():
                break
            _t.sleep(3)
        disp_ok = test_name.lower() in disp.lower()
        out.append(R("settings", "event_name reaches the display config",
                     "pass" if disp_ok else "fail",
                     f"display config event_name is now {disp!r}",
                     suggestion="" if disp_ok else
                     "A saved event name never reached the display screen.",
                     refs=[] if disp_ok else ["routes/consolidated_api_routes.py"]))
        sms_ok = _welcome_has(test_name)
        out.append(R("settings", "event_name reaches the SMS welcome",
                     "pass" if sms_ok else "fail",
                     "fresh customer's welcome text carries the new event name"
                     if sms_ok else "welcome text never showed the new name "
                     "(polled past the 30s cache)",
                     suggestion="" if sms_ok else
                     "A saved event name never reached SMS greetings.",
                     refs=[] if sms_ok else ["services/coffee_system.py"]))
    finally:
        rc, _rb, _ = c.req("PUT", "/api/settings/branding", body={"settings": blob})
        back = ""
        for _ in range(6):
            back = _display_name()
            if test_name.lower() not in back.lower():
                break
            _t.sleep(3)
        restored = rc in (200, 201) and test_name.lower() not in back.lower() \
            and (not orig_display or back == orig_display)
        out.append(R("settings", "cleanup: branding blob restored",
                     "pass" if restored else "fail",
                     f"restore PUT → HTTP {rc}; display name back to {back!r}",
                     suggestion="" if restored else
                     "IMPORTANT: re-save the event name in Organiser → Branding."))
    return out


COVERAGE_SUITES = [
    ("sms_vocab", suite_sms_vocab, True),
    ("edge_input", suite_edge_input, True),
    ("settings", suite_settings, True),
]
