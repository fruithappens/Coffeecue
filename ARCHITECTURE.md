# Expresso — Architecture & Conventions

A living document for future Claudes (and humans). Read this before
making a change in any of the areas below — most of the codebase's
historical bugs came from new code drifting away from these conventions.

Last refreshed: 2026-05-20

---

## 1. Canonical strings

These exist in multiple spellings across the codebase. **Use the
canonical form for any new code and convert legacy code when you
touch it.** The audit script (`audit_inconsistencies.py`) flags
drift here.

| Concept | Canonical | Legacy variants to retire | Source of truth |
|---------|-----------|---------------------------|-----------------|
| Order is being made | `'in-progress'` | `'in_progress'` | The DB stores it with a hyphen. The legacy underscore version is what caused the "Start, order vanishes" bug. |
| Order picked up by customer | `'picked_up'` | `'picked-up'` | DB column is `picked_up_at` (underscore), and `routes/order_status_api.py` validates against `'picked_up'`. |
| Order ready (made but not collected) | `'completed'` | none | Only one spelling. |
| Order placed but not started | `'pending'` | none | Only one spelling. |

When **reading** from any source, accept both spellings (back-compat).
When **writing**, only use the canonical form.

Example (correct):
```js
const isInProgress = (s) => s === 'in-progress' || s === 'in_progress';
// ...
await updateOrderStatus(id, 'in-progress', {...});  // canonical write
```

## 2. API response shape — the camelCase contract

The React UI filters orders by `stationId` and reads fields like
`orderNumber`, `customerName`, `coffeeType`, `milkType`. The backend
*also* returns snake_case (`station_id`, `order_number`, etc.) for
legacy reasons.

**Every order endpoint MUST return both forms** for these fields:

| Snake | Camel | Filtered by frontend? |
|-------|-------|----------------------|
| `id` | `id` | — |
| `order_number` | `orderNumber` | — |
| `customer_name` | `customerName` | — |
| `phone_number` | `phoneNumber` | — |
| `coffee_type` | `coffeeType` | — |
| `milk_type` | `milkType` | — |
| `station_id` | `stationId` | **YES — per-station views break without it** |
| `created_at` | `createdAt` | — |
| `wait_time` | `waitTime` | — |
| `extra_hot` | `extraHot` | — |

The historical pattern that has bitten us: an endpoint returned
only snake_case → frontend filter `o.stationId` was undefined →
every order got filtered out → "my orders disappeared".

`/api/orders/pending` and `/api/orders/in-progress` are now both
compliant. New endpoints should follow `routes/consolidated_api_routes.py`
patterns for those.

## 3. Status → action endpoints

The backend exposes per-status endpoints, NOT a single PUT-with-status:

| Action | Endpoint | Method |
|--------|----------|--------|
| Start an order | `/api/orders/<id>/start` | POST |
| Complete an order | `/api/orders/<id>/complete` | POST |
| Mark as picked up | `/api/orders/<id>/pickup` | POST |

The frontend's `OrderDataService.updateOrderStatus()` maps the
canonical status string → endpoint via a lookup table. Adding a new
order status? Add both the backend endpoint AND the mapping entry.

There is also a legacy `PUT /api/orders/<id>/status` in
`routes/order_status_api.py` that takes a status string in the body
and normalizes it. Keep it working but don't extend it.

## 4. Settings stores (localStorage)

**Two** localStorage keys, each with a single clear purpose
(consolidated from three in May 2026 — see git history):

| Key | Owner | Read by | Backend-synced? |
|-----|-------|---------|----------------|
| `coffee_cue_settings` | `useSettings` hook + `BaristaInterface.setSettings` | Everything — DisplayScreen, Organiser, Barista, etc. | No, localStorage only |
| `coffee_system_branding` | `SettingsService` | Branding panel + display config endpoint | Yes — mirrored to backend `branding_settings` row |

**Convention for writing settings:**

```js
// from inside any component
setSettings({ ...settings, showNameOnDisplay: false });
// → BaristaInterface.setSettings merges into coffee_cue_settings
//   AND dispatches 'settings:updated' so useSettings re-reads.
```

