// Saved group rounds, remembered on the device.
//
// Steve: a named group ("Wallfly") a team can re-order in one tap, and
// "the order that is remembered isnt just a single coffee but... the
// group." A round is the list of built cups (drink objects + names) as
// KioskOrder holds them, so re-ordering just drops them back into the
// cart -- no reconstruction. Device-local (like the SMS pref + cid
// memory): safe, no server storage, and it IS the "your usual" for a
// group. A shared server-side named round is a later, bigger thing.
const KEY = 'cupq_saved_rounds';
const MAX = 12;

export function getSavedRounds() {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}

export function saveRound(name, items) {
  const clean = String(name || '').trim().slice(0, 40);
  if (!clean || !Array.isArray(items) || items.length === 0) return getSavedRounds();
  try {
    const rounds = getSavedRounds().filter(
      (r) => (r.name || '').toLowerCase() !== clean.toLowerCase());
    rounds.unshift({ name: clean, items, savedAt: Date.now() });
    const trimmed = rounds.slice(0, MAX);
    localStorage.setItem(KEY, JSON.stringify(trimmed));
    return trimmed;
  } catch (e) { return getSavedRounds(); }
}

export function deleteRound(name) {
  try {
    const rounds = getSavedRounds().filter(
      (r) => (r.name || '').toLowerCase() !== String(name || '').toLowerCase());
    localStorage.setItem(KEY, JSON.stringify(rounds));
    return rounds;
  } catch (e) { return getSavedRounds(); }
}
