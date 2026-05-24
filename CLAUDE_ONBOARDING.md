# Onboarding for the next Claude session

Read this first if you've never worked on Expresso before. It assumes
you've read `CLAUDE.md` (the project-instructions file) but want a
mental model of the codebase before diving in.

Last updated: 2026-05-22.

---

## 1. What this app does, in 30 seconds

Coffee Cue is a coffee-ordering system for events (conferences,
expos). Customers SMS or walk up to a barista. The order flows
through stations (each station = one barista with one machine). The
app routes orders to the right station based on capabilities (this
station has oat milk? this one's offline?), the barista works through
their queue, the customer gets an SMS when their drink is ready.

Three audiences inside the app:

| User | Interface | URL |
|---|---|---|
| Barista | Queue view + walk-in dialog + stock | `/barista` |
| Organiser | Event setup, inventory, pricing, branding, users | `/organiser` |
| Support | Health checks, logs, broadcast SMS | `/support` |
| Public | Display screen | `/displays` |

Default admin login: `coffeecue / adminpassword`.

---

## 2. Top-level layout

```
expresso/
├── routes/                       # Flask blueprints, one per area
│   ├── auth_routes.py            # /api/auth/login, /api/auth/refresh
│   ├── consolidated_api_routes.py# THE BIG ONE — orders, stations,
│   │                             # inventory, capabilities, catalog,
│   │                             # pricing, walkin-defaults, reassign
│   ├── sms_routes.py             # Twilio webhook + outbound
│   ├── users_simple_api.py       # /api/users CRUD
│   ├── support_api_routes.py     # /api/diagnostics/*
│   ├── settings_api_routes.py    # /api/settings KV
│   └── ...
├── services/                     # Business logic
│   ├── coffee_system.py          # SMS conversation engine, order
│   │                             # creation pipeline, _assign_station,
│   │                             # _compute_order_price, stock decrement
│   ├── messaging.py              # Twilio wrapper
│   ├── migrations.py             # Numbered schema migrations
│   │                             # (replaces ad-hoc ALTER TABLEs)
│   ├── nlp.py / advanced_nlp.py  # SMS intent parsing
│   ├── pickup_reminder.py        # Background SMS reminder job
│   └── stock_management.py       # Stock decrement helpers
├── utils/database.py             # PG/SQLite connection helpers
├── auth.py                       # JWT generate/verify, demo-mode shim
├── app.py / run_server.py        # Flask boot, blueprint registration
├── Barista Front End/            # React app (note the space!)
│   └── src/
│       ├── components/           # 80+ React components
│       │   ├── BaristaInterface.js     # The barista's main view
│       │   ├── OrganiserInterface.js   # Organiser's main view
│       │   ├── LandingPage.js          # /
│       │   ├── DisplayScreen.js        # Customer-facing display
│       │   ├── QuickSetup.js           # One-stop event config
│       │   ├── PendingOrdersSection.js # Pending column on Orders tab
│       │   ├── BrandingSettings.js     # Branding panel
│       │   ├── InventoryManagement.js  # Organiser's inventory editor
│       │   ├── MenuManagement.js       # Menu items config
│       │   ├── auth/LoginPage.jsx      # Login screen
│       │   ├── dialogs/                # Modal dialogs
│       │   │   ├── WalkInOrderDialog.js  # The walk-in form
│       │   │   ├── MoveOrderDialog.js    # Reassign order to station
│       │   │   └── MessageDialog.js      # Send SMS to customer
│       │   ├── barista-tabs/           # Sub-tabs of barista UI
│       │   ├── support-tabs/           # Sub-tabs of support UI
│       │   └── support-tabs/EmergencyTab.js  # Stop-the-line controls
│       ├── services/             # API + state services
│       │   ├── ApiService.js           # HTTP client + JWT refresh
│       │   ├── OrderDataService.js     # Order CRUD + cache
│       │   ├── AuthService.js          # Login / logout / token mgmt
│       │   ├── WebSocketService.js     # Real-time updates
│       │   ├── StockService.js         # Per-station stock state
│       │   ├── SettingsService.js      # Settings KV reader
│       │   ├── ConfigService.js        # Env / URL config
│       │   └── FallbackService.js      # Offline fallback
│       ├── hooks/                # React hooks
│       │   ├── useOrders.js            # The big one — order state
│       │   ├── useStations.js          # Stations list
│       │   ├── useStock.js             # Per-station stock
│       │   ├── useSettings.js          # Settings reader
│       │   ├── useCatalog.js           # NEW — canonical lists
│       │   └── useSchedule.js          # Shifts/breaks
│       ├── config/
│       │   ├── apiConfig.js            # Base URL, debug flags
│       │   ├── brandingConfig.js       # Default branding values
│       │   └── setupProxy.js           # Dev proxy → :5001
│       ├── utils/
│       │   ├── milkConfig.js           # DEFAULT_MILK_TYPES (legacy —
│       │   │                           # being replaced by catalog)
│       │   ├── milkColorHelper.js      # Milk colour per dot/stripe
│       │   └── orderUtils.js           # Time/colour helpers
│       └── App.js                # Top-level router + error boundary
├── tests/smoke/                  # API contract smoke tests
│   ├── smoke_test_full.sh        # Top-level entry
│   ├── smoke_test_api.py         # Runner
│   └── api_contracts.json        # Declarative contracts
├── migrations/                   # SQL migration scripts (legacy)
├── scripts/                      # One-shot admin scripts
├── start_expresso*.sh            # Boot scripts (multiple variants)
├── .env / .env.example           # Config (.env is gitignored)
├── CLAUDE.md                     # Project rules (read first!)
└── CLAUDE_ONBOARDING.md          # ← you are here
```

Things to ignore: `_archive*`, `backend_backup_*`, `static/_archive`,
`backend_backup_20250525_125912`, `CoffeeCueLauncher.app/`, `lib/`,
`bin/`, `templates/` (legacy Flask templates, the React app
superseded these).

---

## 3. Data flows per major feature

### 3a. Order via SMS

1. Customer texts the Twilio number.
2. `routes/sms_routes.py` receives the webhook, hands it to
   `services/coffee_system.CoffeeOrderSystem.handle_sms`.
3. `coffee_system._set_conversation_state` tracks where we are in
   the multi-message flow (name → drink → milk → size → confirm).
4. On confirmation, `_confirm_order` writes to `orders` table with
   `status='pending'`, `order_details` JSONB blob (name, type, milk,
   size, sugar, vip flag, tea fields, price stamp).
5. `_assign_station` picks the right station based on capabilities,
   load, scheduled breaks. Writes `station_id` on the order row.
6. SMS confirmation sent back to customer with the order number and
   (if pricing on) the amount to pay.
7. Frontend polls `/api/orders/pending` every 15s + WS push.

### 3b. Order via walk-in dialog

1. Barista taps "Add Walk-in Order" → `WalkInOrderDialog.js` opens.
2. Dialog loads `availableMilks`, `availableCoffeeTypes`, `availableSizes`
   from station inventory (localStorage `coffee_stock_station_<id>`
   first, then `/api/inventory?station_id=N` fallback).
3. Operator fills in customer name + drink + milk + (optional) VIP tick.
4. On submit: `BaristaInterface.handleWalkInOrder`
   → `useOrders.addWalkInOrder`
   → `OrderDataService.addWalkInOrder`
   → POST `/api/orders` with `order_type='walk-in'`.
5. Backend `consolidated_api_routes.py` POST `/orders`:
   - Canonicalises `vip` from `priority`/`vip` fields.
   - Computes price via `coffee_system._compute_order_price`.
   - Inserts into `orders` table.
6. Frontend strips the local optimistic placeholder (see gotcha #2)
   and refetches; real order with its DB-assigned number appears.

### 3c. Order lifecycle (start / complete / picked up / reassign)

| Action | Endpoint | What it changes |
|---|---|---|
| Start | `POST /orders/<id>/start` | `status='in-progress'`, SMS to customer |
| Complete | `POST /orders/<id>/complete` | `status='completed'`, ready-SMS to customer, stock decrement |
| Picked up | `POST /orders/<id>/pickup` | `status='picked_up'`, `picked_up_at=NOW()` |
| Reassign | `POST /orders/<id>/reassign` | `station_id=N` (validates target active + capable) |
| Message | `POST /orders/<id>/message` | Free-text SMS to customer |
| Delay | `POST /orders/<id>/delay` | Bumps `promisedTime` |

Each fires a WebSocket `order_updated` event so other connected
clients (Display screen, other barista tabs) refresh.

### 3d. Inventory + capabilities

Three layers, source of truth at the top:

1. **Catalog** (`catalog_items` table — added 2026-05-22): canonical
   option lists (full_cream, latte, small, white_sugar...). One row
   per unique option, per category. Source of truth for all UIs.
2. **Inventory** (`inventory_items` table): what's stocked at the
   event in what amount. Each row references a catalog item by name
   (loosely — still string-keyed).
3. **Station capabilities** (`station_stats.capabilities` JSONB):
   per-station subset of the catalog — which milks/drinks/sizes
   this station can make. Drives routing in `_assign_station` and
   the capability check on Start + Reassign.

### 3e. Settings KV

Many settings live as JSONB blobs in the `settings` table, keyed by
name. Read with `_kv_get(db, key)`, written with `_kv_put`. The
common ones:

| key | Description |
|---|---|
| `pricing_settings` | Per-drink prices + VIP-free toggle |
| `walkin_defaults` | Walk-in dialog seed values |
| `branding_settings` | Logo, system name, event name |
| `event_inventory` | Quick Setup → enabled milks/drinks/etc. |
| `event_menu` | Per-event menu item enable/disable |
| `vip_code` / `vip_codes` | Codes that promote a customer to VIP |
| `order_prefix` | Prefix prepended to order numbers ("C42") |

---

## 4. Load-bearing files (the 80/20)

If you only read 10 files, read these:

1. **`routes/consolidated_api_routes.py`** — 6000+ lines, ~half of all
   API endpoints (orders, stations, capabilities, catalog, settings).
   Search here first when looking for any `/api/...` endpoint.
2. **`services/coffee_system.py`** — SMS conversation engine + order
   creation pipeline + price compute + station assignment.
3. **`Barista Front End/src/components/BaristaInterface.js`** — the
   barista's main view, ~3000 lines, holds most of the action handlers.
4. **`Barista Front End/src/hooks/useOrders.js`** — the order state
   hook. All order CRUD goes through here. Optimistic updates,
   localStorage fallback, refresh loop.
5. **`Barista Front End/src/services/OrderDataService.js`** — the API
   client for orders. Where the wire format is defined.
6. **`Barista Front End/src/services/ApiService.js`** — HTTP client +
   JWT refresh. All backend calls go through this.
7. **`Barista Front End/src/components/dialogs/WalkInOrderDialog.js`** —
   the walk-in form (~1600 lines, lots of state).
8. **`Barista Front End/src/components/QuickSetup.js`** — Organiser's
   one-stop event config. Inventory toggles, pricing, walkin defaults,
   branding adjacent.
9. **`services/migrations.py`** — schema migrations. Append to the
   bottom of MIGRATIONS list to add a new one.
10. **`auth.py`** — JWT generation + `jwt_required_with_demo` decorator.

---

## 5. Known gotchas (where you'll trip up)

### Gotcha 1: Two inventory stores

Stock data exists in two places:

- Backend `inventory_items` table (source of truth for the server)
- Browser `localStorage['coffee_stock_station_<id>']` (what the
  dialog reads first; populated when the barista adjusts stock on
  the Stock tab)

These can drift. The walk-in dialog reads localStorage first, falls
back to the API. If you see "stale drink names in dropdown" or
"new milks not appearing", clear the localStorage key and refresh.

### Gotcha 2: Walk-in optimistic placeholder vs server order

When the operator submits a walk-in, `useOrders.addWalkInOrder`:

1. Creates an optimistic placeholder with `id='local_order_<ts>'`
   and `orderNumber='WI<ts>'`, writes to localStorage
   `local_orders_station_<id>`.
2. POSTs to backend, which assigns the real ID (e.g. `27`) and
   sequence-based order number (`27`).
3. **Must** prune the placeholder from localStorage on server confirm,
   or the order appears twice (placeholder + real). This is in
   `useOrders.addWalkInOrder` — don't break the prune step.

There's also a 2-minute auto-expiry on stale placeholders in the
merge logic, as a belt-and-braces safety net.

### Gotcha 3: Status string canonicalisation

Use **`'in-progress'`** (hyphen) for in-progress orders, NOT
underscore or camelCase. Use **`'picked_up'`** (underscore) for
collected orders. Mixing breaks queries. Search for these strings
before adding a new value.

### Gotcha 4: VIP can come from multiple sources

Order is VIP if ANY of:
- Walk-in dialog VIP checkbox ticked (`priority: true`).
- Notes contain a VIP keyword (`vip`/`staff`/`organizer`/`organiser`/`priority`).
- Customer has `customer_preferences.is_vip=true` from a prior SMS VIP code.

Backend canonicalises all three into `order_details.vip` at
order-create time. **Don't** add a hardcoded `priority: true` in the
walk-in service path — that bug bit us recently (every walk-in
silently became VIP). The frontend's `OrderDataService.createWalkInOrder`
must pass priority through unchanged.

### Gotcha 5: Frontend dir has a space in the name

Always `cd "Barista Front End"` (quoted). Build paths, jest configs,
proxy files all use this dir name.

### Gotcha 6: Demo tokens vs real tokens

`jwt_required_with_demo` (in `auth.py`) accepts a special
"demo-mode" token that's signed with a fixed suffix
`valid_signature_for_offline_demo_mode`. The auth gate accepts it
only when `TESTING_MODE=true` in `.env`. Don't use plain
`@jwt_required()` — it rejects demo tokens and the test harness
breaks. All new protected endpoints should use the `_with_demo`
variant.

### Gotcha 7: PostgreSQL `equipment_notes` was getting capabilities JSON

A long-fixed bug used to write `capabilities` JSON into the
`station_stats.equipment_notes` TEXT column (which the API maps to
"location"). Migration #8 cleans these up. If you see "JSON blob in
station location" complaints, that's the symptom.

### Gotcha 8: SMS defaults

`coffee_system.handle_sms_conversation` has an `apply_defaults`
parameter. **NEVER set it to True silently** — Steve's hard rule is
"never inject defaults into SMS orders; always ask the customer."
The conversation should always confirm explicitly.

### Gotcha 9: Multiple start scripts

`./start_expresso.sh`, `./start_expresso_fast.sh`,
`./start_expresso_complete.sh`, `./start_expresso_with_twilio.sh`,
`./quick_start.sh`. They differ in what they spawn (ngrok or not,
Twilio webhook update or not). All open separate Terminal tabs via
`osascript` — if a tab dies silently, the service it was running
won't be up. Don't run two simultaneously; you'll get zombie
processes on port 5001.

### Gotcha 10: Worktree venv

This is a Claude Code worktree. The venv lives in the main repo at
`/Users/stevewf/expresso/venv` — there's no venv directly in the
worktree. The start script tries `source venv/bin/activate` which
fails silently here. There's now a symlink `venv → ../venv` to
work around this. If you set up a fresh worktree, you'll need that
symlink.

---

## 6. How to add a new <thing>

### Add a new API endpoint

1. Pick the right route file (look in `routes/`). For most
   new things, `consolidated_api_routes.py` is the place.
2. Use `@jwt_required_with_demo()` + `@role_required_with_demo([...])`.
3. Add a smoke contract in `tests/smoke/api_contracts.json` so it
   can't silently regress.
4. **Restart the backend** to pick up the change (Flask doesn't
   hot-reload by default in this app).

### Add a new schema column / table

Use `services/migrations.py`. Append a new function `_mNNN_name(cur)`
and add it to the `MIGRATIONS` list with the next version number.
**Don't reuse a version number; don't reorder.** Runs idempotently
at app boot.

### Add a new frontend setting

1. Backend: add a setting key (use `_kv_get`/`_kv_put` pattern,
   model after `pricing_settings` or `walkin_defaults`).
2. Frontend: add UI in `QuickSetup.js` or `BrandingSettings.js`.
3. Consumer: read via `SettingsService.getXYZ` or a fetch in the
   relevant component.

### Add a new milk / drink / size / sweetener

DON'T add it as a hardcoded constant. Add it to `catalog_items`:
either edit the seed in `migrations.py` `_m009_catalog_items` for a
permanent addition, OR POST to `/api/catalog/<category>` for a
runtime custom (operator-visible, persisted, dedup'd).

### Add a new walk-in default

`pricing_settings` and `walkin_defaults` show the pattern. Add the
field to `DEFAULT_WALKIN_DEFAULTS` in `consolidated_api_routes.py`,
add the input to `WalkinDefaultsSection` in `QuickSetup.js`, read
it where needed via `/api/walkin-defaults`.

---

## 7. Running things

```bash
# Boot the whole stack (opens 3 Terminal tabs)
./start_expresso_fast.sh

# Just the backend (this is what Claude restarts)
source venv/bin/activate && python run_server.py

# Just the frontend
cd "Barista Front End" && npm start

# Smoke test (backend must be up)
./tests/smoke/smoke_test_full.sh

# Apply DB migrations manually (also runs at app boot)
python -c "from services.migrations import apply_pending_migrations; from utils.database import get_db_connection; apply_pending_migrations(get_db_connection())"
```

Backend logs (when started in background by Claude):
`/tmp/expresso_backend.log` (`tail -50` to inspect).

Database: PostgreSQL, db name `expresso`. Access with
`psql expresso`. The bash command runs without sudo.

---

## 8. Brittleness audit (as of 2026-05-22)

These are real problems in the codebase that future work should
chip away at. Sorted by impact.

### High impact

1. **Wide use of localStorage as primary stock store**
   `coffee_stock_station_<id>` is the dialog's first read for stock,
   the backend `inventory_items` is the fallback. Should be flipped:
   backend is source of truth, localStorage is a write-through cache.
   Many "stale dropdown" bugs trace here.

2. **WalkInOrderDialog.js is ~1600 lines and does too much**
   State for: inventory loading, dialog form state, group lookup,
   tea options, station selection, optimistic UI, validation. Worth
   splitting into ~3 hooks + a thinner render component.

3. **DEFAULT_MILK_TYPES still in milkConfig.js**
   The catalog now exists but `WalkInOrderDialog` still imports
   `DEFAULT_MILK_TYPES` for milk fallback when API fails. Should
   read from `useCatalog('milk')` instead. The capability check
   already uses the catalog — wire the dialog next.

4. **Hardcoded drink lists still in coffee_system.py**
   `_STANDARD_DRINK_MENU = ["latte", "cappuccino", "flat white",
   "long black", "espresso", "mocha"]` — used by SMS recognition.
   Should source from `catalog_items WHERE category='drink'`.

5. **OrderDataService has `priority: true` removed but related
   classes might have similar issues**
   Search the codebase for other places hardcoded flags get set on
   walk-in requests. The bug was hidden for months because the
   backend's old comparison (`== 'vip'` literal) silently dropped
   the boolean true.

### Medium impact

6. **Status field strings are duplicated all over**
   `'pending'`, `'in-progress'`, `'completed'`, `'picked_up'` appear
   as string literals in 100+ places. A frontend `ORDER_STATUS`
   enum + backend constant would prevent typos like `'in_progress'`
   that have crept in.

7. **Notes-keyword VIP detection is fragile**
   `vipKeywords = ['vip', 'staff', 'organizer', 'organiser', 'priority']`
   in WalkInOrderDialog. A customer literally named "Vip" gets
   VIP'd. A staff member named "Priority" too. Should require the
   keyword to be a standalone word, OR drop this auto-detection
   entirely now that the VIP checkbox works.

8. **Multiple start scripts with overlapping behaviour**
   5 different startup scripts, each subtly different. Consolidate
   to one script with flags (`--with-twilio`, `--fast`, etc.).

9. **No backend hot-reload**
   `run_server.py` runs Flask in production mode. Adding `debug=True`
   or `flask --reload` would save a restart per backend change.
   Risk: dev-mode reload sometimes double-instantiates background
   services (Twilio reminder thread).

10. **Test framework is split across 4 directories**
    `test-framework/`, `test_framework/`, `tests/`, `test-results/`,
    and root-level `test-*.py` files. Consolidate to `tests/`.

11. **Frontend `apiConfig.js` has hardcoded base URLs**
    Production deploy still has the dev URL fallback baked in. The
    `setupProxy.js` fix is in place but the config still does
    weird URL gymnastics.

### Low impact (cosmetic / dev-experience)

12. **80+ React components in flat `components/` dir**
    Some are clearly grouped (`dialogs/`, `barista-tabs/`,
    `support-tabs/`) but most are top-level. Could split into
    `barista/`, `organiser/`, `display/`, `shared/`.

13. **Lots of `console.log` left in production code**
    Especially in `useOrders.js` and `WalkInOrderDialog.js`. A pre-build
    step could strip these or a `debug()` wrapper that no-ops when
    `process.env.NODE_ENV === 'production'`.

14. **Many `.md` docs are stale**
    `BACKEND_INTEGRATION_COMPLETE.md`, `CATEGORY-CONSISTENCY-FIX.md`,
    etc. — mostly snapshots from previous fix sessions. Worth a
    sweep to delete or fold into this onboarding doc.

15. **No frontend type-safety**
    No TypeScript, no PropTypes, no JSDoc types on most functions.
    Catalog work would benefit from a `Catalog` type definition
    even if it's just JSDoc.

---

## 9. Recent bug history (the things that bit us)

Useful as a "smell library" — if you see code that looks like the
cause of one of these, treat it as suspect.

| Date | Bug | Cause | Lesson |
|---|---|---|---|
| 2026-05-22 | Every walk-in tagged VIP | `OrderDataService.createWalkInOrder` hardcoded `priority: true` | Don't override user input in service layer |
| 2026-05-22 | "Whole Milk" ≠ "full cream" rejects reassign | No canonical option list, four independent name lists | Catalog architecture (now in place) |
| 2026-05-22 | Walk-ins appearing twice | Optimistic placeholder not removed on server confirm | Dedup by id only is fragile when ids are generated client-side AND server-side |
| 2026-05-22 | Drink names in Bean dropdown | Two inventory stores; localStorage had stale data | Always validate cached data against authoritative source |
| 2026-05-21 | "Add User" → "Authorization required" | `support_role_required` decorator used strict `@jwt_required()`, rejected demo tokens | Always use `_with_demo` variants |
| 2026-05-21 | Display rotation broken | CSS transform-origin + corner anchor recipe wrong | Test rotations actually rotate, don't trust by inspection |
| 2026-05-21 | Price tag missing on /orders | priceFormatted added to `/orders/pending` only, not `/orders` | Smoke test contract per endpoint catches this |
| 2026-05-21 | Order bouncing Start → back to upcoming | Race between optimistic update and refetch | Pin optimistic transitions with TTL |
| 2026-05-21 | "Cappuccino Latte" drink names | Coffee inventory category seeded with drink names; walk-in dialog prepended them as bean type | Validate before prepending |
| 2026-05-21 | Stock decrement warning on every completion | Matcher too strict (exact name match) | Cascade matcher (exact → partial → category fallback) |
| 2026-05-20 | Quick Setup not updating Event Inventory | Empty seed + case-sensitive Set.has + wrong event-name in dispatch | Multiple compounding bugs in one feature |
| 2026-05-20 | Organiser interface crash | `user.fullName.toLowerCase()` on undefined | Always guard nullable string operations |

Pattern across all of these: **assumptions about data shape that
nobody enforced.** The smoke test + catalog architecture are the
two structural fixes; everything else is whack-a-mole.

---

## 10. Tooling

- **Smoke tests:** `./tests/smoke/smoke_test_full.sh` against a running
  backend. Currently checks ~14 endpoints; failing tests indicate
  contract drift not necessarily bugs. See `tests/smoke/README.md`.
- **DB inspection:** `psql expresso -c "SELECT ..."` — no sudo, no
  password. Tables of interest: `orders`, `inventory_items`,
  `catalog_items`, `station_stats`, `settings`, `customer_preferences`,
  `users`.
- **Backend logs (Claude-managed):** `tail -50 /tmp/expresso_backend.log`
- **Frontend dev server:** auto-reloads on JS changes (React HMR).
- **Schema migrations:** apply at backend boot; logs say
  `[migrations] applying #N name` then `applied`.

---

## 11. Where to look first when something breaks

| Symptom | First place to look |
|---|---|
| Login fails | `auth_routes.py`, JWT_SECRET_KEY in `.env`, demo-mode flag |
| Walk-in submit hangs | DevTools Network → look for `/api/orders` POST; check optimistic placeholder dedup |
| Order missing from queue | DB `orders.station_id` matches user's selected station? `status='pending'`? |
| Capability rejection on Start/Reassign | `_station_can_make_order` in `consolidated_api_routes.py` |
| Stock doesn't decrement | `coffee_system._decrement_inventory_item` cascade matcher |
| SMS not received | Twilio webhook URL set + ngrok URL current; check `messaging.py` testing_mode flag |
| Backend won't start | `tail /tmp/expresso_backend.log` for traceback; check port 5001 not held |
| Frontend shows "Failed to fetch" | Backend up? Check `nc -z localhost 5001` |
| Branding/setting reverts | `_kv_get` / `_kv_put` paths; check the actual DB row in `settings` table |

---

That should be enough to orient. When in doubt: read the most
recent 20 git commits — they're each scoped and well-commented and
give a fast read on what's been touched lately.
