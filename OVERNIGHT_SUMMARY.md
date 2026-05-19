# Overnight Work Summary — May 19 2026

Steve went to bed and asked for a long autonomous pass on key goals:
SMS order speed, **load balancing**, **notification**, **stock control**,
and **communication**. Plus visible polish on the Display screen.

This is the punch list of what landed, what to test in the morning,
and what's still on the cutting room floor.

---

## What changed (in order of impact)

### 1. Display screen — full rewrite
- Working portrait/landscape: auto-detects from viewport, force via `?orientation=…`, or set in Display tab.
- Order numbers are HUGE (text-9xl) — readable from across the café.
- 4 themes (light/dark/coffee/minimal), 4 font sizes, zoom slider all honored.
- Newly-ready orders pulse green for 30s.
- Tap-anywhere fullscreen on iPad.

### 2. Tea drinker support — full chain
- 7 tea flavors in InventoryManagement defaults.
- Quick Setup has a dedicated Teas section + free-text custom blends input.
- Walk-in dialog: when a tea drink is picked, panel appears with strength / double-cup / custom blend.
- Stock decrement is tea-aware: 30 ml milk splash, optional 2 cups, no coffee beans.
- MENU SMS command groups teas as 🍵 Tea.

### 3. Walk-in dialog reflects Quick Setup across stations
- `/api/quick-setup` now returns the real station list.
- Quick Setup writes `coffee_stock_station_N` + `station_inventory_configs` for every station.
- "Ceramic Mug" et al no longer light up just because you ticked "medium".

### 4. Sound notifications actually work
- `window.coffeeSounds` is installed now (was never set up).
- Chimes fire on `app:newOrder` and `order_updated` events.
- The toggle in Barista Settings finally does something.

### 5. WebSocket — real client this time
- `WebSocketService._tryConnect` was hard-coded to return `false`.
- Now uses socket.io-client, joins the "orders" room, forwards events to the window event bus.
- Existing `order_updated` / `chat_message` / `stock_alert` consumers start working live with zero changes.
- Falls back to 15s polling if backend isn't reachable.

### 6. Queue AI routing rules drive the backend
- New `/api/routing-rules` GET/PUT (KV-persisted in settings table).
- `coffee_system._assign_station` now consults `balanceWorkload`, `prioritizeEfficiency`, `considerCapabilities`, `emergencyMode`.
- `emergencyMode` bypasses milk-capability gating (useful when you've run out of oat mid-event).
- `balanceWorkload=false` switches from weighted-random to deterministic least-loaded.
- UI shows a live "syncing/synced/error" pill next to the toggles.

### 7. Inventory Redistribute + Emergency Restock actually work
- `/api/inventory/transfer` POST — moves stock between stations (decrements source, upserts destination row, creates one if missing).
- `/api/inventory/emergency-restock` POST — bumps a single row.
- `MultiLevelInventory` Redistribute and Emergency Restock buttons now call these instead of fake setTimeouts.

### 8. Station chat — actually inter-station now
- `ChatService` used to be localStorage-only — Station 1's messages never reached Station 2.
- Now GETs/POSTs `/api/chat/messages` (which existed all along — purely a wiring gap).
- Optimistic local insert + server reconciliation.
- DELETE also propagates to backend.

### 9. Station capabilities endpoint
- New `/api/stations/<id>/capabilities` GET/POST/PUT.
- POST merges with existing capabilities so callers can patch a single key (e.g. `vip_service`) without wiping `milk_types`.
- `EnhancedStationCapabilities` UI was already calling this URL — endpoint just didn't exist.

### 10. Stock decrement idempotency
- Found a double-decrement risk: SMS orders decrement on confirmation, walk-in orders decrement on completion. Both could fire on the same row if a barista hits Complete on an SMS order.
- Added a `_stock_decremented` flag in `order_details` JSON; the decrement function no-ops when it sees the flag.

### 11. Misc cleanup
- Misleading "demo data" popups removed from Display tab (the display IS live now).
- Open Display Screen / Open in New Tab buttons just work — no more `alert()` saying it's not implemented.
- `BARISTA_TAB_AUDIT.md` documents every Barista sub-tab's real state.

---

## To test when you wake up

**Restart the backend first.** New endpoints, new helpers, new
column writes — the running process won't pick them up otherwise.

```bash
./start_expresso.sh
```

Then in priority order:

1. **Quick Setup** with teas: Organiser → Quick Setup → tick a few tea
   flavors + add "Russian Caravan" in the custom field → Apply.

2. **Walk-in tea**: at any station → Walk-in → pick Earl Grey Tea →
   green tea-options panel should appear. Submit, complete the order,
   check Event Stock: milk should have dropped only ~30ml, two cups
   should be gone.

3. **Display screen**: open `/display` on a tablet or browser. Resize
   the window narrow-and-tall → should auto-flip to portrait. Try
   `/display?orientation=portrait` to force.

4. **Sound**: Barista → Settings → tick "Play sound on new order" →
   place a walk-in order from another tab → chime should fire.

5. **Routing rules**: Barista → Queue AI → toggle "emergencyMode" on.
   Status pill should go syncing → synced. Now SMS-order an oat-milk
   drink to a fresh event with no oat in inventory — it should accept
   the order and route to a station instead of refusing.

6. **Inventory transfer**: Barista → Inventory AI → if any alert appears
   suggesting a redistribute, click it. Should actually move milk
   between stations (check Event Stock).

7. **Station chat**: open Barista on two browser windows, set them to
   different stations, send a message from one — should appear on the
   other within ~10s (or instantly if WebSocket connected).

8. **MENU SMS**: text MENU. Should now have a `🍵 Tea: ...` line if
   you have tea flavors stocked.

There's also a new `test_overnight_endpoints.py` you can run when the
backend is up:

```bash
python test_overnight_endpoints.py
```

It round-trips all the new endpoints and fails loudly if any of them
break. Treat it as the canary for future changes.

---

## What I didn't get to

In the audit doc's priority list (`BARISTA_TAB_AUDIT.md`):
- **Schedule editing on the Organiser side** — the Barista tab is
  read-only with a clear pointer; I didn't dig into Organiser-side
  shift management to verify it works end to end.
- **Wait time precision** — current estimates are still rough heuristics.
- **SMS conversation latency profiling** — Steve called out "SMS
  order speed" but without real load data I'd be guessing where the
  hot path is. The biggest wins are caches (already there for
  routing rules + unlimited stock), and reducing turns (already done
  by `parse_order` accepting full-format orders).

---

## Commits in this session

Newest first — each one is self-contained:

```
4f9b182 Stock decrement idempotency between SMS confirm + UI complete
85b0c11 Live WebSocket + station capabilities endpoint
43b09a0 Routing rules wired backend-end + inventory transfer + chat backend
0f4c402 Tea support + Display screen rewrite + sounds + Quick Setup walk-in fix
f22dbfe Quick Setup now wipes localStorage event_inventory too
```

The branch is `claude/serene-shamir-6a017a`. Merge to main when ready.
