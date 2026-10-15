#!/usr/bin/env python3
"""
run_sms_scenarios.py — SMS conversation CORRECTNESS harness (Phase 1 of
DEEP_TEST_PLAN.md).

The contract smoke (tests/smoke) proves endpoints answer with the right
field names; the load harness (tests/load) proves throughput. NEITHER
proves the bot says the right THING. This harness does: it drives the real
/sms webhook with Twilio-shaped POSTs (zero SMS cost — Twilio is not in
the loop, the TwiML reply comes back as the HTTP response body), walks
multi-turn conversations, and asserts on BOTH:

  1. reply intent — the reply matches expected patterns (and does NOT
     match forbidden ones, e.g. silently assuming a milk the customer
     never chose), and
  2. backend state — an order was/wasn't created, via the admin API.

Scenario design rules:
  - every scenario gets its OWN phone number and a unique customer name,
    so runs are isolated and re-runnable without DB cleanup
  - setup/teardown go through the admin API (same surface the Organiser
    uses), never raw SQL — if the API can't express the setup, that's a
    finding in itself
  - a scenario that surfaces undefined behaviour (e.g. what DOES the bot
    say when every station is closed?) asserts the *customer-correct*
    behaviour. If the app fails, that's a real product bug to fix, not a
    test to soften.

Usage:
    python tests/sms_scenarios/run_sms_scenarios.py                # all
    python tests/sms_scenarios/run_sms_scenarios.py --only closed  # filter
    python tests/sms_scenarios/run_sms_scenarios.py --list
    python tests/sms_scenarios/run_sms_scenarios.py --base-url http://localhost:5001

Exit codes: 0 all pass, 1 failures, 2 bootstrap failed.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import uuid
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path

import requests

GREEN, RED, YELLOW, RESET = "\033[32m", "\033[31m", "\033[33m", "\033[0m"


# ---------------------------------------------------------------- helpers

class Api:
    """Thin admin-API client for setup/verify, mirroring tests/smoke."""

    def __init__(self, base_url: str, username: str, password: str):
        self.base = base_url.rstrip("/")
        self.s = requests.Session()
        self.token = None
        self.username = username
        self.password = password

    def login(self) -> bool:
        r = self.s.post(
            f"{self.base}/api/auth/login",
            json={"username": self.username, "password": self.password},
            timeout=10,
        )
        if r.status_code != 200:
            return False
        self.token = r.json().get("token")
        return bool(self.token)

    def _h(self):
        return {"Authorization": f"Bearer {self.token}"} if self.token else {}

    def get(self, path: str):
        r = self.s.get(f"{self.base}{path}", headers=self._h(), timeout=10)
        try:
            return r.status_code, r.json()
        except Exception:
            return r.status_code, {}

    def patch(self, path: str, body: dict):
        r = self.s.patch(f"{self.base}{path}", json=body, headers=self._h(), timeout=10)
        try:
            return r.status_code, r.json()
        except Exception:
            return r.status_code, {}

    # -- domain helpers ----------------------------------------------------

    def stations(self) -> list[dict]:
        code, payload = self.get("/api/stations")
        if code != 200:
            return []
        # tolerate both {stations:[...]} and {data:[...]} shapes
        return payload.get("stations") or payload.get("data") or []

    def set_station_status(self, station_id: int, status: str) -> bool:
        code, _ = self.patch(f"/api/stations/{station_id}/status", {"status": status})
        return code == 200

    def orders_for_name(self, name: str) -> list[dict]:
        """Search pending + in-progress + completed for a customer name."""
        found = []
        for path in ("/api/orders/pending", "/api/orders/in-progress", "/api/orders/completed"):
            code, payload = self.get(path)
            if code != 200:
                continue
            items = payload.get("orders") or payload.get("data") or []
            for o in items:
                blob = json.dumps(o, default=str).lower()
                if name.lower() in blob:
                    found.append(o)
        return found


class SmsClient:
    """Sends Twilio-shaped webhook POSTs to /sms and returns the reply text."""

    def __init__(self, base_url: str):
        self.base = base_url.rstrip("/")
        self.s = requests.Session()

    def send(self, phone: str, body: str, message_sid: str | None = None) -> tuple[int, str]:
        form = {
            "From": phone,
            "To": "+61489000000",
            "Body": body,
            "MessageSid": message_sid or f"SM{uuid.uuid4().hex}",
            "AccountSid": "ACtest",
            "NumMedia": "0",
        }
        r = self.s.post(f"{self.base}/sms", data=form, timeout=20)
        text = ""
        if r.text:
            try:
                root = ET.fromstring(r.text)
                text = " ".join(m.text or "" for m in root.iter("Message"))
            except ET.ParseError:
                text = r.text  # non-TwiML reply — keep raw for the report
        return r.status_code, text.strip()


# ------------------------------------------------------------- scenarios

@dataclass
class Step:
    send: str
    expect_any: list[str] = field(default_factory=list)   # ≥1 must match (re.I)
    reject_all: list[str] = field(default_factory=list)   # none may match
    sid: str | None = None                                # force a MessageSid

@dataclass
class Scenario:
    name: str
    why: str
    steps: list[Step]
    setup: str | None = None      # named setup handled by the runner
    verify: str | None = None     # named verification
    verify_arg: str | None = None


# Milliseconds, not seconds: two runs a few seconds apart used to reuse
# each other's phones, so the bot greeted a 'new' customer as a regular.
_seq = int(time.time() * 1000) % 10_000_000


def fresh_identity() -> tuple[str, str]:
    """Unique (phone, name) per scenario so runs never collide."""
    global _seq
    _seq += 1
    return f"+6149{_seq:07d}", f"Scen{_seq}"


def build_scenarios() -> list[tuple[Scenario, str, str]]:
    out = []

    def add(s: Scenario):
        phone, name = fresh_identity()
        # late-bind the unique name into the steps
        for st in s.steps:
            st.send = st.send.replace("{NAME}", name)
        s.verify_arg = name if s.verify else None
        out.append((s, phone, name))

    # The bot's actual second-contact voice is "Hi X! What can I get you?"
    GREET2 = r"what can i get|coffee|like|menu"

    add(Scenario(
        name="happy_path_full_order",
        why="Baseline: a stranger should be able to text and get a coffee.",
        steps=[
            Step("hi", expect_any=[r"name"]),
            Step("{NAME}", expect_any=[GREET2]),
            Step("latte", expect_any=[r"full cream milk.*size|size"]),
            Step("medium", expect_any=[r"confirmed|order #|in line"]),
        ],
        verify="order_exists",
    ))

    add(Scenario(
        name="no_silent_milk_default",
        why="HOUSE RULE (as amended Jul 2026): an unnamed milk becomes full "
            "cream, but it must be SHOWN before the order is placed, never "
            "silently baked in.",
        steps=[
            Step("hello", expect_any=[r"name"]),
            Step("{NAME}", expect_any=[GREET2]),
            Step("cappuccino", expect_any=[r"full cream"],
                 reject_all=[r"order (number|#)", r"confirmed"]),
        ],
    ))

    add(Scenario(
        name="flat_white_no_silent_defaults",
        why="'small flat white' may place straight away, but the recap must "
            "show the milk (full cream) and must not invent sugar.",
        steps=[
            Step("hi", expect_any=[r"name"]),
            Step("{NAME}", expect_any=[GREET2]),
            Step("small flat white", expect_any=[r"full cream"],
                 reject_all=[r"\d sugar"]),
        ],
    ))

    add(Scenario(
        name="size_in_first_message_respected",
        why="'large latte' gives the size up front: never ask 'what size?'.",
        steps=[
            Step("hi", expect_any=[r"name"]),
            Step("{NAME}", expect_any=[GREET2]),
            Step("large latte", expect_any=[r"large latte|confirmed|order"],
                 reject_all=[r"what size"]),
        ],
    ))

    add(Scenario(
        name="size_answer_respected",
        why="The answer to the size question must be the size on the order, "
            "and a milk named at that question must change the milk (found "
            "15 Oct 2026: 'oat' there used to keep full cream).",
        steps=[
            Step("hi", expect_any=[r"name"]),
            Step("{NAME}", expect_any=[GREET2]),
            Step("latte", expect_any=[r"size"]),
            Step("oat", expect_any=[r"oat milk.*size"]),
            Step("medium", expect_any=[r"medium latte with oat"],
                 reject_all=[r"small latte", r"full cream"]),
        ],
    ))

    add(Scenario(
        name="onesize_combined_order_keeps_sugar",
        why="LIVE PROD BUG (found 2026-06-13): on a ONE-SIZE event, a "
            "combined order that includes sugar ('skim flat white 1 sugar') "
            "got its sugar dropped — the single-size branch jumped straight "
            "to 'How much sugar?' instead of falling through to confirm. "
            "Requires a single configured cup size to reproduce; the runner "
            "sets that up via setup='one_size'.",
        setup="one_size",
        steps=[
            Step("hi", expect_any=[r"name"]),
            Step("{NAME}", expect_any=[GREET2]),
            # all three of milk+drink+sugar in one message, one-size event:
            Step("skim flat white 1 sugar",
                 expect_any=[r"confirm|just to confirm|reply yes"],
                 reject_all=[r"how much sugar"]),
        ],
    ))

    add(Scenario(
        name="natural_no_sugar_phrasing",
        why="'no sugar' typed with the order is understood, never re-asked.",
        steps=[
            Step("hi", expect_any=[r"name"]),
            Step("{NAME}", expect_any=[GREET2]),
            Step("skim latte no sugar", expect_any=[r"size"]),
            Step("small", expect_any=[r"no sugar"],
                 reject_all=[r"didn'?t catch|how much sugar"]),
        ],
    ))

    add(Scenario(
        name="item_not_on_menu",
        why="Customer asks for something we don't sell — needs a polite refusal "
            "or clarifying question, never a 500 or a phantom order.",
        steps=[
            Step("hi", expect_any=[r"name"]),
            Step("{NAME}", expect_any=[GREET2]),
            Step("frappuccino with extra caramel",
                 expect_any=[r"don'?t have|not available|not sure|didn'?t "
                             r"(quite )?(understand|catch)|what (type|kind) of coffee|available"],
                 reject_all=[r"order (number|#)", r"станция"]),
        ],
        verify="no_order",
    ))

    add(Scenario(
        name="milk_not_carried",
        why="Milk we don't stock should be refused with alternatives offered.",
        steps=[
            Step("hi", expect_any=[r"name"]),
            Step("{NAME}", expect_any=[GREET2]),
            Step("latte with coconut milk",
                 expect_any=[r"don'?t have.*(coconut|milk)|available milk|what milk"],
                 reject_all=[r"order (number|#)"]),
        ],
        verify="no_order",
    ))

    add(Scenario(
        name="status_with_no_orders",
        why="STATUS for a customer with nothing pending should say so.",
        steps=[
            Step("hi", expect_any=[r"name"]),
            Step("{NAME}", expect_any=[GREET2]),
            Step("STATUS", expect_any=[r"don'?t have any (active|pending)|no (active|pending|current) order"]),
        ],
    ))

    add(Scenario(
        name="cancel_with_no_orders",
        why="CANCEL with nothing to cancel should say so, not crash.",
        steps=[
            Step("hi", expect_any=[r"name"]),
            Step("{NAME}", expect_any=[GREET2]),
            Step("CANCEL", expect_any=[r"don'?t have any pending|no (pending|active) order|nothing to cancel"]),
        ],
    ))

    add(Scenario(
        name="order_then_cancel",
        why="Place an order then cancel it — order must actually cancel.",
        steps=[
            Step("hi", expect_any=[r"name"]),
            Step("{NAME}", expect_any=[GREET2]),
            Step("latte", expect_any=[r"size"]),
            Step("small", expect_any=[r"confirmed|order #|in line"]),
            Step("CANCEL", expect_any=[r"cancel"]),
        ],
        verify="no_pending_order",
    ))

    add(Scenario(
        name="gibberish_is_graceful",
        why="Nonsense input must produce a graceful clarifying reply, not a 500.",
        steps=[
            Step("hi", expect_any=[r"name"]),
            Step("{NAME}", expect_any=[GREET2]),
            Step("asdf qwerty 🌮🌮🌮 zzz", expect_any=[r".+"],
                 reject_all=[r"error|exception|traceback"]),
        ],
    ))

    add(Scenario(
        name="empty_body_is_graceful",
        why="Empty SMS (it happens) must not crash the webhook.",
        steps=[
            Step("", expect_any=[r".*"]),  # any 200 reply (or empty TwiML) passes
        ],
    ))

    add(Scenario(
        name="duplicate_message_sid",
        why="Twilio retries webhooks on slow responses; replaying the SAME "
            "MessageSid must be idempotent: the same reply, and no second order.",
        steps=[
            Step("hi", expect_any=[r"name"]),
            Step("{NAME}", expect_any=[GREET2]),
            Step("large latte", expect_any=[r"confirmed|order"], sid="SMDUPE-{NAME}"),
            Step("large latte", expect_any=[r"confirmed|order"],
                 reject_all=[r"didn'?t recognize"], sid="SMDUPE-{NAME}"),
        ],
        verify="at_most_one_order",
    ))

    add(Scenario(
        name="all_stations_closed",
        why="With every station inactive the customer must be TOLD it's "
            "closed/unavailable — never given a confirmation into the void.",
        setup="close_all_stations",
        steps=[
            Step("hi", expect_any=[r"name"]),
            Step("{NAME}", expect_any=[r"what can i get|coffee|like|closed|unavailable"]),
            # Today the bot finishes the questions and refuses at the end
            # (no order is made). Saying so up front would be kinder; until
            # then the size question is allowed here.
            Step("latte", expect_any=[r"closed|unavailable|not (currently )?(open|taking|available)|sorry|size"],
                 reject_all=[r"order #?\d", r"confirmed"]),
            Step("medium oat latte", expect_any=[r"closed|unavailable|sorry|not sure"],
                 reject_all=[r"order #?\d", r"you'?re #\d|in line", r"confirmed"]),
        ],
        verify="no_order",
    ))

    return out


# --------------------------------------------------------------- runner

def run(base_url: str, username: str, password: str, only: str | None,
        list_only: bool) -> int:
    scenarios = build_scenarios()
    if list_only:
        for s, _, _ in scenarios:
            print(f"  {s.name:28} — {s.why}")
        return 0
    if only:
        scenarios = [t for t in scenarios if only.lower() in t[0].name.lower()]
        if not scenarios:
            print(f"{RED}no scenario matches --only {only}{RESET}")
            return 2

    api = Api(base_url, username, password)
    if not api.login():
        print(f"{RED}FATAL{RESET} cannot log in to {base_url} as {username}")
        return 2
    sms = SmsClient(base_url)

    # snapshot station statuses so close_all_stations can restore
    station_snapshot = [(s.get("id"), s.get("status")) for s in api.stations()]

    results = []
    failed = 0
    for scenario, phone, name in scenarios:
        transcript = []
        problems = []

        # ---- setup
        restore_needed = False
        cups_disabled = []   # (item_id) cups we removed for one_size, to recreate
        cups_snapshot = []
        if scenario.setup == "close_all_stations":
            ok_all = True
            for sid_, _status in station_snapshot:
                if sid_ is not None:
                    ok_all = api.set_station_status(sid_, "inactive") and ok_all
            restore_needed = True
            if not ok_all:
                problems.append("setup: could not close all stations via API")
        elif scenario.setup == "one_size":
            # Reduce the event to a SINGLE cup size by deleting the others,
            # then recreate them in teardown. Reproduces the prod config
            # (one size) that triggered the dropped-sugar bug.
            code, payload = api.get("/api/inventory")
            cups = [i for i in (payload.get("items") or payload.get("data") or [])
                    if i.get("category") == "cups"]
            cups_snapshot = [{k: c.get(k) for k in
                              ("name", "category", "amount", "capacity", "unit", "minimum_threshold")}
                             for c in cups]
            # keep the first cup, delete the rest
            for c in cups[1:]:
                api.s.delete(f"{api.base}/api/inventory/{c['id']}", headers=api._h(), timeout=10)
                cups_disabled.append(c["id"])
            if len(cups) < 2:
                # already one size — nothing to restore
                cups_snapshot = []

        # ---- conversation
        try:
            for step in scenario.steps:
                sid = step.sid.replace("{NAME}", name) if step.sid else None
                code, reply = sms.send(phone, step.send, message_sid=sid)
                transcript.append({"send": step.send, "status": code, "reply": reply})
                if code >= 500:
                    problems.append(f"HTTP {code} on '{step.send}'")
                    break
                if step.expect_any and not any(
                        re.search(p, reply, re.I | re.S) for p in step.expect_any):
                    problems.append(
                        f"reply to '{step.send}' matched none of {step.expect_any}: got '{reply[:160]}'")
                for p in step.reject_all:
                    if re.search(p, reply, re.I | re.S):
                        problems.append(
                            f"reply to '{step.send}' matched FORBIDDEN /{p}/: '{reply[:160]}'")
        finally:
            if restore_needed:
                for sid_, status in station_snapshot:
                    if sid_ is not None and status:
                        api.set_station_status(sid_, status)
            if cups_disabled and cups_snapshot:
                # recreate the cups we deleted (all but the first kept one)
                for c in cups_snapshot[1:]:
                    # current_quantity is what the API requires now; with only
                    # "amount" the POST was refused (400) and every run left the
                    # event with one cup size for good.
                    r = api.s.post(f"{api.base}/api/inventory", json={
                        "name": c["name"], "category": "cups",
                        "current_quantity": c.get("amount") or 200,
                        "amount": c.get("amount") or 200,
                        "capacity": c.get("capacity") or 200,
                        "unit": c.get("unit") or "pcs",
                        "minimum_threshold": c.get("minimum_threshold") or 10,
                    }, headers=api._h(), timeout=10)
                    if r.status_code >= 400:
                        print(f"{RED}WARNING{RESET} could not recreate cup {c['name']!r}: "
                              f"{r.status_code} {r.text[:120]} -- fix it by hand in the Runner")

        # ---- backend-state verification
        if scenario.verify and not problems:
            orders = api.orders_for_name(name)
            if scenario.verify == "order_exists" and not orders:
                problems.append("verify: expected an order in the system, found none")
            elif scenario.verify == "no_order" and orders:
                problems.append(f"verify: expected NO order, found {len(orders)}")
            elif scenario.verify == "no_pending_order":
                code, payload = api.get("/api/orders/pending")
                pend = payload.get("orders") or payload.get("data") or []
                if any(name.lower() in json.dumps(o, default=str).lower() for o in pend):
                    problems.append("verify: order still pending after CANCEL")
            elif scenario.verify == "at_most_one_order" and len(orders) > 1:
                problems.append(f"verify: duplicate webhook produced {len(orders)} orders")

        ok = not problems
        failed += 0 if ok else 1
        flag = f"{GREEN}PASS{RESET}" if ok else f"{RED}FAIL{RESET}"
        print(f"{flag}  {scenario.name}")
        if not ok:
            for p in problems:
                print(f"      {YELLOW}- {p}{RESET}")
            for t in transcript:
                print(f"        > {t['send']!r}  [{t['status']}]")
                print(f"        < {t['reply'][:200]!r}")
        results.append({
            "scenario": scenario.name, "why": scenario.why, "phone": phone,
            "ok": ok, "problems": problems, "transcript": transcript,
        })

    # ---- report
    ts = time.strftime("%Y%m%d_%H%M%S")
    out = Path("logs") / f"sms_scenarios_{ts}.json"
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps(
        {"base_url": base_url, "total": len(results),
         "failed": failed, "results": results}, indent=2))
    print(f"\n{len(results) - failed}/{len(results)} scenarios passed — report: {out}")
    return 1 if failed else 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url", default=os.environ.get("SMS_SCEN_BASE", "http://localhost:5001"))
    ap.add_argument("--username", default=os.environ.get("SMS_SCEN_USER", "coffeecue"))
    ap.add_argument("--password", default=os.environ.get("SMS_SCEN_PASS", "adminpassword"))
    ap.add_argument("--only", help="run only scenarios whose name contains this")
    ap.add_argument("--list", action="store_true", help="list scenarios and exit")
    a = ap.parse_args()
    sys.exit(run(a.base_url, a.username, a.password, a.only, a.list))
