// How old is this order? The screen counts; the server only says when.
//
// /api/orders used to send waitTime (minutes since created) for every order
// on every poll. It ticked, so the 200 KB payload was never byte-identical
// twice, so the ETag that should have turned an unchanged poll into a 304
// never matched (FINDINGS_ROADMAP finding 1 -- the load behind the 8 Sep
// outage). The list now carries createdAt only, and every order gets its
// waitTime stamped HERE as it arrives, then re-stamped once a minute by
// useOrders. Nothing downstream had to change its reading of order.waitTime.
//
// The one thing the server's number had going for it was the server's clock.
// A tablet whose clock is five minutes fast would age every order by five
// minutes. So ApiService feeds every response's Date header in here, and the
// age is measured on the server's clock, not the tablet's. One second of
// resolution plus the network trip -- fine for a number shown in minutes.
import { parseServerDate } from './orderUtils';

let skewMs = 0; // tablet clock minus server clock

/** Feed the `Date` header of any server response. Unparsable -> ignored. */
export const noteServerDate = (dateHeader) => {
  const t = Date.parse(dateHeader || '');
  if (!Number.isNaN(t)) skewMs = Date.now() - t;
};

/** Now, on the server's clock (ms). */
export const serverNow = () => Date.now() - skewMs;

/** For tests and diagnostics. */
export const clockSkewMs = () => skewMs;

/** Whole minutes since a server timestamp, never negative; null if unreadable. */
export const minutesSince = (ts, now = serverNow()) => {
  if (ts == null || ts === '') return null;
  const t = parseServerDate(ts).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now - t) / 60000));
};

/** The same order with waitTime / wait_time set from its createdAt. */
export const withWaitTime = (order, now = serverNow()) => {
  if (!order || typeof order !== 'object') return order;
  const m = minutesSince(order.createdAt || order.created_at, now);
  if (m == null) return order;
  if (order.waitTime === m && order.wait_time === m) return order;
  return { ...order, waitTime: m, wait_time: m };
};

/** Stamp a whole list at one instant, so a sort by age is consistent. */
export const stampWaitTimes = (orders) => {
  if (!Array.isArray(orders)) return orders;
  const now = serverNow();
  return orders.map((o) => withWaitTime(o, now));
};
