# Coffee Cue — Functional Coverage Map & Testing Roadmap

**The master plan for testing everything.** This inventory is *derived from the
code itself* — every API route, SMS keyword, screen and settings blob the app
actually has — so nothing depends on someone remembering a feature. When the
app grows, re-run the enumeration commands (bottom) and the new surface shows
up here as unticked rows.

---

## ⏯ RESUME HERE — for the next session told to "continue testing"

**State of play (updated 2026-07-18):** 20 suites, last full run **103 pass /
0 fail / 1 warn** (the warn is the schedule design note — informational, not a
bug). Phases A and B below are DONE. The queue that follows is the agreed next
work, in priority order — Steve has approved building **all** of it.

**How to run the bench (no password handling — creds live in a gitignored env
file the operator maintains):**
```bash
bash testbench/run_bench_auth.sh --suites all \
  --allow-lifecycle --allow-blocklist --allow-settings --allow-station-lifecycle
```
Reports land in `testbench/reports/<stamp>/` (`report.html` + `feedback.md` —
feedback.md is written to be pasted into a repair session).

**Non-negotiable rules for any new suite (learned the hard way):**
1. **Zero real SMS.** All conversation via `POST /api/sms/simulate`. Fake
   phones must be VIRGIN per run (`rn.next_phone()` derives from a uuid).
   Barista-message tests use the `dry_run`/`test_no_send` flag.
2. **Self-cleaning, in `finally`.** Orders named `ZZBench*` and always
   cancelled; any mutated setting/stock captured first and restored even on
   failure. (An early settings test left `order_prefix='ZT'` on prod — real
   customers got ZT-numbers. Never again.)
3. **Mutations are opt-in** via an `--allow-*` flag wired through
   `run_bench.py` → `rn.options`; without the flag the suite returns a `skip`
   result explaining what it would do.
4. **Test the EFFECT, not the echo.** Read a written setting back by what it
   changes (an order number's prefix, a menu's milks), not by trusting the
   settings GET. Follow every action to its consequence — the barista-reply
   bug lived in the gap *between* two features that each "worked".
5. **Prod is live.** The bench runs against the real Railway app. Keep tests
   short, restore fast, and never touch the 4 real stations' config outside
   the opt-in station-lifecycle suite (which creates its OWN station).

**The build queue (do these in order):**

