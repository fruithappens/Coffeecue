// barUnits.js — the touch bar's own arrangement of the Waiting lane.
//
// A "unit" is a list of order ids made together: one id is a single cup,
// two or more is a batch the barista built by holding and dropping one
// card on another. The arrangement lives on the bar's device; the live
// queue comes from the server. These keep the two in step.

const idOf = (o) => String(o.id);
const isPriority = (o) => !!(o.vip || o.priority);

// Keep the saved arrangement in step with the live queue: drop orders that
// have left Waiting, append new ones (VIP to the front, as the server
// would), never lose an order because the saved layout did not know it.
export function reconcileUnits(saved, liveOrders) {
  const live = new Map(liveOrders.map(o => [idOf(o), o]));
  const seen = new Set();
  const units = [];
  for (const u of Array.isArray(saved) ? saved : []) {
    const ids = (Array.isArray(u) ? u : []).map(String).filter(id => live.has(id) && !seen.has(id));
    ids.forEach(id => seen.add(id));
    if (ids.length) units.push(ids);
  }
  for (const o of liveOrders) {
    const id = idOf(o);
    if (seen.has(id)) continue;
    seen.add(id);
    if (isPriority(o)) units.unshift([id]); else units.push([id]);
  }
  return units;
}


// Orders that would wait LONGER after a move: more cups are now ahead of
// them than before. A batch counts as one slot made together, so joining
// two cards that are already side by side delays nobody. Used to ask the
// barista before a drag quietly breaks the time a customer was given.
export function delayedBy(before, after) {
  const ahead = (units) => {
    const m = new Map();
    let n = 0;
    for (const u of units) {
      for (const id of u) m.set(String(id), n);
      n += u.length;
    }
    return m;
  };
  const a = ahead(before), b = ahead(after);
  const out = [];
  for (const [id, was] of a) {
    if (b.has(id) && b.get(id) > was) out.push(id);
  }
  return out;
}
