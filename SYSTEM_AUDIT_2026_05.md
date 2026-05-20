# System-wide audit — May 2026

Follow-up to `SMS_AUDIT.md` (which is now fully resolved — all 8 items shipped).
This pass widens the lens to the whole platform: Barista UI, Organiser, Support,
walk-in, auth, real-time, infrastructure. Findings verified against the actual
code; where parallel scans returned false positives they are called out at the
bottom rather than included as real findings.

---

## What's been shipped (so you can orient before reading the gaps)

Since the SMS audit doc was written, the following landed:

- All 8 SMS audit fixes (ready-pickup SMS, honest prompt, stale timeout, strength+decaf, time-of-day wording, auto-reminder, real EDIT, live event_name)
- `_get_available_sizes` no longer queries a phantom `size_options` table; reads `inventory_items` cups category
- 7 schema migrations now applied via the migrations framework
- Pickup-reminder background service with a 4-hour age cap so first-deploy doesn't spam
- Tea + alt-drink SMS recognition (off-menu friendly)
- Per-station capabilities editor UI
- Ready-for-Pickup column wired to the canonical completed-orders source

So the SMS surface is in good shape. The audit below is everything else.

---

## Tier 1 — Production blockers (fix before public deploy)

### 1. Demo-token signature bypass in auth (security)

`auth.py:38, 137-167` — any JWT whose token string ends with the literal suffix
`valid_signature_for_offline_demo_mode` is accepted **without signature
verification**. The payload is just decoded, `role` is read from it, and the
request proceeds. There is **no `TESTING_MODE` guard** around this branch — it
runs in production identically to development.

Effect: anyone who learns the suffix can mint a token with any role/claims
they want and act as admin.

**Fix scope:** small. Wrap the entire demo-token branch in `if app.config.get('TESTING_MODE'):`,
or delete it outright (the frontend's auto-refresh-on-401 has made the offline
demo path mostly redundant).

### 2. WebSocket connections accept all comers (security + privacy)

`routes/websocket_routes_fixed.py:18-32` — the connect handler is commented
"auth bypassed for now" and unconditionally returns `'authenticated': True`.
Every client gets joined to `public_updates`, `all_stations`, `orders`, and
`chat` rooms. Order updates, station updates, and chat messages are
broadcast to that pool without role filtering.

Effect: a customer with the public Display URL can subscribe and read every
operational message, every order update across every station, and every
inter-station chat for the event.

**Fix scope:** medium. Extract JWT from connect auth payload, verify it,
then conditionally join staff rooms (orders/chat) only for `barista`/`staff`/`admin`
roles. Public clients should only join `public_updates`.

### 3. Twilio webhook signature validation can be silently skipped

`routes/sms_routes.py:51` — `if auth_token and auth_token != 'test_token':`
skips signature validation when `TWILIO_AUTH_TOKEN` is the literal string
`test_token`. If a deploy leaves that placeholder in `.env`, the bot accepts
unsigned (i.e. spoofable) SMS as if they came from Twilio. Anyone with the
public webhook URL could send a forged order on behalf of any phone number.

**Fix scope:** small. Replace the string check with a `TESTING_MODE` guard,
and fail closed (reject the request) if neither is set.

### 4. Connection pool can exhaust under load

`utils/database.py:88-96, 152` — pool is hardcoded `minconn=1, maxconn=10`,
`getconn()` has no timeout, and several code paths get a connection without
a context manager. If a single cursor leak happens 10 times the pool dries
up and the next request blocks forever. Worse, the SQLite fallback at
line 129-145 fires silently on connection failure, so production traffic
can quietly drift onto an empty SQLite file.

**Fix scope:** medium. Bump pool size (Railway containers tolerate 20-30
easily), add `getconn(timeout=5)`, and gate the SQLite fallback behind
`TESTING_MODE` so prod fails loudly rather than splitting writes across
two databases.

---

## Tier 2 — Real rough edges (operators / baristas notice)

### 5. Order actions fail silently in the barista UI

Start / Complete / Pickup buttons (`useOrders.js` ~1111, ~1300, ~1641 and
the components that call them) catch errors and `console.error` them, but
nothing surfaces to the barista. If a network blip causes a 500 or the
order was claimed by another station between fetch and click, the button
just does nothing visible. During a rush that's confusing — the barista
clicks again, gets the same nothing, and assumes the order disappeared.

**Fix scope:** small-to-medium. Add a `<Toast>` or persistent error banner
component at the Orders-tab level and wire each action's error path to it.

### 6. Stock decrement on Complete is "best effort" without feedback

`useOrders.js:~1300` and `consolidated_api_routes.py complete_order():~1670`
both decrement stock in try/except blocks that log on failure but never
tell the barista. Result: a barista can mark a flat-white done, the milk
counter doesn't tick down (because the inventory row is missing or the
unit doesn't match), and the next customer gets routed to a station that
"has stock" but actually doesn't.

