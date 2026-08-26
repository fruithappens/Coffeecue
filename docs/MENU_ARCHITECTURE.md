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

## The two gates (Steve, 2026-08-26, second pass)

> "they might not want to make a recipe but have the ingredients ie dont
> make hot chocolate but might do mocha but still have the chocolate
> powder, but might not have decaf so all variation of that recipe cant
> be made, but might have lactose free"

Orderability is TWO independent questions, and conflating them is the
current system's core defect:

    Orderable(drink, options) =
        OnMenu(drink)                            <- gate 1: a CHOICE
        AND every ingredient in
            Recipe(drink, options) is Available  <- gate 2: a FACT

Gate 1 is the operator's decision and implies nothing about
ingredients. Gate 2 is derived from inventory and implies nothing about
the menu. Steve's own truth table:

| scenario | hot chocolate | mocha | why |
|---|---|---|---|
| choc powder stocked, hot choc OFF menu, mocha ON | refused | orderable | gate 1 differs; gate 2 passes both |
| decaf beans out | decaf VARIANT of everything refused | base drinks fine | gate 2 fails only the resolved variant |
| lactose-free stocked + on menu | latte w/ lactose-free orderable | — | both gates pass for that variant |

Variants (decaf, milk choice) are ingredient SUBSTITUTIONS inside the
recipe, so gate 2 is evaluated on the RESOLVED ingredient list, never on
the drink name.

## One resolver, three consumers

    resolve(drink, options) -> ingredient list | refusal(reason)

is the single enforcement point. Its three consumers:

1. **Menus** (SMS MENU, kiosk, walk-in tiles): grey/hide what resolve
   would refuse. Same function, so display can never disagree with
   acceptance.
2. **Acceptance** (every channel): SMS parse, kiosk POST, walk-in POST
   all call it. One gate, not three hand-kept copies -- the day this
   was written, decaf enforcement existed on two channels and not the
   third, in three different data shapes.
3. **Decrement**: the resolved ingredient list is STAMPED ON THE ORDER
   at acceptance, and completion replays the stamp. What was checked is
   exactly what is decremented, and a config change mid-queue cannot
   make the two disagree.

Interim rule already applied (PR pending): any fact arriving in
multiple shapes gets ONE interpreter function (`_requested_bean`), and
every reader calls it. Three shapes of decaf, interpreted three ways,
is how an SMS decaf order burned house blend after #409 "fixed" it.

## Migration cautions (Steve: "this will need caution")

- Build alongside, not in place: new tables (ingredients, recipes,
  menu_items), a bridge that mirrors the old stores until cutover.
- The five `_get_available_*` accessors are the seam — they keep their
  signatures and switch source underneath, so no caller changes.
- Check 6 (menu-source AST guard) already forces all reads through
  those accessors, which is what makes this migration safe to do.
- Wipe/recreate, Quick Setup, and the Organiser editor all write menu
  state — every writer must move in the same release as the readers.
