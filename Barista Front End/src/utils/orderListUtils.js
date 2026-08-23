// Keeping one order to one card.
//
// Completing an order prepends it to the completed list. Two separate
// code paths in useOrders do that -- the normal one and the local
// fallback used when the API call does not come back cleanly -- and
// neither checked whether the order was already there. When both ran for
// the same order, the barista got two identical cards.
//
// It showed up at CTN26 as duplicated cards in the completed column, and
// it is worse than cosmetic: with two cards for one coffee, marking one
// picked up leaves the other sitting there, which is the "collected not
// working on some" the baristas reported.
//
// Keyed on order NUMBER first. That is the identity the customer, the
// label and the SMS all use, and it survives the difference between a
// locally-built order object and the same order coming back from the
// server, where the internal `id` may not match.

/** The stable identity of an order, or '' if it has none. */
export const orderKey = (order) => {
  if (!order || typeof order !== 'object') return '';
  const n = order.orderNumber ?? order.order_number;
  if (n !== undefined && n !== null && String(n).trim() !== '') {
    return `n:${String(n).trim()}`;
  }
  const id = order.id;
  if (id !== undefined && id !== null && String(id).trim() !== '') {
    return `i:${String(id).trim()}`;
  }
  return '';
};

/**
 * Put `order` at the front of `list`, replacing any existing entry for
 * the same order.
 *
 * Replacing rather than skipping matters: the second write is usually
 * the better-informed one (it has the real completion time and the
 * server's fields), so the newer object should win.
 *
 * An order with no usable key is prepended without deduping -- dropping
 * it would lose a real coffee, and that is the worse failure.
 */
export const upsertOrder = (list, order) => {
  const existing = Array.isArray(list) ? list : [];
  const key = orderKey(order);
  if (!key) return [order, ...existing];
  return [order, ...existing.filter((o) => orderKey(o) !== key)];
};

/**
 * Remove duplicates from a list, keeping the first occurrence.
 *
 * Applied to lists that arrive wholesale from the API or the cache: a
 * payload that already contains the same order twice would otherwise
 * render two cards no matter how careful the local paths are.
 */
export const dedupeOrders = (list) => {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  return list.filter((o) => {
    const key = orderKey(o);
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};
