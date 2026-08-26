# Menu / Inventory Architecture — the September model

Design notes for the post-Wine-Centre rebuild. NOT to be built before
the September event; the current wiring is verified working and the
event is days away. This file exists so the rebuild starts from the
right vocabulary instead of rediscovering it.

## The vocabulary (Steve, 2026-08-26)

> "stock refers specifically to finished goods ready to be sold to
> customers, whereas inventory is a broader term that includes stock
> plus raw materials, work-in-progress items, and supplies"

Applied to a made-to-order coffee cart, where nothing sits pre-made:

| word | means | tracked? |
|---|---|---|
| **Inventory** | ingredients: beans (kg), milk (L), cups, syrups | YES — the only thing that decrements |
| **Recipe** | drink → ingredient quantities (latte = 1 shot + 200mL milk + 1 cup) | defined once, per drink |
| **Menu** | which recipes may be ordered — event default, per-station override | toggled, never counted |
| **"In stock"** (a drink) | DERIVED: every ingredient in its recipe is available | computed, never typed |

The rule that prevents "5kg of flat white" forever: **a drink never
carries a quantity, and an ingredient never appears on a menu.** The
current schema breaks this by mixing drink-named rows and bean rows in
one `coffee` category, so drink names ended up holding kilograms and
the bean decrement had to guess (fixed tactically in #409).

## Event vs station

One store, with inheritance — NOT an event menu AND a station menu
(two stores for one fact is the disease this whole day was about):

- The EVENT defines the default menu and holds the inventory.
- A STATION inherits the event menu unless explicitly overridden, and
  may hold its own inventory allocation (the venue counts cups per
  station, so allocation matters for reconciliation).
- The UI must show "inherited" vs "overridden" per station, so a
  global change visibly flows and an override is a visible decision.

## What this unlocks

- Stock decrement becomes recipe-driven: complete an order, decrement
  each ingredient by the recipe amount. One code path, no hand-tuned
  constants scattered through _decrement_stock_for_order.
- "Sold out" becomes honest: a drink greys out the moment any recipe
  ingredient runs dry, on every surface at once, because availability
  is derived from one place.
- Cup reconciliation (venue counts cups; we count orders) reads
  straight off the ingredient ledger.
- Decaf-style options are recipe VARIANTS (swap the bean ingredient),
  not bolt-on flags.

## Migration cautions (Steve: "this will need caution")

- Build alongside, not in place: new tables (ingredients, recipes,
  menu_items), a bridge that mirrors the old stores until cutover.
- The five `_get_available_*` accessors are the seam — they keep their
  signatures and switch source underneath, so no caller changes.
- Check 6 (menu-source AST guard) already forces all reads through
  those accessors, which is what makes this migration safe to do.
- Wipe/recreate, Quick Setup, and the Organiser editor all write menu
  state — every writer must move in the same release as the readers.
