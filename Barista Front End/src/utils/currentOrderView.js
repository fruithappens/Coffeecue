// Making the Current column usable when ten coffees are on the bench.
//
// With one or two in progress the column is just a list. With ten it is
// the busiest thing on the screen and the barista needs to ask it
// questions: which of these has been waiting longest, which are the oat
// ones, and -- the question that actually saves time at the machine --
// how much of each milk do I need to steam right now.
//
// That last one is why the jug summary exists. Steaming one 1.2L jug of
// full cream for four lattes is one trip to the machine; discovering
// order by order that you need more is four. The barista knows the jug
// sizes on their bench, so this reports LITRES and lets them pick.

import { MILK_PER_SIZE, normalizeMilkName, resolveSize } from './stockDepletion';

// Names that mean the drink takes no milk, so it contributes nothing to
// the jug. Kept in step with stockDepletion's own list.
const NO_MILK = ['no milk', 'none', 'no', 'black', 'without milk', ''];

/** The milk an order needs, normalised, or '' when it takes none. */
export const orderMilk = (order) => {
  const raw = normalizeMilkName(order?.milkType || order?.milk_type || '');
  return NO_MILK.includes(raw) ? '' : raw;
};

/** Milliseconds since the order was started, for sorting. */
const startedAt = (order) => {
  const ts = order?.startedAt || order?.started_at
          || order?.createdAt || order?.created_at;
  if (!ts) return 0;
  const t = new Date(ts).getTime();
  return Number.isNaN(t) ? 0 : t;
};

/**
 * Sort in-progress orders.
 *
 * 'oldest' is the default and the safe one: the coffee that has been on
 * the bench longest is the one about to go cold, and the customer who
 * has waited longest is the one about to ask. 'newest' is offered
 * because a barista who has just started one often wants it on top.
 *
 * Orders with no usable timestamp sort last rather than jumping to the
 * front, which is what a 0 would otherwise do under 'oldest'.
 */
export const sortCurrentOrders = (orders, direction = 'oldest') => {
  const list = Array.isArray(orders) ? [...orders] : [];
  return list.sort((a, b) => {
    const ta = startedAt(a);
    const tb = startedAt(b);
    if (!ta && !tb) return 0;
    if (!ta) return 1;
    if (!tb) return -1;
    return direction === 'newest' ? tb - ta : ta - tb;
  });
};

/**
 * Distinct milks present, for the filter chips. Most common first.
 *
 * `minCount` exists because a chip is only worth its width if filtering
 * to it tells you something you could not already see. With one almond
 * coffee on a bench of thirteen you can just look at it -- and offering
 * a chip for it wrapped the header onto a second row, making the Current
 * column's header visibly taller than the other two.
 */
export const milkOptions = (orders, minCount = 1) => {
  const counts = new Map();
  (Array.isArray(orders) ? orders : []).forEach((o) => {
    const m = orderMilk(o);
    if (m) counts.set(m, (counts.get(m) || 0) + 1);
  });
  return [...counts.entries()]
    .filter(([, count]) => count >= minCount)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([milk, count]) => ({ milk, count }));
};

/**
 * How much of each milk the orders on the bench need, in litres.
 *
 * Sizes come from the same table the stock depletion uses, so the jug
 * figure and the stock figure can never drift apart. Rounded to 2dp
 * because floating point turns 0.25 x 3 into 0.7500000000000001, and a
 * barista reading a jug does not need eleven decimal places.
 */
export const summariseMilk = (orders) => {
  const totals = new Map();
  (Array.isArray(orders) ? orders : []).forEach((o) => {
    const milk = orderMilk(o);
    if (!milk) return;
    const litres = MILK_PER_SIZE[resolveSize(o)] || MILK_PER_SIZE.medium;
    const prev = totals.get(milk) || { milk, count: 0, litres: 0 };
    totals.set(milk, {
      milk,
      count: prev.count + 1,
      litres: prev.litres + litres,
    });
  });
  return [...totals.values()]
    .map((t) => ({ ...t, litres: Math.round(t.litres * 100) / 100 }))
    .sort((a, b) => b.litres - a.litres || a.milk.localeCompare(b.milk));
};

/** Apply the milk filter. An empty filter means "everything". */
export const filterByMilk = (orders, milk) => {
  if (!milk) return Array.isArray(orders) ? orders : [];
  return (Array.isArray(orders) ? orders : []).filter((o) => orderMilk(o) === milk);
};
