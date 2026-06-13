# Persistence matrix — Phase 2 findings (2026-06-13)

Harness: `python tests/persistence/run_persistence_matrix.py` → **4/4** after
fixing the category-whitelist bug (below). Plus a two-store comparison of
`/api/inventory` (inventory_items — what the SMS bot reads) vs
`/api/event-inventory` (the Organiser UI's store).

## 🔴 Fixed this session

- **Category whitelist swallowed API writes**: `InventoryItem.CATEGORIES`
  didn't include `drinks`/`sugar`, so `create()` silently rewrote those rows
  to `'other'` — a drink added via the API vanished from every query and the
  SMS bot never saw it. Whitelist now covers all categories the system reads.

## 🔴 Open bug (next up): disabling a coffee in the Organiser does NOT remove it from SMS

The Organiser store has **americano disabled**, but the bot still offers and
sells it: the espresso menu is the hardcoded `_STANDARD_DRINK_MENU` in
`services/coffee_system.py`, gated only on bean stock — it never consults the
Organiser's enabled flags. Concrete repro: organiser coffee-enabled list is
`cappuccino, espresso, flat white, latte, long black, mocha`, yet the bot's
refusal lists `americano, cappuccino, cortado, espresso, …` (11 drinks).
**Fix direction:** `_get_available_coffee_types()` should intersect
`_STANDARD_DRINK_MENU` with the event-inventory coffee category's enabled
names whenever that store is non-empty.

## 🟠 Structural drift between the two stores (the documented gotcha, quantified)

| Dimension | Organiser store says | Bot store says | Verdict |
|---|---|---|---|
| Milks | almond milk, lactose-free milk, oat milk, skim milk, **whole milk** | almond, lactose free, oat, skim, **full cream** | same 5 semantically, but every NAME differs — naive string comparison breaks |
| Espresso drinks | 6 enabled (americano disabled) | hardcoded 11-drink menu | **americano bug above** |
| Sweeteners | "white sugar" (a product) | "no sugar / 1 sugar / 2 sugar" (quantities!) | different MODELS, not just names |
| Cups | small only | small, medium, large | medium+large were seeded into the dev DB by the test harness — self-inflicted, but proves writes to one store don't touch the other |

## Notes for the harness

- Local dev DB now has medium+large cups seeded (the SMS scenario suite
  expects a 3-size event). A future improvement: scenario setup should write
  its own catalogue through the API instead of assuming.
- `unlimited_stock_mode` is enabled locally (Quick Setup default): amount=0
  does NOT refuse — by design. The matrix is mode-aware.
- Still to do in Phase 2 (browser half): walk-in dialog + barista stock UI
  surfaces vs these two stores, localStorage hydration on reload, and
  second-browser persistence. Frontend boots with
  `cd "Barista Front End" && BROWSER=none npm start`.
