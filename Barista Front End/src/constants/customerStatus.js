// The words a CUSTOMER sees for an order's state -- on the phone beacon, the
// "my coffee" page and anywhere else a status is shown to the person who
// ordered. One place, on purpose: two copies drifted ("READY — come and get
// it" on one page, "READY - come and get it" on the other) and every new
// surface risked a third. Keys are the server's status values, with the
// underscore/hyphen spelling both accepted via customerStatus().
export const CUSTOMER_STATUS = Object.freeze({
  pending:       { title: 'In the queue',            tone: 'bg-blue-600' },
  'in-progress': { title: 'Being made now',          tone: 'bg-amber-500' },
  completed:     { title: 'READY — come and get it', tone: 'bg-green-600' },
  picked_up:     { title: 'Collected — enjoy!',      tone: 'bg-gray-500' },
  cancelled:     { title: 'Cancelled',               tone: 'bg-red-600' },
});

// Look up by any spelling the API might send ('in_progress', 'in-progress',
// 'picked-up' ...). Unknown -> null so callers can fall back sensibly.
export function customerStatus(status) {
  const s = String(status || '').toLowerCase().trim().replace(/_/g, '-');
  if (s === 'picked-up') return CUSTOMER_STATUS.picked_up;
  return CUSTOMER_STATUS[s] || null;
}
