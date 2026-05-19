# Handoff notes for the next Claude session

**Last updated:** 2026-05-19 by an overnight Claude session.
**Branch:** `claude/serene-shamir-6a017a`. Worktree path uses spaces in `Barista Front End/` — quote when `cd`.

## The user's brief (one-liner)

> "App worked quite well but had some issues — mainly hardcoded data, SMS data being ignored, and not asking the right questions, just assuming OK and sending the order anyway."

If you're starting fresh, read [README.md](README.md) and [CLAUDE.md](CLAUDE.md) first. **Beware**: this repo has *a lot* of stale `.md` files and several superseded source files (`OrderDataService.original.js`, `OrderDataService.refactored.js`, `AuthService.improved.js`, etc.). Treat the docs as historical — verify against code.

## Update 2026-05-19 (later that day): four customer-facing wins shipped + E2E live-tested

Shipped, with tests in [test_sms_conversation_flow.py](test_sms_conversation_flow.py) (19 unit tests) and [test_e2e_event_scenario.py](test_e2e_event_scenario.py) (15 live HTTP scenarios driving the real backend on a fresh Postgres DB):

- **Friendly running order numbers** ("#1, #2, #3…") via a Postgres sequence. Falls back silently to the legacy `A1402153` format if the sequence isn't installed, so this works on any DB without a migration. Migration script: [migrations/2026_05_19_friendly_order_numbers.py](migrations/2026_05_19_friendly_order_numbers.py). Use `--reset` between events to restart the counter.
- **"Your barista just started your latte" SMS** on the pending → in-progress transition. Added in [routes/consolidated_api_routes.py](routes/consolidated_api_routes.py) `start_order` + new `_notify_customer_order_started` helper. Only fires once (on the pending → in-progress edge) so retried clicks don't double-notify. Failures are swallowed — the DB update wins regardless.
- **Queue position in the confirmation SMS** ("You're #1 in line — your barista will start it shortly" or "You're #3 in line (~6 min wait)"). New helper `_get_queue_position` in [services/coffee_system.py](services/coffee_system.py).
- **Broadcast SMS endpoint** for organisers: `GET /api/support/broadcast/preview?audience=…` and `POST /api/support/broadcast/customers`. Hard-capped at 500 recipients, three audiences (`today`, `active_today`, `in-progress`), supports a `dry_run` flag, returns structured success/failure counts. Code in [routes/support_api_routes.py](routes/support_api_routes.py). UI form is a follow-up.

While live-testing, hit two **pre-existing bugs** and fixed them:

- **Aborted-transaction cascade**: a query in `_confirm_order` referenced a `stations` table that doesn't exist in this schema (capabilities actually live on `station_stats.capabilities`). The failing query left the shared `self.db` connection in a poisoned state, and *every subsequent read silently returned a default fallback* — including "Sorry, we don't have oat milk" when oat was in stock. Fixed by pointing the query at the right table and wrapping the probe in a SAVEPOINT, plus adding defensive `self.db.rollback()` at the top of `handle_sms` and `_get_available_milk_types` so the cascade can never propagate across requests again. Look for `Error checking milk uniqueness` to spot regressions.
- **`Order ##2` double-hash** in the confirmation text — order numbers now store as plain `42` and the `#` is added at display time only, so the string template `f"Order #{order_number}"` works whether the order number is `42` or the legacy `A1402153`.

To re-run the E2E scenario yourself:

```bash
# fresh DB
createdb expresso_test
export DATABASE_URL=postgresql://localhost/expresso_test
python pg_init.py
python migrations/2026_05_19_friendly_order_numbers.py
# seed inventory (or use the Organiser UI)
psql -d expresso_test <<'SQL'
INSERT INTO inventory_items (category, name, amount, unit, capacity, minimum_threshold) VALUES
  ('coffee','latte',100,'shots',200,10), ('coffee','cappuccino',100,'shots',200,10),
  ('coffee','flat white',100,'shots',200,10), ('coffee','espresso',100,'shots',200,10),
  ('coffee','long black',100,'shots',200,10), ('coffee','mocha',100,'shots',200,10),
  ('milk','full cream',20,'L',30,2), ('milk','skim',15,'L',30,2),
  ('milk','soy',10,'L',20,1), ('milk','almond',10,'L',20,1),
  ('milk','oat',15,'L',20,1), ('milk','lactose free',5,'L',10,1),
  ('sugar','no sugar',NULL,'units',0,NULL), ('sugar','1 sugar',NULL,'units',0,NULL),
  ('sugar','2 sugar',NULL,'units',0,NULL), ('sugar','3 sugar',NULL,'units',0,NULL);
SQL

# start backend
TESTING_MODE=True JWT_SECRET_KEY=test SECRET_KEY=test PORT=5001 \
    python run_server.py

# in another terminal, drive the scenario
python test_e2e_event_scenario.py
```

