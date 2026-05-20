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

Three localStorage keys exist for overlapping data:

| Key | Owner | Read by |
|-----|-------|---------|
| `coffee_cue_barista_settings` | `BaristaInterface.js` Settings tab | the Settings tab itself, on mount |
| `coffee_cue_settings` | `useSettings` hook | DisplayScreen, Organiser, many components |
| `coffee_system_branding` | `SettingsService` | branding panel + display config endpoint |

**Convention:** when writing settings, mirror into all three
(or at least the appropriate two) and dispatch a `'settings:updated'`
window event so any listening hook re-reads. `BaristaInterface.setSettings`
already does this — copy that pattern.

The right long-term fix is one store + a backend round-trip, but
that's substantial refactor. Mirror-and-event is the pragmatic
compromise.

## 5. localStorage keys — categories

Active categories (from the audit; see `AUDIT_REPORT.txt` for the
full inventory):

- **Auth**: `coffee_auth_token`, `coffee_refresh_token`, `coffee_system_token` (the last one is legacy; ApiService falls back to both).
- **Settings**: see section 4 above.
- **Per-station stock**: `coffee_stock_station_${id}` — what the Barista UI + walk-in dialog read. Quick Setup populates these.
- **Station configs**: `station_inventory_configs` (canonical), `stationInventoryConfig` (legacy mirror — kept in sync by Quick Setup).
- **Event inventory**: `event_inventory` — the master list edited by Organiser → Inventory Management.
- **Routing rules**: `coffee_cue_routing_rules` — local cache mirroring the backend's `/api/routing-rules`.
- **Chat**: `coffee_chat_messages` — local cache mirroring `/api/chat/messages`.
- **Demo mode**: `demo_mode_enabled`, `use_fallback_data`, `coffee_cue_app_mode` — these gate the FallbackService.

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

## 7. The two parallel inventory systems

A historical wart that keeps biting:

- **`inventory_items`** table (Postgres) — what the SMS bot reads when matching milks/coffees and what `_decrement_stock_for_order` updates.
- **`event_inventory`** localStorage — what `InventoryManagement.js` displays.

Plus a third store:

- **`stationInventoryConfig`** / **`station_inventory_configs`** — per-station overrides used by walk-in and station-stock UIs.

Quick Setup writes all three. Manual UI changes write to whichever
store the UI is wired to — meaning hand-edits in InventoryManagement
DON'T propagate to `inventory_items`, and vice versa. This is the
inconsistency Steve flagged about milks at different stations.

Long-term fix: pick the backend table as the source of truth and
have InventoryManagement read/write through an API. Not done yet.

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

1. **Source-of-truth inventory.** Make `inventory_items` (Postgres) the only store; have InventoryManagement.js read/write via API. Removes the two-parallel-stores problem in section 7.
2. **Single settings store.** Pick `coffee_cue_settings` as canonical; migrate readers off the other two. Section 4.
3. **WebSocket-driven order updates.** The plumbing is wired; the consumer hooks (`useOrders`) still poll every 15s. Switching to push would feel ~10× snappier.
4. **Status field cleanup.** Once everyone's migrated to `'in-progress'` and `'picked_up'`, drop the back-compat in `OrderDataService.getOrders` and friends.

### Medium

5. **Real capabilities editing UI.** The endpoint exists (`/api/stations/<id>/capabilities`); the UI is mostly read-only.
6. **Per-event reporting.** Each event currently shares the global orders table; pull a date/event filter through the UI.
7. **Better wait-time prediction.** The current heuristic is `pending_count × 4 min`. With historical completion times we could do better.
8. **Tea support in SMS flow.** The infrastructure (inventory rows, walk-in UI, stock decrement) is in place; the SMS conversation state machine (`coffee_system.py`) doesn't ask "which tea?" yet.

### Polish / depth

9. **Build out the placeholder buttons (Tier 3 in AUDIT_FINDINGS.md).** Each needs a decision: build or remove.
10. **Schema migrations as code.** Currently schema drift is fixed by `ALTER TABLE IF NOT EXISTS` calls scattered through `services/coffee_system.py:_init_event_scheduling`. A proper migration tool would help.
11. **Twilio webhook signature verification.** Currently missing per `CLAUDE.md`. Important before deploying anywhere public.

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
