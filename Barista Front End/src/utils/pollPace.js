// pollPace.js — how often a customer's phone checks its order.
//
// The 1,000-phone load test (13 Oct 2026) showed one server comfortably
// takes about 100 checks a second, and 1,000 phones at a flat 8 s is 125.
// Most of those phones are far back in the queue, where nothing they can
// see will change for minutes. So: quick when it matters (being made,
// ready, near the front), relaxed when it doesn't. Every page also
// refreshes the moment it becomes visible, so a slower background pace
// never shows a stale card to someone who is looking.
//
// The stale warning on both pages appears after 30 s without an answer,
// so every visible pace must stay well under that.

export const FAST_MS = 8000;
export const QUEUED_MS = 15000;
export const FAR_BACK_MS = 20000;
export const HIDDEN_MS = 30000;

const DONE = new Set(['picked_up', 'picked-up', 'collected', 'cancelled', 'canceled']);

/**
 * @returns {number|null} ms until the next check, or null to stop.
 *   status   the order's status ('pending', 'in-progress', 'completed', ...)
 *   position place in line when pending (1 = next), if the page knows it
 *   hidden   document.visibilityState === 'hidden'
 */
export function pollDelayMs({ status, position, hidden } = {}) {
  const s = String(status || '').toLowerCase();
  if (DONE.has(s)) return null;
  if (hidden) return HIDDEN_MS;
  if (s === 'pending') {
    if (typeof position === 'number' && position > 0) {
      return position > 5 ? FAR_BACK_MS : FAST_MS;
    }
    return QUEUED_MS;
  }
  return FAST_MS;
}
