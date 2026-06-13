# SMS scenario harness — Phase 1 baseline findings (2026-06-13)

Run: `python tests/sms_scenarios/run_sms_scenarios.py` against local backend
(same code as the deployed branch). Baseline: **11/15 pass**. Every failure
is a real product bug, kept as a deliberately-failing scenario so the suite
flips green when (and only when) the bug is fixed.

## ✅ What's verified working (customer-correct behaviour)

- Full stranger-to-coffee flow: name → drink → milk → size → sugar →
  confirm → order lands in the pending queue.
- **No-silent-defaults house rule holds for "latte"/"cappuccino"** — bot
  asks for milk, never assumes.
- Item not on menu → "Sorry, we don't have frappe today. Available: …"
  (graceful, lists real catalogue, no phantom order).
- Milk we don't carry → "Sorry, we don't have coconut milk. Available
  milks: almond, full cream, lactose free, oat, skim."
- STATUS / CANCEL with and without orders — all correct, CANCEL really
  cancels (verified via API).
- "no sugar" as natural phrasing at the sugar prompt — accepted.
- Gibberish + emoji and empty SMS bodies — graceful clarifying replies,
  no 5xx.
- **All stations closed → customer IS refused at confirm**: "Sorry, no
  coffee stations are currently available." No order created.

## 🔴 Real bugs found (each has a failing scenario)

1. **`flat_white_no_silent_defaults`** — "small flat white" skips every
   question and jumps straight to a confirm pre-filled with **full cream
   milk and 1 sugar** the customer never chose. Violates the house rule;
   inconsistent with latte/cappuccino which ask. Likely the NLP fast-path
   applies defaults when it "fully" parses a message.
2. **`size_in_first_message_respected`** — "large latte" drops the size;
   bot asks "What size?" later. The greeting itself advertises
   "small oat latte 1 sugar" as the format, so this path matters.
3. **`size_answer_respected`** — worse: the explicit ANSWER to the size
   question is dropped. Customer says "medium", confirmation reads
   "**small** latte". Wrong cup at pickup, real-world impact.
   (2 and 3 are probably the same root cause in size handling.)
4. **`duplicate_message_sid`** — no webhook idempotency. Replaying the
   same MessageSid (which Twilio does on retry) is processed as a NEW
   message and corrupted the conversation ("large latte" retry was
   interpreted as a milk answer). Fix: dedupe by MessageSid with a short
   TTL cache/table; replay the previous reply.

## 🟠 Polish (observed, not failing scenarios)

- Stations-closed refusal only arrives AFTER the customer answers four
  questions — should short-circuit at first contact ("We're closed").
- The refusal copy is organiser-speak: "Please contact the organizer to
  set up stations" — a customer can't action that.
- Confirm shows "Total: $4.00 — pay at the counter" — verify pricing is
  intentional per event (some events are sponsor-free).

## Next battery to add (Phase 1 continuation)

Out-of-stock milk (deplete via API first), station-capability routing
(only one station carries oat), VIP code flow, friend/group flow, usual
order for returning customer, MENU reply cross-checked against the
inventory API, mid-flow "actually make it oat" edits, rapid double-send
(different sids), conversation timeout behaviour.
