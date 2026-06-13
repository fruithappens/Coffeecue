# Deep-test program (started 2026-06-13)

Goal: a genuinely comprehensive assessment of the whole app — remnants &
hardcoded data, broken/half-wired features, config persistence, SMS
conversation correctness under every realistic scenario, real-Twilio
verification, and production-scale load. Too big for one session by design:
each phase leaves a **reusable harness** committed to the repo, so the suite
compounds instead of being one-off clicking.

Existing assets this builds on:
- `tests/smoke/smoke_test_api.py` — 31-point API contract smoke (FE/BE field
  mismatches). Run on every deploy.
- `tests/load/run_load_test.py` — throughput harness (walk-in + GET-poll +
  Twilio-shaped SMS streams, p50/p95/p99 + error rates).
- `SUPPORT_AUDIT_2026-06-12.md` — the Support-area control audit (147
  controls). The method to replicate per area.
- `UI_SELF_TEST_FINDINGS.md` — earlier browser-driven findings.

## Phase 1 — SMS conversation correctness harness  ⟵ STARTED
**Asset:** `tests/sms_scenarios/run_sms_scenarios.py`
Drives `/sms` with Twilio-shaped POSTs (the production code path, zero SMS
cost), parses the TwiML reply, asserts on BOTH the reply text and backend
state (order created? stock decremented? nothing created on refusal?).
Declarative scenario table — adding a case is ~10 lines.

Initial battery:
| Family | Scenarios |
|---|---|
| Happy path | simple order, size+milk+sugar, multi-item, friend order, usual order, VIP |
| Menu boundaries | item not on menu, milk we don't carry, sweetener we don't carry, misspelling, gibberish, empty SMS, emoji-only, very long message |
| **No silent defaults** | "latte" with no milk → must ASK, never assume (house rule) |
| Stock states | milk out of stock event-wide, out at one station only, drink ingredient depleted mid-conversation |
| Station states | all stations closed/inactive, the only capable station closed, maintenance mode |
| Conversation control | STATUS, CANCEL before/after confirm, order while one pending, change mind mid-flow ("actually make it oat") |
| Robustness | duplicate MessageSid (idempotency), rapid double-send, unknown phone vs returning customer |

Pass = correct *intent* in reply (regex) + correct DB side-effect via API.

## Phase 2 — Options & persistence matrix (browser-driven, local)
For each config dimension (milks, drinks, cups/sizes, sweeteners, extras):
1. Enable in Organiser → appears in walk-in dialog, SMS "menu" reply,
   barista stock, station inventory config.
2. Disable → disappears from all four surfaces.
3. Reload + second browser profile → persists (proves backend, not
   localStorage).
4. Station-scoped: assign subset to Station 1 → barista at Station 1 sees
   only subset; SMS routing respects capability.
5. Stock: set level → deplete via orders → low/out states propagate to SMS
   replies + barista UI; restock works.
Driven via Chrome MCP against local; screenshots + network capture archived.
Known gotcha to retest deliberately: the two-inventory-stores split
(backend `inventory_items` vs `localStorage.event_inventory`).

## Phase 3 — Remnant & hardcoded sweep, remaining areas
Replicate the Support-audit method (parallel agents tracing every control →
handler → endpoint → registered? → real?) for: **Organiser** (all tabs),
**Barista** (all sub-tabs), **Landing**, **Display screen**, **mobile QR
tracker**. Output: per-area audit doc + fix/signpost commits. Also grep-level
sweeps: hardcoded arrays/numbers, `setTimeout`-fake-success, localStorage
writes with no backend twin, TODO/FIXME inventory.

## Phase 4 — Real Twilio end-to-end (production, ~$0.20 total)
1. Verify webhook config points at the Railway URL `/sms`; signature
   validation behavior confirmed (unsigned POST must be rejected in prod).
2. Signed synthetic inbound (computed with the account's auth token,
   locally) → proves the full prod path free of charge.
3. ONE real SMS from Steve's phone: order → confirm reply → barista
   completes → "ready" SMS back. That's 2-3 segments (~$0.20), the only
   credits the whole program burns.
4. Cross-check Twilio console logs (delivery receipts, error codes).

## Phase 5 — Production-scale load test (the "400 conversations" run)
Target: 400 concurrent multi-turn SMS conversations + barista polling +
walk-ins, against Railway.
- **Where:** a staging clone of the Railway service (same Postgres tier,
  `TESTING_MODE=true`) — NOT prod with real Twilio creds, so a bug can't
  blast real texts; outbound is stubbed, inbound is synthetic.
- **What we measure:** p50/p95/p99 reply latency, error rate, DB pool
  exhaustion (psycopg2 pool size), eventlet worker saturation, Railway
  CPU/mem (via the now-live `/api/diagnostics/performance`), SocketIO fanout
  lag, barista UI with a 400-deep queue (render perf + the bounded avg-wait).
- Ramp: 50 → 100 → 200 → 400; find the knee, document in
  `tests/load/RESULTS.md` for the deployment-sizing doc.

## Phase 6 — Combination / chaos scenarios
The "what combinations might happen" pass — each scripted, not ad-hoc:
- Config changed mid-flight: milk disabled while an order using it is
  pending; station closed with queued orders (re-route? orphan?).
- Two baristas claim the same order simultaneously.
- Customer orders at 1 min before closing; event end-time passes with
  orders in flight.
- Frontend offline → orders taken → reconnect (offline queue replay).
- JWT expires mid-shift at the barista screen.
- Group/friend orders crossing station capability boundaries.
- Quick Setup re-run mid-event (drift preview accuracy vs live data).

## Cadence & tracking
One phase ≈ one session. Findings: quick fixes land on the working branch
same-session; bigger items become tracked tasks. Every phase's harness gets
a README and a one-command entry point so it can re-run on any deploy.
