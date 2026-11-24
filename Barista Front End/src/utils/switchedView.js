// switchedView.js -- this tab got to a staff screen through "Switch view".
//
// The barista screen keeps the way to the Runner behind a PIN, because a cart
// tablet sits unattended. But whoever came from the Runner is already past
// that, and had to unlock just to go back. This remembers it for the tab
// only: a tablet opened straight onto the barista screen never gets it.
const KEY = 'cupq_switched_view';

export const markSwitchedView = () => {
  try { sessionStorage.setItem(KEY, '1'); } catch (e) { /* private mode: PIN as before */ }
};
export const clearSwitchedView = () => {
  try { sessionStorage.removeItem(KEY); } catch (e) { /* nothing kept */ }
};
export const hasSwitchedView = () => {
  try { return sessionStorage.getItem(KEY) === '1'; } catch (e) { return false; }
};