The legacy `coffee_cue_barista_settings` key was retired. On first
mount after the consolidation, `BaristaInterface.loadSettings()`
checks for a stale copy and migrates it into the canonical store.

**Why branding stays separate:** branding settings (event name,
sponsor, colors) round-trip through the backend's
`/api/settings/branding` endpoint so they propagate to other
machines/users; the local settings are per-browser preferences
(sounds, autorefresh, default station).

## 5. localStorage keys — categories

Full inventory in `AUDIT_REPORT.txt` (~150 distinct keys). Working
categories the active code touches:

- **Auth**: `coffee_auth_token`, `coffee_refresh_token`, `coffee_system_token` (the last one is legacy; ApiService falls back to both).
- **Settings**: see section 4 above.
- **Per-station stock**: `coffee_stock_station_${id}` — what the Barista UI + walk-in dialog read. Quick Setup populates these.
- **Station configs**: `station_inventory_configs` (canonical), `stationInventoryConfig` (legacy mirror — kept in sync by Quick Setup).
- **Event inventory**: `event_inventory` — the master list edited by Organiser → Inventory Management.
- **Routing rules**: `coffee_cue_routing_rules` — local cache mirroring the backend's `/api/routing-rules`.
- **Chat**: `coffee_chat_messages` — local cache mirroring `/api/chat/messages`.
- **Demo mode**: `demo_mode_enabled`, `use_fallback_data`, `coffee_cue_app_mode` — these gate the FallbackService.
- **Station naming (variable-name drift only)**: `coffee_station_name_${selectedStation}` / `${station.id}` / `${stationId}` are three spellings of the same data. They all resolve to the same actual localStorage key for a given station ID, so they're functionally fine — but cosmetic style drift. Canonical: `coffee_station_name_${stationId}`.
- **Selected station — intentional dual write**: `coffee_cue_selected_station` (canonical) AND `last_used_station_id` (mirror) are written together. Readers prefer the first, fall back to the second. Keep both writes in sync if you touch the code.

### Deferred cleanup (known dead code, retired in a future pass)

These keys are referenced by code that's either no longer reached
or only kicks in for disabled features. They don't break anything,
but cleaning them up reduces noise:

| Key(s) | Lives in | Status |
|--------|---------|--------|
| `html_etag`, `html_last_modified` | `DeploymentService.js` | Service is disabled in dev (`NODE_ENV !== 'production'` short-circuit). Production-only "Update available" banner machinery. Don't break — just unused. |
| `migration_completed`, `migration_date` | `DatabaseInventoryService.js` | One-shot localStorage migration flag from an old refactor. Harmless. |
| `demoSpeed`, `demo_data_initialized`, `coffee_cue_hidden_demo_items`, `connectionMode`, `demoMode`, `offlineMode` | Various | Demo-mode infrastructure. Used only when the operator explicitly switches to demo mode. |
| `JWT_SIGNATURE_ERROR`, `coffee_debug_milk_colors` | Error/debug paths | Diagnostic flags. Worth keeping for now. |
| `coffeeMenu`, `event_menu`, `event_menu_version` | Multiple | Older menu-shape caches. May overlap with `event_inventory`; needs verification before removal. |
| `coffee_system_user`, `coffee_system_users`, `user` | Multiple | Three keys for similar data. Auth-related; `coffee_system_token` flow is the canonical path. |

When adding a new localStorage key:

1. Prefix it with `coffee_cue_` (the active convention).
2. Document it here under the relevant category.
3. Use `JSON.stringify`/`JSON.parse` — most existing keys are JSON.
4. If it stores something the backend should know about, mirror it
   to a `/api/...` KV setting too (see Quick Setup for the pattern).

## 5b. Customer Display screen — where each piece of text comes from

The `/display` route's UI elements are sourced as follows. Knowing
this saves you 30 minutes of grepping when an operator says "where
do I change X?".

