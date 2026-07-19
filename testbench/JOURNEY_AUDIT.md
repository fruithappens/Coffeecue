# Journey Audit — every actor journey vs its tests

The accountability table (2026-07-20): for each journey, WHAT INPUT the
test drives, WHAT OUTPUT/DISPLAY it checks, and the EXPECTED vs ACTUAL
oracle. "Traced" = followed continuously with side-effects asserted at
each stage; "piecewise" = each stage asserted by separate checks.

Legend: ✅ traced end-to-end · 🧩 piecewise (all stages covered, seams not
one test) · 👁 UI-clicked (Cypress) · ⬜ gap.

## CUSTOMER journeys

| Journey | Input driven | Outputs/displays asserted | Oracle (expected vs actual) | Status |
|---|---|---|---|---|
| Order → collect (the core) | real SMS text via simulate | confirm reply; pending queue; barista feed + station; queue pill; wait; STOCK level; batch key; in-progress board; READY board; recorded ready-SMS text; picked-up; history; today's report | `pipeline` suite: 15 asserts, one order, every stage | ✅ |
| Order for friends (group) | full FRIEND conversation ×2 + DONE | one group id on barista feed; ONE station; start-group; ready board ×3; SMS count (3 → flagged); collected; archived | `group_pipeline`: 10 asserts | ✅ |
| Kiosk walk-up | real clicks through the touch wizard | order number on success screen; backend order exists; barista board shows it (incl. decaf) | `ui_kiosk_order` + `ui_barista_board` | ✅👁 |
| VIP | VIP code → order (after a normal order) | activation; flag on pending card; **QUEUE JUMP proven** (later VIP ahead of earlier normal); made; ready-SMS recorded; collected; archived flag intact | `vip_pipeline` (+ `vip` suite for persistence/friend rules) | ✅ |
| Walk-in (barista enters) | real dialog clicks + API pipeline | POST accepted; queued/station; NOT accidentally VIP; stock UNCHANGED at create + DOWN at completion (design difference pinned); ready board; NO SMS (phoneless); collected; archived | `walkin_pipeline` + `ui_messages_walkin` | ✅ |
| CANCEL: pending / mid-make / ready | SMS CANCEL at each stage | order gone from queue; honest "being made" reply; honest "waiting at Station X" reply | journeys: cancel-after-confirm / while-making / after-ready | ✅ (3 stages each traced) |
| STATUS (none / queued / group) | SMS STATUS | "no orders" / number+station+wait / related-orders list | vocab + customer + pipeline stage 3 | ✅ |
| Question to barista + reply loop | BARISTA question, then a reply | Messages-bubble badge count (UI); inbox content; reply NOT eaten by order bot; tagged to order | `journey_message_reply` + `ui_messages_walkin` | ✅👁 |
| Returning customer (USUAL / "hi") | order, cancel, then USUAL / greeting | exact saved drink+milk replayed; welcome-back greeting | customer suite | 🧩 |
| CHANGE mid-confirm | "CHANGE milk to X" | updated summary, only that field changed | customer suite | 🧩 |
| Courtesy reply after pickup | "coming now, thanks!" | absorbed silently, NO new order, no cost | `journey_ready_reply` | ✅ |
| FORGET ME | full delete conversation | confirm step; deletion confirmed; truly a stranger after | `journey_forget_me` | ✅ |
| Hostile/edge input | emoji, 600 chars, SQL-ish… | never crashes, stays on-topic | edge_input suite | 🧩 |
| Combination space | all-pairs channel×drink×milk×size×sugar + modifiers + techniques | accept/refuse correctness; station capability; card truth (decaf/strong/extra-hot); cancel reversibility | matrix (20+ scenarios/run) | 🧩 by design (breadth) |

## BARISTA journeys

| Journey | Input driven | Outputs asserted | Oracle | Status |
|---|---|---|---|---|
| See the queue truthfully | (state built via API) | pills == live pending+in-progress; wait scales with load; batch groups only at 2+ | stations suite guard + queue_wait + Cypress | ✅ |
| Start → Complete via buttons | real clicks on the card | leaves pending; ready board; backend cross-check | `ui_barista_actions` | ✅👁 |
| Process Batch | real click | both orders started together | `ui_batch_display_modes` (+ strangers-guard) | ✅👁 |
| Delay | real click | honest "not supported" alert; order untouched | `ui_messages_walkin` | ✅👁 |
| Move/reassign | API reassign | station changes; incapable station REFUSED | `journey_reassign` | 🧩 |
| Message customer + reply | dry-run message, simulated reply | reply reaches inbox tagged; on the order's card (via messages endpoint) | `journey_message_reply` | ✅ |
| Report low stock | API report-low | alert visible in low-stock list; resolvable | alerts suite | 🧩 |
| Station chat | real typing in the panel | message in backend chat log | `ui_chat_schedule` | ✅👁 |
| Collect (ready → picked up) | API pickup + pipeline | off ready board; picked_up history | pipeline + order_extras | ✅ |

## ORGANISER journeys

| Journey | Input driven | Outputs asserted | Oracle | Status |
|---|---|---|---|---|
| Configure stations | UI rename via real form; API CRUD | backend station list reflects it; delete-with-orders refused; paused station gets NO orders | `ui_organiser_rename` + station_lifecycle | ✅👁 |
| Configure inventory | API create/adjust/delete | listed; level correct (both columns); threshold flips status; deletable | inv_crud + alerts + stock suites | 🧩 |
| Branding (incl. big image) | real file uploads | oversized → VISIBLE error; valid logo → BACKEND blob; display + SMS carry event name | `ui_branding` + settings suite | ✅👁 |
| Pricing | API round-trip | SMS total + barista card price; exact restore | settings suite | 🧩 |
| SMS templates | API round-trip | rendered customer message carries the template | settings suite | ✅ |
| Roster | API shift CRUD | visible on barista Schedule tab; name persists | sched_crud + `ui_chat_schedule` | 🧩 |
| Breaks | API break CRUD | orders route ONLY to open stations during the window | breaks suite | ✅ |
| FULL event lifecycle (setup→run→report→wipe) | — | — | needs a disposable test event | ⬜ (parked with Quick Setup e2e) |

## SUPPORT journeys

| Journey | Input driven | Outputs asserted | Oracle | Status |
|---|---|---|---|---|
| Monitor (9 tabs) | real tab clicks | every tab renders without crash | `ui_support` | 👁 open-only |
| SMS blocklist | API block/unblock | listed / unlisted; blocked number ignored by gate | blocklist + burst suites | ✅ |
| Abuse throttle | 13-message flood | gate trips at 13, stays paused, bystander fine | burst suite | ✅ |
| Emergency controls | — | — | deliberately NEVER auto-tested | ⬜ by choice |

## The named gaps, honestly (updated 2026-07-20 pm)
1. ~~VIP as a full pipeline~~ **DONE** — `vip_pipeline`, incl. the
   queue-jump proof.
2. ~~Walk-in as a full pipeline~~ **DONE** — `walkin_pipeline`; pinned
   the design difference: walk-ins decrement stock at COMPLETION (the
   moment the drink is made), SMS/kiosk at creation.
3. **Organiser full event lifecycle** — needs a disposable test event.
4. **Emergency tab actions** — untested by choice; verify by hand once.
5. **Real Twilio delivery** — by design out of scope; covered by the
   group live-test tool (`run_group_test.sh`) on real phones.