## Quick orientation for the next session

- The SMS conversation flow has 9 unit tests in [test_sms_conversation_flow.py](test_sms_conversation_flow.py). Run with plain `python3 test_sms_conversation_flow.py` — no pytest or Postgres required (DB is stubbed in-process). Add a test before touching `services/coffee_system.py` or `services/nlp.py`.
- Clearly-superseded source files have been moved to [_archive_legacy/](_archive_legacy/README.md). See its README for the move criteria and what was deliberately left in place. **No files were deleted** — every move used `git mv` and is reversible.
- A docs survey of unbuilt features is in the section below ("Planned-but-unbuilt features"). Verify each one against current code before estimating — these docs are old.

## TL;DR of what was fixed in this session

### Backend SMS pipeline (the user's main complaint)

The SMS conversation flow used to silently inject default values into orders and skip clarifying questions. Root cause: [services/nlp.py](services/nlp.py) `parse_order()` was injecting `size="medium"` and `milk="full cream"` whenever the customer's message didn't mention them. That return value then flowed into the state machine in [services/coffee_system.py](services/coffee_system.py), and a check like `if len(order_details) >= 2` would push the order straight to confirmation — even when the customer had only said e.g. "latte", because the defaults had bumped the field count.

**Changes:**
- `services/nlp.py:204` — added `apply_defaults=False` parameter. Defaults are no longer injected unless the caller asks for them.
- `services/coffee_system.py:1230` (`_handle_awaiting_coffee_type`) — now walks through missing milk → size → sugar one step at a time, with a read-back of what's been understood so far. Only goes straight to confirmation when *all* fields are present in the customer's first message.
- `services/coffee_system.py:1404` (`_handle_awaiting_sugar`) — no longer silently defaults to `"no sugar"` on unrecognized input. Asks again.
- `services/coffee_system.py:1641` (`_handle_awaiting_friend_coffee_type`) — same step-through fix applied to the group/friend order flow.
- `services/coffee_system.py:~1795` (`_handle_awaiting_friend_sugar`) — same no-silent-default fix.
- `services/coffee_system.py:1967` (`_confirm_order`):
  - Now validates that all required fields are present at insert time. If something's missing, it surfaces an error rather than injecting `"full cream"` / `"medium"` / `"no sugar"` as last-mile defaults.
  - When the customer requested a specific station but we had to reassign (invalid station number or capacity), the confirmation SMS now tells them: *"Station X isn't available right now, so your order was routed to Station Y."* Previously the reroute happened silently.

### Frontend hardcoded data

- `Barista Front End/src/services/TokenRefreshService.js:59` — token refresh used `http://localhost:5001/api/auth/refresh` literally. Broke in cloud deploys. Now uses `/api` in production. **HIGH**
- `Barista Front End/src/components/dialogs/WalkInOrderDialog.js:115` — same hardcoded localhost fallback for inventory lookup. **HIGH**
- `Barista Front End/src/components/AllOrdersTab.js:45` — used to look at `['1','2','3']` only when merging order caches across stations; orders for any other station ID were silently dropped from the "All Orders" view. Now scans `localStorage` keys with prefix `orders_cache_station_`. **MEDIUM**
- `Barista Front End/src/components/UserManagementTab.js:416` — preferred-station dropdown was hardcoded to Stations 1–3. Now reads from `useStations()` hook. **MEDIUM**

## Planned-but-unbuilt features (from a docs survey 2026-05-19)

A read of `COMPREHENSIVE_ROADMAP.md`, `SUPPORT_INTERFACE_DETAILED_PLAN.md`, `SUPPORT_INTERFACE_ROADMAP.md`, `IMPLEMENTATION-PLAN.md`, and `API-IMPLEMENTATION-STATUS.md` turned up these features that are documented but appear missing or only partly built. **Verify each one against current code before estimating — these docs are old.** Listed roughly by impact/effort:

