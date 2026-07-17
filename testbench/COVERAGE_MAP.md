# Coffee Cue — Functional Coverage Map

**The master plan for testing everything.** This inventory is *derived from the
code itself* — every API route, SMS keyword, screen and settings blob the app
actually has — so nothing depends on someone remembering a feature. When the
app grows, re-run the enumeration commands (bottom) and the new surface shows
up here as unticked rows.

**How new scenarios get discovered (the method, not guesswork):**
1. **Enumerate** — the code is the truth: 321 API routes, 32 SMS keywords,
   11 organiser sections, 12 barista tabs, 9 support tabs, 9+ settings blobs.
2. **Cross** — for each function, cross it with the standard dimensions:
   *channel* (SMS/kiosk/walk-in/API) × *state* (fresh vs returning customer,
   station active/paused/deleted, stock full/low/empty, inside/outside a
   break) × *input class* (typical, empty, huge, emoji/unicode, wrong type).
   That's the same all-pairs matrix idea, applied per domain.
3. **Transition-test** — many bugs live *between* states: create → configure →
   pause → delete a station **while orders are in flight**; change branding
   mid-event; block a number mid-conversation.
4. **Mine production** — the post-event report already collects errors,
   stuck orders and unanswered SMS; every real incident becomes a permanent
   bench check (that's how the oat, "Thanks Last", and stock bugs got guards).

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
| Unavailable milk refused (SMS + kiosk) | ✅ | sms + matrix |
| Walk-in order via barista dialog | ⬜👁 | API exists (`POST /orders`); add a bench check + UI pass |
| Start → complete lifecycle | 🟡⚠️ | opt-in in orders suite |
| Pickup / picked-up state | ⬜ | `POST /orders/<id>/pickup` |
| Batch processing | ⬜ | `POST /orders/batch/process` |
| VIP order priority (code entry → queue jump) | ⬜⚠️ | needs vip_code from settings |
| Group/FRIEND orders (2 people) | ✅ | group suite |
| Group with 3+ friends / DONE / EDIT | ⬜ | extend group suite |
| Returning-customer USUAL order | ⬜ | the "ghost" domain — high value |
| Order edit (CHANGE/EDIT keywords) | ⬜ | |
| Order search / history / statistics | 🟡 | stats suite pings statistics only |

## 2. SMS conversation vocabulary (32 keywords, ~6 covered)
| Group | Keywords | Status |
|---|---|---|
| Order flow | YES NO Y N DONE END FINISH | 🟡 (YES/NO via group) |
| Info | MENU INFO OPTIONS COMMANDS HELPME | 🟡 (MENU only) |
| Order mgmt | CANCEL STATUS CHANGE EDIT | 🟡 (CANCEL, STATUS) |
| Social | FRIEND GROUP ANOTHER NO FRIEND(S) | 🟡 (FRIEND) |
| Identity/privacy | DELETE, FORGET ME, MYDATA, RESET | ⬜ high value (privacy claims must be true) |
| Ops | STAFF BARISTA USUAL STOP | ⬜ (BARISTA feeds Messages inbox) |
| Edge inputs | emoji, 500-char text, wrong language, numbers only | ⬜ |

## 3. Stations
| Function | Status | Notes |
|---|---|---|
| List + status + queue + wait sanity | ✅ | stations suite |
| Capability-aware routing (live) | 🟡 | routing suite (returning-customer case open) |
| Create a station ⚠️ | ⬜ | `POST /api/stations` — create, verify it routes, delete |
| Delete a station ⚠️ | ⬜ | with + without orders in flight |
| Pause (maintenance) mid-event ⚠️ | ⬜ | orders must stop flowing; existing orders visible |
| Reopen ⚠️ | ⬜ | routing resumes |
| Rename / custom name propagation | ⬜👁 | localStorage vs backend — known two-stores risk |
| Capabilities edit → menu updates | 🟡 | consistency checked read-only |
| Station defaults / walkin-defaults | ⬜ | 2 endpoints nobody tests |
| Chat between stations | ⬜ | 7 chat endpoints |

## 4. Settings, branding & customisation
| Function | Status | Notes |
|---|---|---|
| branding_settings (name, colours, logo, backgrounds) ⚠️ | ⬜👁 | save → reload → still there; big-image failure case is a known trap |
| event_name → SMS + display | ⬜ | set → check welcome text + display config |
| order_prefix → order numbers | ⬜ | set "T" → next order is T-prefixed |
| pricing_settings | ⬜ | order response carries price |
| vip_code | ⬜⚠️ | ties into VIP scenario |
| unlimited_stock_mode | ⬜ | changes milk availability logic |
| sms_started_policy / SMS templates | ⬜ | wording changes reach customers |
| printer_config | ⬜👁 | likely dormant feature — verify or flag |
| Languages / i18n | — | **not built** (English only) — a roadmap item, not a test gap |
| Display config propagation (18 settings endpoints) | 🟡 | display suite reads config; toggles untested |

## 5. Inventory & stock
| Function | Status | Notes |
|---|---|---|
| Order decrements milk/cups/coffee | 🟡 | stock suite; server now self-reports (stock_debug) |
| Adjust / restock endpoints | 🟡 | used by bench restore |
| Low-stock warning + report-low | ⬜ | drive a row to threshold → alert visible? |
| Empty stock → ordering behaviour | ⬜⚠️ | milk at 0: refused or warned? |
| Restock requests list | ⬜ | |
| Event inventory ↔ station configs ↔ menu (3 stores) | ✅ | inventory + display suites |

## 6. Schedule & event lifecycle
| Function | Status | Notes |
|---|---|---|
| Today's schedule endpoint | ✅ | schedule suite |
| Shift CRUD + check-in | ⬜ | schedule_api routes |
| Event BREAKS → routing during breaks | 🟡⚠️ | hole fixed (#92); needs a live break test with a test break |
| Event templates (4 endpoints) | ⬜ | |
| Quick Setup end-to-end ⚠️ | ⬜ | wipes inventory — test-event only |
| Roster gating routing | — | **not built** (design note in every report) |

## 7. People & access
| Function | Status | Notes |
|---|---|---|
| Login + token authorises | ✅ | auth suite |
| Role gates (barista vs organiser vs support) | ⬜ | call admin endpoints with a barista token → must 403 |
| User CRUD ⚠️ | ⬜ | create/toggle/reset-password/delete |
| Customer data: MYDATA / FORGET ME truly erases | ⬜ | privacy promise — verify |

## 8. Monitoring & comms
| Function | Status | Notes |
|---|---|---|
| Today report shape + stats | ✅ | stats suite |
| Print/email report | ⬜👁⚠️ | email = real send |
| SMS abuse: blocklist roundtrip | ✅⚠️ | opt-in |
| Burst throttle trips + alert | ⬜ | simulate 13 rapid texts (fake number) |
| Messages inbox: BARISTA question → reply | ⬜ | reply path sends SMS — needs care |
| Broadcast messages ⚠️ | ⬜ | real SMS risk — TESTING_MODE-gated design |
| Support diagnostics/health/emergency | ⬜👁 | |
| Integrations (EventsAir stub, 5 endpoints) | ⬜ | Phase 0 scaffold |

## 9. Cross-actor journeys (functions × people — where design gaps hide)
Lesson from live use (2026-07-16): a barista's "Message Customer" and the SMS
order bot each worked perfectly, but a customer's REPLY to the barista had
nowhere to go — it fell into the order bot ("What's your first name?" after
"did you want sugar"). **Function-level testing cannot catch a link that was
never designed**; these journey rows exist so each gets a designed expectation
and then a test.
| Journey | Status | Notes |
|---|---|---|
| Barista messages customer → customer replies → reply reaches that barista | 🟡 | reply now forwards to Messages inbox tagged with order+station (fix shipped); bench journey test to add |
| Customer texts CANCEL while barista is mid-make | ⬜ | barista should see it disappear/flag |
| Reminder SMS ("grab it before it goes cold") → customer replies | ⬜ | same reply-routing question |
| Barista edits an order the customer then modifies by SMS | ⬜ | conflict rules undefined |
| Two customers, same name, same station, overlapping orders | ⬜ | pickup confusion guard |

## 10. UI-only surface (needs eyes or Cypress — the bench can't click)
Barista: 12 tabs (Orders, Stock, Completed, Tools, Inventory-AI, Schedule,
Display, Queue AI, Balance, Capabilities, Staff, Settings) + Messages bubble +
walk-in/wait dialogs. Organiser: 11 sections. Support: 9 tabs. Display:
orders/pickup modes + kiosk touch flow. Mobile layouts for all three.
**Plan:** keep the shared-session eyeball sweeps for visual truth; wire
Cypress (already in the repo) for the highest-value click-paths as Phase C.

---

## Phased roadmap
- **Phase A — next (API-testable, low risk):** SMS vocabulary suite (all 32
  keywords incl. FORGET ME/MYDATA truth-check), role-gate security suite,
  settings round-trips (event_name, order_prefix, unlimited stock), USUAL /
  returning-customer suite (the ghost), edge-input suite (emoji/huge/empty).
- **Phase B — opt-in mutations (run against a test event):** station
  lifecycle (create→pause→reopen→delete with orders in flight), empty-stock
  behaviour, VIP end-to-end, break-window routing with a temporary break,
  burst-throttle trip, Quick Setup end-to-end.
- **Phase C — UI automation:** Cypress smoke for barista Orders tab,
  organiser Stations + Inventory, kiosk touch flow; visual branding check.

## Re-enumerating the surface (run when the app grows)
```bash
grep -hE "@[a-z_]*\.route\(" routes/*.py | wc -l            # API routes
grep -oE "message_upper (==|in) [^:]+" services/coffee_system.py  # SMS keywords
grep -oE "activeSection === '[a-z-]+'" "Barista Front End/src/components/organiser/OrganiserInterface.js"
```
