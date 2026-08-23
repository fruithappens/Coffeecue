// Working out what a completed order actually consumed.
//
// Extracted from useOrders so it can be tested directly. Three faults
// lived here, and every one of them silently reported the wrong stock
// rather than failing loudly:
//
//   1. Size was read from the DRINK field. `coffeeType` holds "latte" or
//      "flat white" -- never "large" -- so the size test never matched
//      and EVERY order depleted the medium default: medium milk, medium
//      beans and, worst of all, a medium cup. A cart could run out of
//      large cups with the system still showing 100 in stock.
//
//   2. Only skim, almond and soy were mapped. Oat, lactose free,
//      coconut and macadamia all fell through to full cream, so the
//      alternative milks never depleted and full cream depleted about
//      twice as fast as it really did. At CTN26 that was 11 orders.
//
//   3. "No milk" depleted 250ml of full cream. Ten long blacks at CTN26
//      each took a quarter litre of milk that was never poured.
//
// Where a milk cannot be resolved this returns null and the caller
// skips it. Skipping is deliberate: guessing wrong corrupts two numbers
// at once -- the milk that silently drained and the one that never did.

export const SIZE_KEYS = ['small', 'medium', 'large'];

// Litres of milk, kilos of beans, per cup size.
export const MILK_PER_SIZE = { small: 0.15, medium: 0.25, large: 0.35 };
export const BEANS_PER_SIZE = { small: 0.008, medium: 0.015, large: 0.022 };
export const CUP_ID_PER_SIZE = {
  small: 'cups_small', medium: 'cups_medium', large: 'cups_large',
};

// Names that mean "there is no milk in this drink". A long black must
// deplete nothing, not the default.
const NO_MILK = ['no milk', 'none', 'no', 'black', 'without milk', 'skip milk'];

// Fallback ids for the common milks, used only when the station's own
// stock list has nothing matching by name.
const MILK_ID_BY_NAME = {
  'full cream': 'milk_regular',
  regular: 'milk_regular',
  whole: 'milk_regular',
  dairy: 'milk_regular',
  normal: 'milk_regular',
  skim: 'milk_skim',
  skinny: 'milk_skim',
  'low fat': 'milk_skim',
  soy: 'milk_soy',
  almond: 'milk_almond',
  oat: 'milk_oat',
  'lactose free': 'milk_lactose_free',
  coconut: 'milk_coconut',
  macadamia: 'milk_macadamia',
  rice: 'milk_rice',
  a2: 'milk_a2',
};

/** Lowercased, "milk" suffix removed, punctuation flattened: "Oat Milk" -> "oat". */
export const normalizeMilkName = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s*milk\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * The cup size for an order.
 *
 * The order's own `size` field is authoritative. SMS orders often carry
 * the size only inside the drink text ("large flat white"), so that is
 * the fallback -- which is all the old code ever looked at, and why it
 * always came back medium.
 */
export const resolveSize = (order) => {
  const explicit = String(order?.size || '').toLowerCase();
  const found = SIZE_KEYS.find((s) => explicit.includes(s));
  if (found) return found;
  const drink = String(order?.coffeeType || order?.coffee_type || '').toLowerCase();
  return SIZE_KEYS.find((s) => drink.includes(s)) || 'medium';
};

/**
 * Which milk in this station's stock the order consumes.
 *
 * Returns null when the drink has no milk, and null when nothing in
 * stock matches -- the caller must treat both as "deplete nothing".
 * Matching against the station's real stock first means a milk the
 * Organiser added by hand still depletes, without this file knowing
 * its name.
 */
export const resolveMilkId = (order, stockItems = []) => {
  const raw = String(order?.milkType || order?.milk_type || '').toLowerCase().trim();
  if (!raw || NO_MILK.includes(raw)) return null;
  const name = normalizeMilkName(raw);
  if (!name || NO_MILK.includes(name)) return null;

  const items = Array.isArray(stockItems) ? stockItems : [];

  // 1. Exact match against what this station actually stocks.
  const exact = items.find((it) => normalizeMilkName(it?.name) === name);
  if (exact?.id) return exact.id;

  // 2. Partial, for "Oat" stocked against an order saying "oat barista".
  //    Guarded by length so a one-character stock name cannot swallow
  //    every order.
  const partial = items.find((it) => {
    const n = normalizeMilkName(it?.name);
    return n.length > 2 && (n.includes(name) || name.includes(n));
  });
  if (partial?.id) return partial.id;

  // 3. Known milk, station stock not yet configured for it.
  const alias = Object.keys(MILK_ID_BY_NAME).find(
    (k) => name === k || name.includes(k)
  );
  return alias ? MILK_ID_BY_NAME[alias] : null;
};

/**
 * Everything one completed order consumes.
 *
 * `milk: null` means deplete no milk at all -- distinct from depleting
 * zero litres of full cream, which is what the old code did.
 */
export const planDepletion = (order, milkStockItems = []) => {
  const size = resolveSize(order);
  const milkId = resolveMilkId(order, milkStockItems);
  return {
    size,
    milk: milkId ? { id: milkId, litres: MILK_PER_SIZE[size] } : null,
    beans: { id: 'coffee_house', kilos: BEANS_PER_SIZE[size] },
    cup: { id: CUP_ID_PER_SIZE[size], count: 1 },
  };
};