1. **Broadcast SMS to all customers** (S, biggest UX win for organiser). Spec in `SUPPORT_INTERFACE_DETAILED_PLAN.md` → Communications Tab. Add `POST /api/support/broadcast/customers` route in `routes/support_api_routes.py` that calls `services/messaging.py`; wire a form in the Support Communications tab.
2. **Pause / resume individual orders or stations** (S). Spec in same doc → Operations Tab. Backend already has `/api/emergency/stop-all`; add `POST /api/orders/<id>/pause`, `POST /api/stations/<id>/pause` analogues.
3. **Station capability → inventory sync** (S). Currently when an organiser changes a station's capabilities, barista UIs don't auto-refresh their inventory filter. Emit a `station:capabilities_updated` WebSocket event in `routes/station_api_routes.py` and consume it in `Barista Front End/src/hooks/useStock.js`.
4. **Barista performance metrics API** (M). Frontend `StaffManagementPanel.js` (~462 lines) already displays *mock* per-barista metrics. Add real queries to `routes/station_api_routes.py`: `GET /api/staff/performance/<barista_id>` returning orders-per-hour, avg completion time, error rate from the `orders` table.
5. **Order reassignment / load-balancing UI** (M). Backend has implicit station assignment in `_assign_station()`; needs a `POST /api/orders/<id>/reassign` endpoint + drag-drop in the Operations tab.
6. **Real-time analytics dashboard data feed** (M). `Barista Front End/src/components/AnalyticsDashboard.js` currently uses hardcoded sample data. Add `GET /api/support/metrics/realtime` + WebSocket `support:metric_update` emit on order state changes.
7. **SMS response templates** (M). Spec in `SUPPORT_INTERFACE_DETAILED_PLAN.md`. CRUD on a new `sms_templates` table; UI editor in Communications tab.

Items intentionally **excluded** as already-built or out-of-scope:
- All four main interfaces (Landing/Barista/Organiser/Support) — exist.
- Order lifecycle, JWT auth + refresh, WebSocket infrastructure — work.
- Emergency stop-all — already in backend.
- "Voice ordering / gestures / multi-event" — vapor-spec, not quick wins.

## Issues identified but NOT yet fixed (good follow-ups)

These were spotted during the audit but skipped to keep this change small. Priority order:

1. **HIGH — Test credentials in production bundle**: `Barista Front End/src/components/test-framework/config/testConfig.js:6-19` ships test usernames, passwords, *and* a Postgres password in the frontend build. Same with `Barista Front End/src/test-runner.js:178,403`. Move these to a test-only entrypoint that's not imported by `App.js`. (Need to grep to verify they aren't already excluded.)
2. **MEDIUM — Hardcoded "Station 1"/"Station 2" labels** in `Barista Front End/src/components/InventoryManagementPanel.js` (multiple JSX literals). Should use `station.name`.
3. **MEDIUM — Duplicated baseUrl pattern** in `ApiService.js`, `ConfigService.js`, `ScheduleService.js`, `StationsService.js`, `StockService.js`, `MessageService.js`, etc.: each redefines `process.env.NODE_ENV === 'production' ? '/api' : 'http://localhost:5001/api'`. Centralize in `ConfigService.getApiBaseUrl()` and have everything else import it. Same fix applies to the two I patched manually (`TokenRefreshService.js`, `WalkInOrderDialog.js`).
4. **MEDIUM — Mock data in SMSSettingsPanel preview**: `Barista Front End/src/components/SMSSettingsPanel.js:15,91,94` hardcodes `https://order.expresso.cafe` and a fake `order=42&station=3` link.
5. **MEDIUM — Station reassignment silently accepts whatever station_id the customer typed**: even if it's a real station ID, the system doesn't check whether that station has the requested milk in stock before assigning. If it lacks the milk, the order will fail at the barista station. See `services/coffee_system.py` `_assign_station()` — extend it to take `specified_station_id` and validate against milk capability *before* trusting it.
6. **LOW — JWT auth race condition**: `Barista Front End/src/services/ApiService.js` refreshes tokens only on page load, not on 401 responses. CLAUDE.md flags this as "auth edge cases".
7. **LOW — Sweetener inventory defaults**: `services/coffee_system.py` `_get_available_sweeteners()` returns `[("sugar", "sugar"), ("no sugar", "sugar")]` if the inventory table is empty. That's fine, but the "Equal" miscategorization warning (line ~1199) suggests the inventory data model has a bug that should be fixed in a migration, not papered over in code.
8. **SECURITY — already flagged in CLAUDE.md**: Twilio credentials in `.env`. Not fixed here; needs proper secret management.