| UI element | Backend source | Operator edits via |
|------------|---------------|--------------------|
| Big header (e.g. "ANZCA ASM 2025") | `branding_settings.event_name` (falls back to `clientName`, `landingTitle`) | Organiser → Branding & Display → **Event Name** |
| Header color bar | `branding_settings.headerColor` / `primaryColor` | Branding & Display → color picker |
| Station name + location subtitle | `station_stats.name` / `station_stats.location` | Organiser → Stations → edit station |
| Sponsor banner | `branding_settings.sponsorEnabled` + `sponsorName` + `sponsorMessage` | Branding & Display (toggle + fields) |
| Footer SMS number | `TWILIO_PHONE_NUMBER` env var → `branding_settings.smsNumber` | `.env` OR Branding & Display → **SMS Order Number** |
| Footer custom message | `branding_settings.customMessage` / `footerText` | Branding & Display → Footer Text |
| Theme (light/dark/coffee) | `coffee_cue_settings.displayTheme` | Barista → Display tab |
| Font size | `coffee_cue_settings.displayFontSize` | Barista → Display tab |
| Zoom | `coffee_cue_settings.displayZoom` | Barista → Display tab |
| Portrait/landscape | URL `?orientation=…` OR `coffee_cue_settings.displayMode` | URL param or Barista → Display tab |
| "All Stations" option in selector | hardcoded fallback | n/a (intentional) |
| "Live · refreshes every 15s" subtitle | hardcoded | n/a (intentional) |

**The hardcoded "123 456 789" bug:** an old SettingsService default
shipped `smsNumber: '+61 123 456 789'` as a placeholder. When no
branding override was set, this placeholder showed on the display
looking like a real number. Default is now blank — display falls
back to "Number coming soon" so an operator immediately knows what
needs configuring.

## 6. Quick Setup behavior

When the operator clicks "Apply Quick Setup", the following changes
happen atomically (or as atomically as multiple stores allow):

1. `POST /api/quick-setup` wipes and rebuilds the `inventory_items` table.
2. `station_stats.capabilities` JSONB updated on every row (if `all_stations_same_capabilities`).
3. `event_breaks` cleared (if `always_open_schedule`).
4. `settings.unlimited_stock_mode` flag set/cleared.
5. **Frontend**: rebuilds `localStorage.event_inventory` so InventoryManagement reflects.
6. **Frontend**: rebuilds `localStorage.coffee_stock_station_${id}` for every station from the backend's station list.
7. **Frontend**: rebuilds `localStorage.station_inventory_configs` + `stationInventoryConfig`.

If you add a new inventory category, all six places need an update.

## 7. Inventory data model (post May 2026)

Three stores, each with a clear role:

| Store | Role | Source of truth | Read/written by |
|-------|------|-----------------|----------------|
| `settings.event_inventory` (Postgres KV) | **Master menu list** — what's on offer, with `enabled` flags. The "what can a customer order" config. | ✅ Yes | `EventInventoryService` on the frontend; SMS bot can also consult via `/api/event-inventory` |
| `localStorage.event_inventory` (per browser) | Write-through cache of the above. Lets the UI render instantly without a backend round-trip. | No — cache only | `EventInventoryService` mirrors writes here; legacy components still read it directly |
| `inventory_items` (Postgres table) | **Stock levels** — how much of each item exists, optionally per station. The "what can the bar actually make right now" data. | ✅ Yes (for quantities) | `_get_available_*` SMS helpers, `_decrement_stock_for_order`, Quick Setup |
| `station_inventory_configs` / `stationInventoryConfig` (localStorage) | Per-station overrides — which items each station offers. | No — derived from event_inventory + Quick Setup all_stations_same toggle | Walk-in dialog filter, station stock UI |

**Source-of-truth rule:** for the master menu list, **the backend wins**. Use `EventInventoryService.load()` / `.save()` to read/write — it handles the mirror and the offline fallback.

When the UI needs to know "what's on the menu", `EventInventoryService.load()` does:
1. Backend GET `/api/event-inventory`
2. If backend has data → cache it locally, return it
3. If backend is empty and localStorage has data → migrate localStorage → backend (one-shot bootstrap)
4. If backend is offline → serve from localStorage cache, retry next call

This collapses what used to be three parallel write paths into one.

## 7b. Schema migrations

