#!/usr/bin/env python3
"""
run_persistence_matrix.py — Phase 2 (backend half) of DEEP_TEST_PLAN.md.

Proves the config → behaviour loop end-to-end at the API level:

    Organiser writes inventory via /api/inventory
        → row persists in Postgres (not localStorage)
        → the SMS bot's offerings change accordingly
        → revert returns behaviour to baseline

Each case is self-cleaning (try/finally) so the catalogue is left exactly
as found. The browser half of Phase 2 (walk-in dialog, barista stock UI,
localStorage-backed surfaces) is a separate, interactive pass — this file
covers everything a headless run can prove.

Usage:
    python tests/persistence/run_persistence_matrix.py
    python tests/persistence/run_persistence_matrix.py --base-url http://localhost:5001
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path

# Reuse the conversation/admin clients from the Phase-1 harness.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "sms_scenarios"))
from run_sms_scenarios import Api, SmsClient, fresh_identity  # noqa: E402

GREEN, RED, YELLOW, RESET = "\033[32m", "\033[31m", "\033[33m", "\033[0m"


def _post_inventory(api: Api, body: dict):
    r = api.s.post(f"{api.base}/api/inventory", json=body, headers=api._h(), timeout=10)
    try:
        payload = r.json()
    except Exception:
        payload = {}
    item = payload.get("item") or payload.get("data") or {}
    return r.status_code, item.get("id")


def _put_inventory(api: Api, item_id: int, body: dict):
    r = api.s.put(f"{api.base}/api/inventory/{item_id}", json=body, headers=api._h(), timeout=10)
    return r.status_code


def _delete_inventory(api: Api, item_id: int):
    r = api.s.delete(f"{api.base}/api/inventory/{item_id}", headers=api._h(), timeout=10)
    return r.status_code


def _find_item(api: Api, category: str, name: str):
    code, payload = api.get("/api/inventory")
    items = (payload.get("items") or payload.get("data") or []) if code == 200 else []
    for it in items:
        if it.get("category") == category and str(it.get("name", "")).lower() == name.lower():
            return it
    return None


def _start_conversation(sms: SmsClient, phone: str, name: str) -> None:
    """Walk a fresh phone to the 'what can I get you' state."""
    sms.send(phone, "hi")
    sms.send(phone, name)


def run(base_url: str, username: str, password: str) -> int:
    api = Api(base_url, username, password)
    if not api.login():
        print(f"{RED}FATAL{RESET} cannot log in to {base_url}")
        return 2
    sms = SmsClient(base_url)

    results = []

    def record(case: str, ok: bool, detail: str):
        flag = f"{GREEN}PASS{RESET}" if ok else f"{RED}FAIL{RESET}"
        print(f"{flag}  {case}")
        if not ok:
            print(f"      {YELLOW}{detail}{RESET}")
        results.append({"case": case, "ok": ok, "detail": detail})

    # ------------------------------------------------------------------
    # Case 1: a milk ADDED via the API is immediately sellable over SMS,
    # and removing it makes the bot refuse it again.
    # ------------------------------------------------------------------
    case = "milk_add_propagates_to_sms_then_reverts"
    item_id = None
    try:
        pre = _find_item(api, "milk", "coconut")
        if pre:
            record(case, False, "precondition: coconut milk already in catalogue — choose another probe")
        else:
            phone, name = fresh_identity()
            _start_conversation(sms, phone, name)
            _, before = sms.send(phone, "latte with coconut milk")

            code, item_id = _post_inventory(api, {
                "name": "coconut", "category": "milk", "amount": 50,
                "capacity": 50, "unit": "L", "minimum_threshold": 1,
            })
            created_ok = code in (200, 201) and item_id

            phone2, name2 = fresh_identity()
            _start_conversation(sms, phone2, name2)
            _, during = sms.send(phone2, "latte with coconut milk")

            if item_id:
                _delete_inventory(api, item_id)
                item_id = None

            phone3, name3 = fresh_identity()
            _start_conversation(sms, phone3, name3)
            _, after = sms.send(phone3, "latte with coconut milk")

            problems = []
            if not created_ok:
                problems.append(f"POST /api/inventory failed (status {code})")
            if not re.search(r"don'?t have coconut", before, re.I):
                problems.append(f"baseline should refuse coconut: '{before[:90]}'")
            if re.search(r"don'?t have coconut", during, re.I):
                problems.append(f"after ADD the bot still refuses coconut: '{during[:90]}'")
            if not re.search(r"size|sugar|confirm", during, re.I):
                problems.append(f"after ADD expected the order to proceed: '{during[:90]}'")
            if not re.search(r"don'?t have coconut", after, re.I):
                problems.append(f"after DELETE the bot still sells coconut: '{after[:90]}'")
            record(case, not problems, "; ".join(problems))
    finally:
        if item_id:
            _delete_inventory(api, item_id)

    # ------------------------------------------------------------------
    # Case 2: stock depletion. SEMANTICS DEPEND ON EVENT MODE:
    #   - unlimited_stock_mode (Quick Setup default): amount is ignored
    #     by design — presence in the catalogue is the only switch, and
    #     the off-lever is deletion (covered by case 1). Zero stock must
    #     NOT cause a refusal (spurious "we're out" rejections were the
    #     reason this mode exists).
    #   - tracked mode: amount 0 → the bot must refuse with alternatives.
    # ------------------------------------------------------------------
    unlimited = True  # default to the Quick Setup default if unreadable
    code, settings_payload = api.get("/api/settings")
    if code == 200:
        blob = json.dumps(settings_payload)
        m = re.search(r'unlimited_stock_mode[^}]*?"enabled"\s*:\s*(true|false)', blob)
        if m:
            unlimited = m.group(1) == "true"

    case = f"milk_depletion_semantics ({'unlimited' if unlimited else 'tracked'} mode)"
    oat = _find_item(api, "milk", "oat")
    if not oat:
        record(case, False, "no 'oat' milk in catalogue to test with")
    else:
        original_amount = oat.get("amount")
        try:
            _put_inventory(api, oat["id"], {"amount": 0})

            phone2, name2 = fresh_identity()
            _start_conversation(sms, phone2, name2)
            _, during = sms.send(phone2, "latte with oat milk")

            _put_inventory(api, oat["id"], {"amount": original_amount})

            phone3, name3 = fresh_identity()
            _start_conversation(sms, phone3, name3)
            _, after = sms.send(phone3, "latte with oat milk")

            problems = []
            refused = bool(re.search(r"don'?t have oat|out of|unavailable", during, re.I))
            if unlimited and refused:
                problems.append(
                    f"unlimited-stock mode must ignore amount, but bot refused: '{during[:90]}'")
            if not unlimited and not refused:
                problems.append(
                    f"tracked mode with zero stock but bot still sells oat: '{during[:90]}'")
            if re.search(r"don'?t have oat", after, re.I):
                problems.append(f"stock restored but bot still refuses oat: '{after[:90]}'")
            record(case, not problems, "; ".join(problems))
        finally:
            _put_inventory(api, oat["id"], {"amount": original_amount})

    # ------------------------------------------------------------------
    # Case 3: a drink added via the API becomes ORDERABLE over SMS, and
    # is refused again after delete. (Probing by ordering, not by the
    # MENU text — the MENU reply deliberately truncates the coffee list
    # to six entries with "+N more", so string-matching it is unsound.)
    # ------------------------------------------------------------------
    case = "drink_add_orderable_then_reverts"
    item_id = None
    try:
        if _find_item(api, "drinks", "affogato"):
            record(case, False, "precondition: affogato already in catalogue — choose another probe")
        else:
            phone, name = fresh_identity()
            _start_conversation(sms, phone, name)
            _, before = sms.send(phone, "affogato")

            # NOTE: category='drinks', NOT 'coffee'. In this schema the
            # 'coffee' category rows are BEANS (stock gate for the whole
            # espresso menu); the espresso drink list itself is the
            # hardcoded _STANDARD_DRINK_MENU (known deferred rethink —
            # see CLAUDE_HANDOFF_NOTES). Orderable add-on drinks (teas,
            # hot choc, affogato, ...) live in the 'drinks' category.
            code, item_id = _post_inventory(api, {
                "name": "affogato", "category": "drinks", "amount": 100,
                "capacity": 100, "unit": "units", "minimum_threshold": 1,
            })

            phone2, name2 = fresh_identity()
            _start_conversation(sms, phone2, name2)
            _, during = sms.send(phone2, "affogato")

            if item_id:
                _delete_inventory(api, item_id)
                item_id = None

            phone3, name3 = fresh_identity()
            _start_conversation(sms, phone3, name3)
            _, after = sms.send(phone3, "affogato")

            problems = []
            if code not in (200, 201):
                problems.append(f"POST /api/inventory failed (status {code})")
            if not re.search(r"don'?t have", before, re.I):
                problems.append(f"baseline should refuse affogato: '{before[:90]}'")
            if re.search(r"don'?t have", during, re.I):
                problems.append(f"after ADD the bot still refuses affogato: '{during[:90]}'")
            if not re.search(r"milk|size|sugar|confirm", during, re.I):
                problems.append(f"after ADD expected order to proceed: '{during[:90]}'")
            if not re.search(r"don'?t have", after, re.I):
                problems.append(f"after DELETE the bot still sells affogato: '{after[:90]}'")
            record(case, not problems, "; ".join(problems))
    finally:
        if item_id:
            _delete_inventory(api, item_id)

    # ------------------------------------------------------------------
    # Case 3b: the Organiser's enable/disable switch (event-inventory
    # store) controls what SMS sells. Disable an enabled espresso drink
    # → bot refuses it; restore → bot sells it again. This was the
    # "americano leak": _STANDARD_DRINK_MENU ignored the enabled flags.
    # ------------------------------------------------------------------
    case = "organiser_disable_removes_from_sms"
    blob_code, blob = api.get("/api/event-inventory")
    coffees = (blob or {}).get("coffee") or []
    probe = next((c for c in coffees
                  if isinstance(c, dict) and c.get("enabled", True)
                  and str(c.get("name", "")).lower() in ("mocha", "latte", "cappuccino")), None)
    if blob_code != 200 or not probe:
        record(case, False, "no enabled espresso drink in event-inventory store to probe with")
    else:
        drink = str(probe["name"]).lower()
        try:
            probe["enabled"] = False
            api.s.put(f"{api.base}/api/event-inventory", json=blob, headers=api._h(), timeout=10)

            phone, name = fresh_identity()
            _start_conversation(sms, phone, name)
            _, during = sms.send(phone, drink)

            probe["enabled"] = True
            api.s.put(f"{api.base}/api/event-inventory", json=blob, headers=api._h(), timeout=10)

            phone2, name2 = fresh_identity()
            _start_conversation(sms, phone2, name2)
            _, after = sms.send(phone2, drink)

            problems = []
            if not re.search(r"don'?t have", during, re.I):
                problems.append(f"organiser disabled '{drink}' but bot still sells it: '{during[:90]}'")
            if re.search(r"don'?t have", after, re.I):
                problems.append(f"'{drink}' re-enabled but bot still refuses: '{after[:90]}'")
            record(case, not problems, "; ".join(problems))
        finally:
            probe["enabled"] = True
            api.s.put(f"{api.base}/api/event-inventory", json=blob, headers=api._h(), timeout=10)

    # ------------------------------------------------------------------
    # Case 4: writes persist in the DATABASE (not some in-process cache):
    # a fresh API session sees the same catalogue.
    # ------------------------------------------------------------------
    case = "catalogue_persists_across_sessions"
    api2 = Api(base_url, username, password)
    if not api2.login():
        record(case, False, "second login failed")
    else:
        a = {(i.get("category"), str(i.get("name")).lower())
             for i in (api.get("/api/inventory")[1].get("items") or [])}
        b = {(i.get("category"), str(i.get("name")).lower())
             for i in (api2.get("/api/inventory")[1].get("items") or [])}
        record(case, a == b and len(a) > 0,
               f"session views differ or empty (a={len(a)}, b={len(b)})")

    # ---- report
    failed = sum(1 for r in results if not r["ok"])
    ts = time.strftime("%Y%m%d_%H%M%S")
    out = Path("logs") / f"persistence_matrix_{ts}.json"
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps({"base_url": base_url, "results": results}, indent=2))
    print(f"\n{len(results) - failed}/{len(results)} cases passed — report: {out}")
    return 1 if failed else 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url", default=os.environ.get("SMS_SCEN_BASE", "http://localhost:5001"))
    ap.add_argument("--username", default=os.environ.get("SMS_SCEN_USER", "coffeecue"))
    ap.add_argument("--password", default=os.environ.get("SMS_SCEN_PASS", "adminpassword"))
    a = ap.parse_args()
    sys.exit(run(a.base_url, a.username, a.password))