**Fix scope:** medium. Have `_decrement_stock_for_order` return a
structured result (`{decremented: [...], skipped: [...], failed: [...]}`),
attach it to the `/complete` response, and toast a warning if anything
failed.

### 7. Station capabilities don't gate order start

A barista can tap Start on any order at any station. The backend
`start_order` endpoint (~1444 in consolidated_api_routes.py) doesn't check
whether the station's `capabilities` JSONB allows the drink/milk. The
capability data exists (capabilities editor UI is live), the routing in
`_assign_station` honours it for new orders, but the manual claim path
doesn't.

**Fix scope:** medium. In `start_order`, look up `station_stats.capabilities`,
match against the order's drink/milk, return 400 with a clear message if
the station can't make it. Frontend already shows a toast on 400.

### 8. Frontend UI for User Management, Schedule, and Station Inventory writes only to localStorage — even though the backend endpoints exist

This is the audit's most interesting finding. The parallel scanner flagged
"User Mgmt has no backend, Schedule has no backend, etc." — but the
backend endpoints **do** exist:

- User CRUD: `routes/support_api_routes.py:420-621` (GET/POST/PUT/DELETE/toggle/reset)
- Schedule: `routes/schedule_api_routes.py`, `routes/consolidated_api_routes.py:4445-5094` (full shift/break/rush-period CRUD)
- Per-event reporting: `routes/consolidated_api_routes.py:5679` (`/api/reports/today`)
- Broadcast preview: `routes/support_api_routes.py:742` (`/api/support/broadcast/preview`)

The gap is **frontend not calling them**. `UserManagementTab.js:56-99`
reads/writes `coffee_system_users` localStorage. `EnhancedScheduleManagement.js:74-77`
loads from localStorage only. `StationInventoryConfig.js:53-96` reads
`station_inventory_configs` and `station_inventory_quantities` from
localStorage and never POSTs.

So when the organiser sets up users / schedule / per-station inventory and
the next operator opens it on a different device, none of it persists.
Worse, it *looks* persistent because the original device's localStorage
still has the data.

**Fix scope:** medium per surface. Wire each component to its existing
endpoint via ApiService. ~2 hours per (UserMgmt, Schedule, StationInv).

### 9. Component duplication / unclear canonical

`ls Barista Front End/src/components/` reveals pairs like:

- `ScheduleManagement.js` + `EnhancedScheduleManagement.js`
- `StationCapabilities.js` + `StationCapabilitiesEditor.js` + `EnhancedStationCapabilities.js`
- `InventoryManagement.js` + `InventoryManagementPanel.js` + `MultiLevelInventory.js`
- `StationSettings.js` + `StationManagementPanel.js` + `StationDefaults.js`

Future maintainers (you, in three months) will not know which one is
wired into the live UI. Probably most are dead but you can't tell from
the file tree.

**Fix scope:** medium. Grep imports, identify the dead ones, move to
`_archive_legacy/components/` (consistent with the rest of the legacy
archive pattern in this repo).

### 10. Walk-in dialog hardcodes localhost for inventory fallback

`WalkInOrderDialog.js:122-162` includes a fallback fetch to
`http://localhost:5001/api/...`. On any deploy other than a local dev
machine that fetch 404s and the dropdown silently goes blank. The
primary localStorage source still works most of the time, but the
fallback being broken means initial-load races become broken-state
races.

**Fix scope:** small. Replace with `apiBase` from ConfigService (which
already reads `REACT_APP_API_URL`).

### 11. Organiser settings that *look* saved but aren't

- **Coffee Type Colors** (`EventSettings.js:64-70`): UI rendered with
  `opacity-50` (disabled) — no save path, no backend.
- **Station Defaults** (`StationDefaults.js`): mentioned in the
  Organiser tab list but no API integration visible.
- **Event Settings Advanced tab** (`EventSettings.js:74-80`): stub text
  "Additional configuration options will be available here".
- **Coffee-Type colours / Messages tab placeholder** (Organiser line
  558-560): "Message Center functionality coming soon".

Each of these looks like a feature to an operator clicking through.

**Fix scope:** small per item — either delete the stub or wire it.

### 12. No CSRF guard, but plausibly mitigated

`config.py:50` sets `JWT_COOKIE_CSRF_PROTECT = False` by default. **However,**
the API uses Bearer-token JWT (Authorization header), not cookies, so
classic CSRF doesn't apply — a malicious site can't make the browser send
the localStorage-held token. So this is a *latent* risk only if you ever
flip to cookie auth.

Worth a one-line code comment explaining this so the next person doesn't
assume it's a bug.

---

## Tier 3 — Polish, code health, not urgent

### 13. No CI / no automated test gate
No `.github/workflows/`, no `pytest.ini`, scattered `test-*.py` and
`test_*.py` files in repo root with no unified runner. Frontend uses
default CRA jest. Easy to add a basic GH Actions workflow that runs
pytest + jest; would catch regressions on PR.