Run automatically at every boot. See `services/migrations.py`.

Each migration is a small idempotent function. The runner records
applied versions in the `schema_migrations` table and skips them next
time. To add a new schema change:

```python
def _m006_my_new_thing(cur):
    """One-line description for the boot log."""
    cur.execute("ALTER TABLE foo ADD COLUMN IF NOT EXISTS bar TEXT")

MIGRATIONS = [
    # …existing migrations…
    Migration(6, 'my_new_thing', _m006_my_new_thing),
]
```

**Do not renumber existing migrations.** Append at the bottom.

Migrations 1-5 replicate the scattered `ALTER TABLE IF NOT EXISTS`
calls that used to live in `coffee_system._init_event_scheduling`.
Those calls can stay for now (belt-and-braces) — they're no-ops on
a DB that's already had migrations run.

## 8. Order number format

Order numbers are: `${event_prefix}${seq_number}`.

- `event_prefix`: 0-6 alphanumeric chars from `settings.order_prefix` (set via `PUT /api/order-prefix`). Empty by default.
- `seq_number`: `nextval('order_number_seq')` — a monotonic Postgres sequence.

Legacy fallback when the sequence is unavailable: time-based
`{prefix}{HHMMSS}{microseconds//10000}` e.g. `W0544296`. SMS prefix is
`A` (AM) or `P` (PM); walk-in prefix is `W` (walk-in) or `O` (other).

If you see ugly long order numbers in the UI, the sequence is
broken on that DB — check that `order_number_seq` exists.

## 9. WebSocket events

The backend (Flask-SocketIO) emits these events. The frontend
listens via `WebSocketService` and forwards them to window events
that `ApiService` + `SoundNotificationService` + `OrderDataService`
consume.

| Backend emit | Window event | Effect |
|--------------|-------------|--------|
| `order_created` | `order_created` | Order cache invalidated |
| `new_order`     | `app:newOrder` | Chime plays |
| `order_updated` | `order_updated` | Order list refresh |
| `chat_message`  | `chat:new_message` | Chat panel refresh |
| `stock_update`  | `stock:update` | Stock UI refresh |
| `stock_alert`   | `stock:alert` | Alert banner |
| `station_update`| `station:update` | Station selector refresh |

Each station-scoped event is emitted to `room='station_${id}'`; the
frontend joins via `webSocketService.joinRoom('station_2')` (or via
`apiService.joinStationRoom(2)`).

## 11. Pricing — honor-system model

When `pricing_settings.enabled` is true, the SMS conversation flow
appends the computed total to the confirmation message and asks the
customer to pay at the counter at collection time. **No card
processing** — this is an honor-system feature aimed at churches,
community cafés, and free events that occasionally need to recoup
costs.

### Price formula

```
total = base_drink_price
      + milk_surcharge (e.g. oat +$0.50)
      + size_surcharge (large +$0.50, small -$0.50)
      + sugar_surcharge_per_sachet × sachets
```

`base_drink_price` looks up the drink name (lowercased) in
`pricing_settings.per_drink`. Falls back to `unknown_drink_price`
(default $4.50) for unrecognized drinks. Decaf prefixes are stripped
so "decaf latte" matches `latte` pricing.

### Where to configure

- **Organiser → Quick Setup → Pricing (honor system)** — toggle, edit
  prices.
- Or direct API: `PUT /api/pricing-settings` with a partial JSON blob.

### Where prices appear

| Surface | Source | Toggle |
|---------|--------|--------|
| SMS confirmation message | `_compute_order_price()` + `_format_price_tail()` | `pricing_settings.show_in_sms` |
| Walk-in dialog (preview) | not yet implemented | `pricing_settings.show_in_walkin` (future) |
| Barista order card price tag | `order.priceFormatted` field returned by `/api/orders/pending` + `in-progress` | `pricing_settings.show_in_barista` |
| Customer Display screen | not implemented (intentional) | `pricing_settings.show_on_display` (future) |

### Implementation notes for future Claudes

- The price is computed and stashed onto `order_details.price` +
  `order_details.price_formatted` at confirm time (SMS flow:
  `_confirm_order`; walk-in: `/api/orders` POST handler).
