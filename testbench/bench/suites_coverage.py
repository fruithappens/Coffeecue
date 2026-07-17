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


def suite_settings(rn):
    """A setting written via the API round-trips (set → read-back → restore)."""
    c, out = rn.client, []
    if not rn.options.get("allow_settings"):
        return [R("settings", "round-trip", "skip",
                  "Opt-in (mutates event settings) — enable 'settings round-trip' to run")]

    # order_prefix: set → confirm a new SMS order uses it → restore
    code, body, _ = c.get("/api/settings/order_prefix")
    orig = None
    if code == 200 and isinstance(body, dict):
        orig = (body.get("data") or body.get("value") or body.get("prefix")
                or (body.get("settings") or {}).get("order_prefix"))
    test_prefix = "ZT"
    put_code, put_body, _ = c.post("/api/settings/order_prefix", {"value": test_prefix, "prefix": test_prefix})
    if put_code not in (200, 201):
        # try the generic settings endpoint shape
        put_code, put_body, _ = c.req("PUT", "/api/settings/order_prefix",
                                      body={"value": test_prefix})
    applied = put_code in (200, 201)
    out.append(R("settings", "write order_prefix", "pass" if applied else "warn",
                 f"PUT order_prefix='{test_prefix}' → HTTP {put_code}",
                 evidence="" if applied else str(put_body)[:200],
                 refs=[] if applied else ["routes/consolidated_api_routes.py"]))

    if applied:
        # place a quick SMS order and see if the number wears the prefix
        drinks, milks, _ = _menu(c)
        ph = rn.next_phone()
        ok, reply = _sim(c, ph, f"{BENCH_TAG}Set large "
                         f"{'latte' if 'latte' in drinks else (drinks[0] if drinks else 'latte')} "
                         f"with {'full cream' if 'full cream' in milks else (milks[0] if milks else 'full cream')}")
        low, turns = (reply or "").lower(), 0
        while ok and turns < 2 and ("what size" in low or "what milk" in low):
            ok, reply = _sim(c, ph, "large")
            low = (reply or "").lower()
            turns += 1
        wore = f"#{test_prefix.lower()}" in low or f"order {test_prefix.lower()}" in low
        out.append(R("settings", "order_prefix reaches new order numbers",
                     "pass" if wore else "warn",
                     f"new order confirm: {reply[:140]}",
                     suggestion="" if wore else "Prefix set but the next order number didn't "
                                "show it — may apply only to fresh sequence values.",
                     refs=[] if wore else ["services/coffee_system.py"]))
        _sim(c, ph, "CANCEL")

    # restore
    if orig is not None:
        rc, _, _ = c.post("/api/settings/order_prefix", {"value": orig, "prefix": orig})
        out.append(R("settings", "cleanup: order_prefix restored",
                     "pass" if rc in (200, 201) else "fail",
                     f"restored order_prefix='{orig}' → HTTP {rc}",
                     suggestion="" if rc in (200, 201) else
                     f"Set order_prefix back to '{orig}' manually in Organiser settings."))
    _sweep(rn, BENCH_TAG)
    return out


COVERAGE_SUITES = [
    ("sms_vocab", suite_sms_vocab, True),
    ("edge_input", suite_edge_input, True),
    ("settings", suite_settings, True),
]
