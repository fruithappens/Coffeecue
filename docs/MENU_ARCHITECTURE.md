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

## Sizes scale the recipe; specials ARE recipes (Steve, third pass)

> "likewise for size it varies how many ingredient go into it ...
> sometimes there are custom recipes like double shot, or possibly a
> magic coffee which is double ristretto so u use more beans less
> water, water might be important for those using jerry cans"

**A recipe is a small table, not a list.** Quantities are stated PER
SIZE, not scaled by a multiplier -- because drink scaling is not
linear (a large flat white is 2 shots, not 1.4):

| flat white | shots | beans | milk | water | cup |
|---|---|---|---|---|---|
| small | 1 | 22g | 150mL | -- | small |
| medium | 2 | 44g | 200mL | -- | medium |
| large | 2 | 44g | 280mL | -- | large |

Consequences that fall out for free:

- **Sizes are gate-1 choices too.** "Baristas might only offer medium"
  is just the menu enabling one size row. (Already live at Treenet.)
- **Availability derives PER SIZE.** When milk runs low, a large can
  grey out while a small stays orderable -- because gate 2 evaluates
  the size row's quantities, not the drink.
- **Named specials are first-class recipes, not options.** A magic is
  a double ristretto in a 3/4 cup: same beans as two shots, LESS
  water, less milk. That cannot be expressed as a delta on flat white
  without lying about something, so it gets its own rows and its own
  menu toggle, like any drink.
- **Options are deltas or substitutions on the resolved row.**
  Extra shot = +1 shot (+22g beans, +water). Decaf = substitute the
  bean ingredient. Oat = substitute the milk. Half strength = fewer
  grams, same water. Each is arithmetic on the size row, so the
  decrement stays recipe-driven.

**Water is an ingredient.** A cart running on jerry cans has a finite
water budget: long blacks and teas consume it directly, every shot
consumes some, a magic deliberately consumes less. A plumbed venue
simply does not stock the water row.

Which needs one general rule: **gate 2 checks only ingredients the
event actually TRACKS** (a row exists in inventory). No water row = no
water constraint. This is "absence means no opinion", the same
three-state rule the menu bridge uses -- NOT fail-open on error, which
stays loud.

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

## Decisions (Steve, 2026-08-26 — these are settled, do not re-litigate)

1. **Ledger shape: per-station, event = sum.** Each cart owns its milk
   crates and jerry cans; the event total is derived, never stored. A
   restock is a TRANSFER ("6L from van to station 2"), recorded as such.
   This kills the current ambiguity outright: today `inventory_items`
   half-supports station rows with event-wide fallback, while the Event
   Stock screen's "Allocated" numbers live in a separate
   `event_stock_levels` blob that NOTHING reads — allocation theatre.
   The rebuild collapses both into per-station ledgers.
2. **Sold-out behaviour: per-event choice.** A single event-level
   setting: `strict` (all channels refuse/grey the moment gate 2 fails)
   or `warn` (orders keep flowing, barista screens show low/out).
   Default for new events: strict.
3. **Barista override, both directions.** One tap to 86 an item
   regardless of the ledger (spill, carton off), one tap to force it
   back on. Reality beats arithmetic; overrides are logged with who and
   when, and show as overrides, not as computed state.
4. **Recipes ship as editable defaults.** Standard quantities prefilled
   (22g/shot, 150/200/280mL milk, 1 cup) so an event works out of the
   box; operators tune per event or per station when they care. A magic
   or house special is added as a new recipe, not a hack.

## Migration cautions (Steve: "this will need caution")

- Build alongside, not in place: new tables (ingredients, recipes,
  menu_items), a bridge that mirrors the old stores until cutover.
- The five `_get_available_*` accessors are the seam — they keep their
  signatures and switch source underneath, so no caller changes.
- Check 6 (menu-source AST guard) already forces all reads through
  those accessors, which is what makes this migration safe to do.
- Wipe/recreate, Quick Setup, and the Organiser editor all write menu
  state — every writer must move in the same release as the readers.
