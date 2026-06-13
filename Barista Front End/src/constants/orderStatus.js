// constants/orderStatus.js
//
// Single source of truth for order status strings on the frontend.
// Backend mirror lives in services/order_status.py — keep in sync.
//
// THE BUG WE'RE PREVENTING
// ------------------------
// Order status used to be a literal string scattered through 100+
// call sites. Some places spelled 'in-progress' (hyphen), some
// spelled 'in_progress' (underscore). Filters that compared with the
// wrong spelling silently dropped orders.
//
// USAGE
// -----
//   import { ORDER_STATUS, isInProgress } from './orderStatus';
//
//   if (order.status === ORDER_STATUS.PENDING) { ... }
//   if (isInProgress(order)) { ... }
//
//   // For new code, prefer the helpers over raw === comparisons.

/**
 * Canonical status strings. These are the values stored in the DB
 * `orders.status` column and sent over the wire by the backend.
 *
 * IMPORTANT:
 * - IN_PROGRESS uses a HYPHEN ('in-progress'). The underscore form
 *   ('in_progress') is wrong but appears in some legacy spots and
 *   must be tolerated when READING (use `isInProgress` not `===`).
 * - PICKED_UP uses an UNDERSCORE. Yes, that's inconsistent. Don't
 *   "fix" it without a migration — DB rows have this value.
 */
export const ORDER_STATUS = Object.freeze({
  PENDING:     'pending',
  IN_PROGRESS: 'in-progress',
  COMPLETED:   'completed',
  PICKED_UP:   'picked_up',
  CANCELLED:   'cancelled',
});

// Set form for quick `in` checks. Object.values() works too but a Set
// is constant-time and more readable as `KNOWN_STATUSES.has(...)`.
export const KNOWN_STATUSES = new Set(Object.values(ORDER_STATUS));

/**
 * Tolerant matchers — accept the canonical form AND the known legacy
 * spellings. Use these for ANY filter/branch that reads order.status
 * coming from older clients, mock data, or test fixtures.
 *
 * If you're writing a NEW status, write the canonical form
 * (ORDER_STATUS.*) — these helpers exist for reads, not writes.
 */
const _norm = (s) => (s || '').toString().toLowerCase().trim();

export const isPending = (orderOrStatus) => {
  const s = _norm(typeof orderOrStatus === 'string' ? orderOrStatus : orderOrStatus?.status);
  return s === 'pending';
};

export const isInProgress = (orderOrStatus) => {
  const s = _norm(typeof orderOrStatus === 'string' ? orderOrStatus : orderOrStatus?.status);
  // Tolerate the underscore drift.
  return s === 'in-progress' || s === 'in_progress' || s === 'inprogress';
};

export const isCompleted = (orderOrStatus) => {
  const s = _norm(typeof orderOrStatus === 'string' ? orderOrStatus : orderOrStatus?.status);
  return s === 'completed' || s === 'complete' || s === 'done';
};

export const isPickedUp = (orderOrStatus) => {
  const s = _norm(typeof orderOrStatus === 'string' ? orderOrStatus : orderOrStatus?.status);
  return s === 'picked_up' || s === 'picked-up' || s === 'pickedup' || s === 'collected';
};

export const isCancelled = (orderOrStatus) => {
  const s = _norm(typeof orderOrStatus === 'string' ? orderOrStatus : orderOrStatus?.status);
  return s === 'cancelled' || s === 'canceled' || s === 'cancel';
};

/**
 * 'Active' = not yet collected/cancelled. Useful for queue counts.
 */
export const isActive = (orderOrStatus) =>
  isPending(orderOrStatus) || isInProgress(orderOrStatus);

/**
 * Map an order to its canonical status string, normalising legacy
 * spellings to the ORDER_STATUS values. Returns undefined if the
 * status doesn't match any known form.
 */
export const canonicalStatus = (orderOrStatus) => {
  if (isPending(orderOrStatus))     return ORDER_STATUS.PENDING;
  if (isInProgress(orderOrStatus))  return ORDER_STATUS.IN_PROGRESS;
  if (isCompleted(orderOrStatus))   return ORDER_STATUS.COMPLETED;
  if (isPickedUp(orderOrStatus))    return ORDER_STATUS.PICKED_UP;
  if (isCancelled(orderOrStatus))   return ORDER_STATUS.CANCELLED;
  return undefined;
};

/**
 * Human-friendly label for the status. Use in UI text.
 */
export const STATUS_LABELS = Object.freeze({
  [ORDER_STATUS.PENDING]:     'Pending',
  [ORDER_STATUS.IN_PROGRESS]: 'In progress',
  [ORDER_STATUS.COMPLETED]:   'Ready',
  [ORDER_STATUS.PICKED_UP]:   'Collected',
  [ORDER_STATUS.CANCELLED]:   'Cancelled',
});

export const labelFor = (orderOrStatus) => {
  const c = canonicalStatus(orderOrStatus);
  return c ? STATUS_LABELS[c] : 'Unknown';
};

export default ORDER_STATUS;
