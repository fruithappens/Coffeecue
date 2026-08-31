// Event-code gate (Steve): stop a random visitor who typed cupq.app cold
// from ordering, while anyone who SCANNED a QR (so is physically at the
// event) orders with no friction. The QR/link carries ?e=<code>; a direct
// visitor is asked for the code once.
//
// This is deliberately soft security, not a secret: the code is printed on
// posters and returned by /api/event-access/public, and the backend gate in
// utils/event_access.py is the real enforcement (an order without a matching
// code is refused). This module is the friendly front — it decides whether to
// prompt, validates what's typed, and stamps the code onto order links so a
// scan just works.

// Mirror of utils/event_access.normalize_code so the client and server agree:
// lower-case, keep a-z/0-9/hyphen, collapse the rest to single hyphens, trim.
// Case-insensitive by construction ("TREENET26" === "treenet26").
export function normalizeCode(value) {
  let v = String(value == null ? '' : value).trim().toLowerCase();
  v = v.replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return v.slice(0, 32);
}

// The event's public access state. Never returns the password itself.
// Fails OPEN (no gate) on any error — a page that stops taking orders
// because a fetch hiccuped is worse than the stray order it guarded against.
export async function fetchEventAccess() {
  try {
    const r = await fetch('/api/event-access/public', { cache: 'no-store' });
    const b = r.ok ? await r.json() : null;
    if (!b || !b.success) return { require: false, code: '', passwordRequired: false };
    return {
      require: !!b.require,
      code: normalizeCode(b.code),
      passwordRequired: !!b.password_required,
    };
  } catch (e) {
    return { require: false, code: '', passwordRequired: false };
  }
}

// Does the current URL already carry a code that matches this event?
// (A scanned QR / cupq.app/<code> link does; a cold visit doesn't.)
export function urlCodeMatches(code) {
  try {
    const e = new URLSearchParams(window.location.search).get('e');
    return !!code && normalizeCode(e) === normalizeCode(code);
  } catch (e) {
    return false;
  }
}

// Put ?e=<code> into the current URL without a reload, so the order that
// follows carries it (KioskOrder reads e from window.location.search).
export function stampUrlWithCode(code) {
  const c = normalizeCode(code);
  if (!c) return;
  try {
    const u = new URL(window.location.href);
    u.searchParams.set('e', c);
    window.history.replaceState({}, '', u);
  } catch (e) { /* older browser — the typed code still reaches the order */ }
}

// Append ?e=<code> to an ordering URL (for QR codes / share links), keeping
// any existing query string. Empty code or url → returned unchanged.
export function stampLink(url, code) {
  const c = normalizeCode(code);
  if (!c || !url) return url;
  const sep = String(url).indexOf('?') >= 0 ? '&' : '?';
  return `${url}${sep}e=${c}`;
}

// Session flag so a visitor who typed the code once isn't asked again on
// this device for this browser session.
const OK_KEY = 'cupq_event_code_ok';
export function rememberCodeOk() {
  try { sessionStorage.setItem(OK_KEY, '1'); } catch (e) { /* private mode */ }
}
export function codeAlreadyOk() {
  try { return sessionStorage.getItem(OK_KEY) === '1'; } catch (e) { return false; }
}