### 14. Archive folders should be deleted from git
`_archive/`, `_archive_legacy/`, `backend_backup_20250525_125912/`. The
naming is good (so reviewers ignore them) but they bloat the repo and
clutter searches. Either delete-with-commit or move to a separate
`legacy-archive` branch.

### 15. No `.env.example`
Onboarding cost. List required envs (TWILIO_*, JWT_SECRET_KEY, DATABASE_URL,
plus the new STALE_CONVERSATION_MINUTES / PICKUP_REMINDER_*) in a tracked
template file.

### 16. No React Error Boundary
A single render crash in any sub-tab brings down the whole interface.
Adding a top-level `<ErrorBoundary>` in `App.js` with a "something went
wrong, reload" fallback is ~20 lines.

### 17. SQLite fallback in `utils/database.py` is silent
When PG is unreachable, the code silently falls back to SQLite. In dev
that's fine; in prod it's a data-loss footgun (orders go into the wrong
DB, then PG comes back and nobody knows). Tier 1 #4 already calls this
out as part of the pool finding — listed here for visibility.

### 18. Logging is per-module without central config
Each file calls `logging.getLogger(...)` but no shared formatter, level,
or handler. Logs are unstructured and not great for Railway log scraping.
A small `logging_config.py` with JSON formatter + level-from-env would
help future debugging.

### 19. `auth.py` demo-token magic string is duplicated
Three places use the literal `'valid_signature_for_offline_demo_mode'`.
If you ever change it, you'll forget one. Extract to a constant or, per
Tier 1 #1, delete entirely.

### 20. Frontend service-instance inconsistency
`AuthService` exports `new AuthService()` (singleton), but some other
services export the class itself, leaving instantiation to callers.
The CLAUDE.md says "Maintain the singleton patterns for core services" —
worth a one-pass cleanup.

### 21. WebSocket payload validation missing
Once Tier 1 #2 is fixed, payload schemas should still be validated
(station_id is an int, order_id matches a UUID/numeric pattern, etc.) so
a malicious authenticated client can't broadcast garbage. Marshmallow or
a small dataclass-based validator works.

### 22. Hardcoded `proxy: "http://localhost:5001"` in `Barista Front End/package.json`
Doesn't break Railway (the build doesn't use proxy), but if anyone runs
`npm start` against a non-local backend they'll silently hit the wrong
target. Worth documenting in the README or using `setupProxy.js` with
env var.

### 23. Performance metrics in Support tab are mock values
`routes/support_api_routes.py:88-98` returns hardcoded
`cpu_percent=42`, `api_response_time=150ms`, etc. The Support UI
displays them as real telemetry. Either compute real values (psutil for
CPU/mem, a request-hook timer for API latency) or label the panel
"sample dashboard".

### 24. `support_role_required` decorator has a TODO
`routes/support_api_routes.py:26-33` — "Re-enable role check after
testing". Currently every authenticated user (including baristas) can
hit support endpoints. Combined with Tier 1 #1, this is broader than it
looks.

---

## Corrections — claims that *looked* like findings but aren't real

The parallel audit scanners flagged these as gaps. I verified them and
they're already implemented; including here so the audit is honest:

| Initially flagged | Actual status |
|---|---|
| "Display screen doesn't filter picked_up orders" | `DisplayScreen.js:266` does filter `rawStatus === 'picked_up'`. |
| "Per-event reporting endpoint missing" | Exists at `/api/reports/today` (`consolidated_api_routes.py:5679`). |
| "Broadcast SMS preview endpoint missing" | Exists at `/api/support/broadcast/preview` (`support_api_routes.py:742`). |
| "User Management has no backend" | Full CRUD at `support_api_routes.py:420-621`. The frontend just isn't wired to it (Tier 2 #8 covers this). |
| "Schedule Management has no backend" | Many endpoints exist in `schedule_api_routes.py` + `consolidated_api_routes.py:4445-5094`. Same FE-wiring story. |

---

## Recommended priority order

If you only do four things from this audit, do these — they're the highest impact-per-effort:

1. **Tier 1 #1** (demo token bypass) — 15 min, removes a privilege-escalation hole
2. **Tier 1 #2** (WebSocket auth) — 1-2 hours, removes the privacy leak before any public Display URL goes live
3. **Tier 2 #8** (FE→BE wiring for User Mgmt + Schedule + Station Inventory) — ~6 hours total, removes the "but I saved this!" footgun for organisers
4. **Tier 2 #5** (error toasts on order actions) — 1-2 hours, the only Barista-facing gap baristas will actually feel during a shift

Tier 1 #3 (Twilio bypass) is critical *if* deploying soon — but trivial to fix in 5 minutes once you're at it.

Everything else is real but can wait until after a real event has stress-tested the system.