- It's stored on the order — re-computing later (e.g. on pickup)
  uses the stamped value, not the live `pricing_settings`. That
  way changing prices mid-event doesn't retroactively change what
  a customer agreed to pay.
- Cache: `coffee_system._pricing_cache` invalidated by the
  `PUT /api/pricing-settings` endpoint. Same pattern as the routing
  rules cache.

## 10. Tests & smoke checks

| Script | What it covers |
|--------|----------------|
| `test_overnight_endpoints.py` | Routing rules + inventory transfer + emergency restock + capabilities round-trip |
| `test_persistence_and_data_shapes.py` | Settings round-trips + camelCase contract |
| `test_sms_conversation_flow.py` | SMS state machine, mocked DB |
| `test_e2e_event_scenario.py` | 15 live HTTP scenarios |
| `test_browser_*.py` | Playwright UI scenarios |
| `audit_inconsistencies.py` | Cross-codebase drift (this doc's source) |

Run the audit after big changes:
```bash
python audit_inconsistencies.py
```
Numbers should go DOWN over time.

---

## Future enhancements roadmap

In priority order. None of these are blocking the current event use
case — they're cleanup / depth.

### High-leverage (would fix recurring bugs)

1. ~~**Source-of-truth inventory.**~~ ✅ Done May 2026 — `settings.event_inventory` KV is now authoritative for the master menu list. `EventInventoryService` handles read/write with localStorage as a write-through cache. See section 7.
2. ~~**Single settings store.**~~ ✅ Done May 2026 — `coffee_cue_settings` is now canonical for local prefs; `coffee_system_branding` stays separate for backend-synced branding.
3. ~~**WebSocket-driven order updates.**~~ ✅ Done May 2026 — `useOrders` + DisplayScreen now both refresh on `order_created` / `order_updated` / `app:newOrder` window events forwarded from the WebSocket. Polling kept as a 15s fallback for when the WS is offline.
4. **Status field cleanup.** Once everyone's migrated to `'in-progress'` and `'picked_up'`, drop the back-compat in `OrderDataService.getOrders` and friends.

### Medium

5. **Real capabilities editing UI.** The endpoint exists (`/api/stations/<id>/capabilities`); the UI is mostly read-only.
6. **Per-event reporting.** Each event currently shares the global orders table; pull a date/event filter through the UI.
7. **Better wait-time prediction.** The current heuristic is `pending_count × 4 min`. With historical completion times we could do better.
8. **Tea support in SMS flow.** The infrastructure (inventory rows, walk-in UI, stock decrement) is in place; the SMS conversation state machine (`coffee_system.py`) doesn't ask "which tea?" yet.

### Polish / depth

9. ~~**Build out the placeholder buttons.**~~ ✅ Done May 2026 — all 8 `() => console.log(...)` onClicks are wired to real endpoints (Pause All Orders, Broadcast, Announce, Manual SMS, etc.) or properly disabled with tooltips explaining where the functionality lives.
10. ~~**Schema migrations as code.**~~ ✅ Done May 2026 — `services/migrations.py` runs at boot. Pending migrations get applied automatically; the `schema_migrations` table tracks what's been done. Adding a new schema change = append one entry to `MIGRATIONS`. See section 7b.
11. ~~**Twilio webhook signature verification.**~~ ✅ Already implemented in `routes/sms_routes.py` (gated by `TWILIO_AUTH_TOKEN` env var ≠ 'test_token'). The CLAUDE.md note was stale.

### Deferred

12. **Customer-facing native app.** The customer interface is the SMS bot. The `/api/customer/*` endpoints exist but no UI ever called them — likely dead.
13. **Multi-event UI.** Tickets sit in one table with no event_id. Refactor only if running concurrent events on the same instance.

---

## How this file gets updated

When you do something that touches a convention above, **update
this file in the same commit**. Future Claude (or future Steve)
shouldn't have to re-derive these.

When in doubt, run:

```bash
python audit_inconsistencies.py
```

If the numbers are going up, something's drifting. Investigate.