## How the SMS flow actually works (short version)

```
Twilio webhook → POST /sms (routes/sms_routes.py:30 sms_webhook)
              ↓
       sms_routes.py extracts station_id from message text + metadata
              ↓
       coffee_system.handle_sms(phone, body, metadata)  (line 248)
              ↓
       look up conversation state for this phone number
              ↓
       dispatch to _handle_awaiting_<state>():
         awaiting_name → awaiting_coffee_type → awaiting_milk →
         awaiting_size → awaiting_sugar → awaiting_confirmation → completed
              ↓
       _confirm_order() inserts the order, assigns/reroutes station,
       writes customer_preferences, returns confirmation text
```

The state machine is conventional but the **handlers are tightly coupled to `nlp.parse_order()`**. Any change to `parse_order` ripples — that's why I added a flag instead of changing the return shape.

There's a parallel set of friend/group order states (`awaiting_friend_*`) that mirror the main flow. Keep them in sync when changing one — I did this for the coffee-type and sugar handlers but didn't audit every line.

## Files to know

| Path | Why it matters |
| --- | --- |
| `services/coffee_system.py` | 4300-line SMS state machine. The center of the system. |
| `services/nlp.py` | Pattern-matching message parser. No real ML. |
| `routes/sms_routes.py` | Twilio webhook entry point. |
| `app.py` | Flask app setup, blueprint registration. |
| `Barista Front End/src/App.js` | Frontend router + auth bootstrap. |
| `Barista Front End/src/services/ApiService.js` | Centralized API client with token refresh logic. |
| `Barista Front End/src/services/OrderDataService.js` | Order CRUD + offline fallback. |
| `Barista Front End/src/hooks/useOrders.js` | The hook all order tabs use. |

## How to verify the SMS fixes

There's no automated test for the conversation flow — the existing test files are integration smoke tests. The easiest way to verify:

1. Run `./prepare_test_environment.sh` to seed data.
2. Use `python test-walk-in-order-direct.py` to confirm regular-order flow still works.
3. For SMS specifically: there's `Barista Front End/src/components/SMSTestSimulator.js` — a UI for simulating SMS conversations. Open the Support tab and try messages:
   - **"latte"** — should now ask for milk type (was: jump to confirmation).
   - **"large oat latte"** — should now ask for sugar (was: jump to confirmation).
   - **"large oat latte 1 sugar"** — should still go straight to confirmation with a clean read-back.
   - **"latte for station 99"** — confirmation should mention the reassignment.
   - Sugar reply **"yeah a bit"** — should re-prompt instead of silently storing "no sugar".

## Repo hygiene observations

- 200+ files at repo root. Many old `.md` docs are out of date. **Do not trust** files like `SYSTEM_AUDIT_REPORT.md` or `IMPLEMENTATION-ISSUES.md` without spot-checking against current code — several reference removed features.
- `routes/auth_routes.py.backup` and `routes/auth_routes_broken.py` are committed dead code. `routes/websocket_routes_fixed.py` looks like a rename that wasn't completed (the un-suffixed file is also still there).
- `Barista Front End/src/services/` has six(!) variants of `ApiService` and `OrderDataService`. Only the un-suffixed ones (`ApiService.js`, `OrderDataService.js`) are imported in `App.js`. Safe to delete the others if the user wants.
- The user explicitly mentioned having a backup, so destructive cleanups are lower-risk than usual — but still ask first.

## Conventions worth following

- Backend response shape: `{ success, status, data, message }`. See [API-REFERENCE.md](API-REFERENCE.md).
- All API endpoints under `/api` require JWT except `/api/auth/login` and `/sms` (Twilio webhook).
- Frontend services follow a singleton pattern — `export default new ServiceClass()` at the bottom of each file.
- Python: `black .` + `isort .` before committing. Frontend: `npm test -- --watchAll=false`.
- Default login that works: `coffeecue / adminpassword` (per CLAUDE.md — other listed creds may not work).
