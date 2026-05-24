# Barista Interface — Sub-Tab Audit

What each tab in the Barista interface actually does, what's wired to
backend vs. localStorage-only, and what's a stub. Written 2026-05-19
during the overnight pass.

## Tabs (left to right)

### 1. Orders (default)
**Status:** ✅ Fully working
- Real pending / in-progress / completed orders from `/api/orders/*`.
- Start, complete, pickup, message buttons all hit backend.
- VIP priority, batching, time pressure bar all working.

### 2. Stock
**Status:** ✅ Functional — reads per-station `coffee_stock_station_N` localStorage that Quick Setup populates.
- Shows real-time stock levels.
- Decrements happen on order completion (newly wired May 2026).
- Manual adjustments persist locally.

### 3. Inventory AI
**Status:** ⚠️ Read-only analytics + placeholder actions
- Component: `MultiLevelInventory.js`
- Reads real inventory data and computes per-station consumption rates.
- "Redistribute" button is a placeholder (1s setTimeout, no API call).
- "Emergency Restock" calls `/api/inventory/emergency-restock` which doesn't exist on backend.
- **Value as-is**: useful situational awareness; don't expect buttons to do anything.

### 4. Schedule
**Status:** ⚠️ Read-only display
- Shows shifts, breaks, predicted rush periods from `useSchedule` hook.
- Has a clear info banner pointing operator to Organiser → Schedule for actual editing.
- "Rush period analytics will be added soon" placeholder visible.

### 5. Completed
**Status:** ✅ Fully working
- Lists orders the station has completed today.
- Station filter works correctly (was broken; fixed earlier this session).

### 6. Display
**Status:** ✅ Now works correctly (rewritten May 2026)
- Open Display Screen / Open in New Tab buttons.
- All settings persist via `useSettings` (theme, font size, orientation, layout, etc.).
- The customer-facing `/display` route now respects all of those settings.
- The misleading "demo data" alert has been removed — the display is live.

### 7. Queue AI
**Status:** ⚠️ Read-only analytics
- Component: `QueueIntelligence.js`
- Computes per-station load %, wait time estimates, routing efficiency from real orders/stations.
- "Routing rules" checkboxes (prioritizeEfficiency, balanceWorkload, considerCapabilities) persist to `coffee_cue_routing_rules` in localStorage **only**.
- Backend `_assign_station` in `services/coffee_system.py` does its own load balancing — these UI toggles don't influence it.
- **Value as-is**: useful dashboard; toggles are decorative.

### 8. Balance
**Status:** ⚠️ Read-only analytics
- Component: `StationLoadBalancer.js`
- Shows load distribution; suggests reassignments.
- "Rebalance" actions are not wired to a backend endpoint.

### 9. Capabilities
**Status:** ⚠️ Partial — UI works, persistence partial
- Component: `EnhancedStationCapabilities.js`
- Lets operator see and (probably) edit which milks/drinks each station offers.
- Quick Setup writes `station_stats.capabilities` (JSONB) — this tab should read/write the same column.

### 10. Staff
**Status:** ⚠️ Read-only analytics
- Component: `DynamicStaffAllocation.js`
- Suggests staff allocation based on order volume.
- No backend persistence of allocations.

### 11. Settings
**Status:** ✅ Working — settings persist via `useSettings` / `SettingsService`
- Auto-refresh interval ✓
- Sound notifications toggle ✓ (was inert before May 2026 — now `SoundNotificationService` actually plays sounds via `window.coffeeSounds`)
- Sound volume slider ✓
- Test buttons play preview chimes ✓

### 12. Messages
**Status:** Not yet checked in this audit. (Steve mentioned "Message center functionality coming soon" placeholder.)

---

## What the Customer Display screen reads (for context)

The `/display` route is its own React component (not a tab). It now:
1. Auto-detects portrait vs landscape from viewport
2. Or accepts `?orientation=portrait` / `?orientation=landscape` URL params to force
3. Or respects `settings.displayMode` from the Barista → Display tab
4. Has 4 themes (light, dark, coffee, minimal) and 4 font sizes
5. Shows pending+in-progress as "Brewing", completed as "Ready"
6. Pulses newly-ready orders for 30 seconds
7. Tap-anywhere goes fullscreen (handy on iPad)
8. Auto-refreshes every 15 seconds

---

## Priorities for future polish

In order of impact for Steve's "cafe at an event" use case:

1. **Wire Queue AI routing rules to backend** — operators expect the
   load-balancing toggles to actually influence assignments.
2. **Inventory AI "Redistribute" button** — implement
   `POST /api/inventory/transfer` to move stock between stations.
3. **Capabilities tab** — read/write `station_stats.capabilities`
   so per-station milk/drink restrictions are editable in the UI
   (Quick Setup currently sets them all the same; granular editing is missing).
4. **Messages tab** — either complete the inter-station chat that
   exists in the schema, or remove the tab.
5. **Audit Schedule editing** — currently the Barista tab is
   read-only with a pointer to Organiser; that's fine but the
   Organiser side needs verification too.
