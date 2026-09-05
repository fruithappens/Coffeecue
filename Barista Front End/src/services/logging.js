// services/logging.js
//
// Structured frontend event logger. Sibling of the ErrorBoundary's
// /api/client-errors POST — same idea, but for non-crash signals:
// feature usage, recoverable failures (auto-retried fetches that
// finally succeeded), slow renders, etc.
//
// Pattern:
//   import { event } from './logging';
//   event('WALKIN_PRESET_LOAD', { templateId: 42, ms: tookMs });
//
// Stable codes only — pick from KNOWN_CODES below or add a new one
// with a description. The backend sink stores codes verbatim, so
// renaming after the fact breaks any alert/dashboard that grouped on
// the old code.
//
// Delivery: sendBeacon() preferred (works during pagehide / unload),
// fetch() fallback. Either way fire-and-forget — failure to deliver
// an event must NEVER block or surface to the user.

import AuthService from './AuthService';

// Add new codes at the bottom, never rename. Description is for the
// next reader; the backend never reads this map.
export const KNOWN_CODES = {
  // Walk-in dialog
  WALKIN_QUICKPICK_USED:   'Operator picked a drink via the numeric quick-pick row.',
  WALKIN_SHORTCUT_USED:    'Operator picked a drink via a 1-9 keyboard shortcut.',
  WALKIN_SUBMIT:           'Walk-in order submitted (regardless of outcome).',
  // Quick Setup
  QUICK_SETUP_PREVIEW_OPEN: 'Operator opened the Quick Setup drift preview modal.',
  QUICK_SETUP_APPLIED:     'Quick Setup apply succeeded (frontend-observable).',
  QUICK_SETUP_PREVIEW_FAIL: 'Dry-run endpoint failed; operator fell back to confirm dialog.',
  // Customer surfaces (Treenet data-capture: what people wanted / chose)
  UNAVAILABLE_TAP:         'Customer tapped a crossed-out drink or milk on the ordering screen.',
  BEACON_SOUND:            'Customer toggled the ready-chime on the phone beacon.',
  API_OUTAGE:              'A screen lost the server and got it back: surface, started_at, seconds.',
  // Auth + offline
  AUTH_FALLBACK_ENABLED:   'User accepted the fallback-mode prompt.',
  API_OFFLINE_DETECTED:    'Network or API health check failed.',
};

const ENDPOINT = '/api/client-events';

// Truncate to keep payloads from filling a row to the moon. Backend
// caps server-side too — this is just to keep the network call small.
const trunc = (s, n = 500) => {
  if (s == null) return s;
  const str = String(s);
  return str.length > n ? str.slice(0, n) : str;
};

/**
 * Emit a structured frontend event.
 * @param {string} code  SCREAMING_SNAKE_CASE event code, ideally from KNOWN_CODES.
 * @param {object} [payload]  Free-form fields. Stored as JSONB on the server.
 */
export const event = (code, payload = {}) => {
  if (!code || typeof code !== 'string') return;
  try {
    const body = JSON.stringify({
      code,
      payload: payload && typeof payload === 'object' ? payload : { value: payload },
      url: trunc(window.location?.href || '', 500),
      user_id: trunc(AuthService.getCurrentUser?.()?.username || '', 100),
      user_agent: trunc(navigator.userAgent || '', 500),
    });
    // sendBeacon is the right tool — works during pagehide, ignored
    // on failure, no preflight. Falls back to fetch for browsers
    // that don't have it (mostly very old ones at this point).
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: 'application/json' });
      navigator.sendBeacon(ENDPOINT, blob);
      return;
    }
    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => { /* swallow — logging must never error */ });
  } catch (_) {
    // Logging must NEVER throw — silent failure is correct here.
  }
};

export default { event, KNOWN_CODES };