| # | Item | Where | Spec / done-when |
|---|---|---|---|
| 1 | **Customer-memory suite** | new `bench/suites_customer.py` | (a) USUAL: fresh phone orders + confirms, then texts USUAL → offered/placed the same drink (customer memory works). (b) Same-name collision: two phones, same first name, orders to the same station → two DISTINCT order numbers, both in pending. (c) Group of 3+: FRIEND×2 then DONE → all confirm, all queued. (d) CHANGE/EDIT keyword mid-order → order actually changes. All simulate, self-cleaning. |
| 2 | **Settings round-trips** | extend `suite_settings` in `bench/suites_coverage.py` (under `--allow-settings`) | (a) event_name: read current via display config → write test value → SMS welcome to a fresh phone AND `GET /api/display/config` carry it → restore exact original → verify restored. (b) unlimited_stock_mode: toggle on → a normally-unavailable milk is ACCEPTED → toggle off → refused again. Both restore in `finally`. |
| 3 | **Stress suite** | new `bench/suites_stress.py` | (a) Empty stock (new `--allow-stock-mutation`): capture a milk row's level → adjust to 0 → SMS-order that milk → expect refusal or explicit warning, NOT silent acceptance → restore exact level in `finally`. Answers a question nobody has asked the app. (b) Burst throttle: 13 rapid simulate texts from ONE fake phone → the anti-spam guard should trip (blocked/silent/429) — first read the throttle code in `routes/sms_routes.py`/`services/coffee_system.py` to pin the designed behaviour; if none exists, emit a `warn` saying so. |
| 4 | **Matrix dimension expansion** | `bench/suites_matrix.py` | Add dimensions: decaf (yes/no), shots (single/double), and tea/hot-chocolate as drink types. FIRST probe what `services/nlp.py` + the kiosk payload accept. Keep all-pairs output ≤ ~25 scenarios. Stretch goal: a "stressed matrix" variant that reruns a few scenarios while a bench-created station is paused. |
| 5 | **Backend `test_no_send` + cancel-while-making journey** | backend PR + `bench/suites_journeys.py` | Add the message endpoint's `test_no_send` flag to `POST /orders/<id>/start` and `/complete` (skip Twilio, still record + transition). Then journey: start a fake-phone order (test_no_send) → customer texts CANCEL → order leaves in-progress; check what the barista would see (in-progress list + any flag). Codifies the designed answer to "customer cancels mid-make". |
| 6 | **Reminder-reply routing journey** | `bench/suites_journeys.py` | The pickup-reminder SMS invites a reply; verify a customer's reply after a reminder is NOT parsed as a new order (same class as the barista-reply-loop bug, different entry point). Needs test_no_send from item 5. |
| 7 | **Pickup + batch endpoints** | `bench/suites.py` (orders) | `POST /orders/<id>/pickup` transitions completed→picked-up; `POST /orders/batch/process` on 2 bench orders. Opt-in with `--allow-lifecycle`. |
| 8 | **Break-window routing** | new opt-in `--allow-breaks` | Create a temporary event break covering NOW → new order gets the break message / correct handling → delete the break in `finally`. (The #92 fix has no live guard yet.) |

**Parked (do NOT build until their trigger):**
- **Role-gate / permissions suite** — Steve wants this as part of his pre-live
  security sweep; build it when he asks for the sweep. (Spec: barista token
  calling organiser/support/admin endpoints must 403; the deny-list from PR
  #50 is the reference.)
- **Quick Setup end-to-end** — destructive (wipes inventory). Only against a
  disposable test event, with Steve's explicit go.
- **Phase C: Cypress UI tests** — the bench can't click. Highest-value paths:
  barista Orders tab (claim→start→complete), Organiser stations + inventory
  save, kiosk touch flow, branding save (the big-image silent-failure trap).
  Cypress is already installed in `"Barista Front End"`.

---

## How new scenarios get discovered (the method, not guesswork)

1. **Enumerate** — the code is the truth: 321 API routes, 32 SMS keywords,
   11 organiser sections, 12 barista tabs, 9 support tabs, 9+ settings blobs.
2. **Cross** — for each function, cross it with the standard dimensions:
   *channel* (SMS/kiosk/walk-in/API) × *state* (fresh vs returning customer,
   station active/paused/deleted, stock full/low/empty, inside/outside a
   break) × *input class* (typical, empty, huge, emoji/unicode, wrong type).
3. **Transition-test** — many bugs live *between* states: create → configure →
   pause → delete a station **while orders are in flight**; change branding
   mid-event; block a number mid-conversation.
4. **Mine production** — the post-event report already collects errors,
   stuck orders and unanswered SMS; every real incident becomes a permanent
   bench check (that's how the oat, "Thanks Last", stock-drift and
   barista-reply bugs got guards).

Legend: ✅ bench-covered · 🟡 partial · ⬜ not yet · 👁 UI-only (needs eyes or
Cypress) · ⚠️ mutating (needs opt-in / test event)

---

## 1. Ordering (the core loop)
| Function | Status | Notes |
|---|---|---|
| SMS one-shot order → confirm → cancel | ✅ | sms suite |
| SMS step-by-step (drink→milk→size) | ✅ | matrix (sms channel) |
| Kiosk order (phoneless) → queue → cancel | ✅ | orders suite |
| Order matrix: channel×drink×milk×size×sugar | ✅ | 16–20 all-pairs scenarios |
| Matrix extra dims: decaf, shots, tea/hot-choc | ⬜ | queue item 4 |
| Unavailable milk refused (SMS + kiosk) | ✅ | sms + matrix |
| Walk-in order via barista dialog | ⬜👁 | API exists (`POST /orders`); Cypress |
| Start → complete lifecycle | ✅⚠️ | opt-in in orders suite |
| Pickup / picked-up state | ⬜ | queue item 7 |
| Batch processing | ⬜ | queue item 7 |
| VIP order priority (code entry → queue jump) | ✅⚠️ | vip suite |
| Group/FRIEND orders (2 people) | ✅ | group suite |
| Group with 3+ friends / DONE | ⬜ | queue item 1c |
| Returning-customer USUAL order | ⬜ | queue item 1a — high value |
| Order edit (CHANGE/EDIT keywords) | ⬜ | queue item 1d |
| Same name × same station collision | ⬜ | queue item 1b |
| Order search / history / statistics | 🟡 | stats suite pings statistics only |

## 2. SMS conversation vocabulary
| Group | Keywords | Status |
|---|---|---|
| Order flow | YES NO Y N DONE END FINISH | 🟡 (YES/NO via group; DONE in queue item 1c) |
| Info | MENU INFO OPTIONS COMMANDS HELPME | ✅ sms_vocab |
| Order mgmt | CANCEL STATUS CHANGE EDIT | 🟡 (CANCEL, STATUS ✅; CHANGE/EDIT queue item 1d) |
| Social | FRIEND GROUP ANOTHER | 🟡 (FRIEND ✅) |
| Identity/privacy | DELETE, FORGET ME, MYDATA, RESET | ✅ forget-me journey verifies TRUE deletion |
| Ops | STAFF BARISTA USUAL STOP | ✅ vocab (USUAL flow itself = queue item 1a) |
| Edge inputs | emoji, 600-char, unicode, numbers, sql-ish | ✅ edge_input suite |
| Barista-reply state (customer answers a barista SMS) | ✅ | journey_message_reply — the 2026-07-16 live bug's guard |

## 3. Stations
| Function | Status | Notes |
|---|---|---|
| List + status + queue + wait sanity | ✅ | stations suite |
| Capability-aware routing (live) | ✅ | routing suite |
| Create → active → pause → reopen → delete ⚠️ | ✅ | station_lifecycle suite, self-cleaning own station |
| Delete with orders in flight ⚠️ | ⬜ | extend station_lifecycle |
| Rename / custom name propagation | ⬜👁 | localStorage vs backend — Cypress |
| Capabilities edit → menu updates | 🟡 | consistency checked read-only |
| Station defaults / walkin-defaults | ⬜ | 2 endpoints nobody tests |
| Chat between stations | ⬜ | 7 chat endpoints |

## 4. Settings, branding & customisation
| Function | Status | Notes |
|---|---|---|
| order_prefix → order numbers ⚠️ | ✅ | settings suite — reads prefix by EFFECT, always restores |
| event_name → SMS + display ⚠️ | ⬜ | queue item 2a |
| unlimited_stock_mode ⚠️ | ⬜ | queue item 2b |
| branding_settings (logo, colours, backgrounds) | ⬜👁 | Cypress — the big-image silent-save trap |
| pricing_settings | ⬜ | order response carries price |
| vip_code | ✅⚠️ | via vip suite |
| sms_started_policy / SMS templates | ⬜ | wording changes reach customers |
| Display config propagation | 🟡 | display suite reads config; toggles untested |

## 5. Inventory & stock
| Function | Status | Notes |
|---|---|---|
| Order decrements milk/cups/coffee | ✅ | stock suite + server self-report (stock_debug) |
| Cancel restocks exactly | ✅ | stock suite |
| Quantity twin-columns agree (amount vs current_quantity) | ✅ | drift guard — caught the #106 bug class |
| Adjust / restock endpoints write BOTH columns | ✅ | PRs #106/#107; watch for new single-column writers |
| Low-stock warning + report-low | ⬜ | drive a row to threshold → alert visible? |
| Empty stock → ordering behaviour ⚠️ | ⬜ | queue item 3a |
| Event inventory ↔ station configs ↔ menu | ✅ | inventory + display suites |

## 6. Schedule & event lifecycle
| Function | Status | Notes |
|---|---|---|
| Today's schedule endpoint | ✅ | schedule suite (+ standing design note: shifts are informational) |
| Shift CRUD + check-in | ⬜ | schedule_api routes |
| Event BREAKS → routing during breaks ⚠️ | ⬜ | queue item 8 (#92 fix has no live guard) |
| Quick Setup end-to-end ⚠️ | ⬜ | PARKED — destructive |

## 7. People & access
| Function | Status | Notes |
|---|---|---|
| Login + token authorises | ✅ | auth suite |
| Role gates (barista vs organiser vs support) | ⬜ | PARKED for Steve's security sweep |
| User CRUD ⚠️ | ⬜ | with the security sweep |
| FORGET ME truly erases | ✅ | journey re-asks the name after deletion |

## 8. Monitoring & comms
| Function | Status | Notes |
|---|---|---|
| Today report shape + stats | ✅ | stats suite |
| SMS abuse: blocklist roundtrip ⚠️ | ✅ | opt-in |
| Burst throttle trips | ⬜ | queue item 3b |
| Barista message → customer reply → inbox | ✅ | journey (dry_run, zero real SMS) |
| Carrier duplicate SMS deduped | ✅ | backend (#97); implicit in sms suites |
| Broadcast messages ⚠️ | ⬜ | real-SMS risk — design first |
| Support diagnostics/health/emergency | ⬜👁 | Cypress |
| Integrations (EventsAir stub) | ⬜ | Phase 0 scaffold, needs EA API key |

## 9. Cross-actor journeys (functions × people — where design gaps hide)
| Journey | Status | Notes |
|---|---|---|
| Barista messages customer → reply reaches inbox tagged | ✅ | journey_message_reply |
| Customer texts CANCEL while barista mid-make | ⬜ | queue item 5 |
| Reminder SMS → customer replies | ⬜ | queue item 6 |
| Barista edits order the customer then modifies by SMS | ⬜ | conflict rules undefined — design first |
| Two customers, same name, same station | ⬜ | queue item 1b |
| FORGET ME → truly forgotten | ✅ | journey |
| Cancel after confirm → gone from queue | ✅ | journey |

## 10. UI-only surface (Phase C — Cypress)
Barista: 12 tabs + Messages bubble + walk-in/wait dialogs. Organiser: 11
sections. Support: 9 tabs. Display: orders/pickup modes + kiosk touch flow.
Mobile layouts for all three. Cypress is installed; start with the
click-paths listed in the parked section above.

---

## Phase history
- **Phase A (done):** sms_vocab (all keywords), edge_input, settings
  round-trip (order_prefix), journeys (message-reply / forget-me /
  cancel-after-confirm), coverage map itself.
- **Phase B (done):** VIP end-to-end, station lifecycle
  create→pause→reopen→delete, stock drift guard, matrix (all-pairs),
  queue/wait/routing/group suites. Validated live 2026-07-18: 103/0/1.
- **Phase B+ (this queue):** items 1–8 above.
- **Phase C (after B+):** Cypress UI automation.
- **Security sweep (on Steve's word):** role gates, user CRUD, auth edges.

## Re-enumerating the surface (run when the app grows)
```bash
grep -hE "@[a-z_]*\.route\(" routes/*.py | wc -l            # API routes
grep -oE "message_upper (==|in) [^:]+" services/coffee_system.py  # SMS keywords
grep -oE "activeSection === '[a-z-]+'" "Barista Front End/src/components/organiser/OrganiserInterface.js"
```
