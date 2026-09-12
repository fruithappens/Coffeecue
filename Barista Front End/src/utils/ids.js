// Ids compare as strings. Always.
//
// /api/orders hands back ids as strings ('435'); a station picker, a URL, a
// WebSocket event or a select box hands back a number or a string depending on
// the day it was written. `42 === '42'` is false, and in this app a false
// comparison is not an error -- it is a button that silently does nothing:
// the card that "could not select collected despite picked up" at Treenet
// (#606) was exactly this. FINDINGS_ROADMAP finding 2.
//
// Null and undefined never equal anything, including each other: a missing
// id must not match another missing id and quietly pair two unrelated things.
export const sameId = (a, b) => (
  a != null && b != null && String(a) === String(b)
);

/** Predicate for find/some/filter: `list.find(byId(orderId))`. */
export const byId = (id) => (o) => !!o && sameId(o.id, id);

/** Predicate for filter: everything BUT this id. */
export const notId = (id) => (o) => !o || !sameId(o.id, id);

/** The station of an order or station object, whichever spelling it carries. */
export const stationIdOf = (o) => (o ? (o.stationId ?? o.station_id ?? o.assignedStation ?? null) : null);
