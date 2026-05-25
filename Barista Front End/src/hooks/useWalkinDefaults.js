// hooks/useWalkinDefaults.js
//
// Load + cache the per-event walk-in dialog defaults from
// /api/walkin-defaults. Returns the same shape the backend stores:
//
//   {
//     default_coffee_type: 'Flat White',
//     default_size:        'Small (8oz)',
//     default_shots:       '1',
//     default_milk_preference_order: ['whole milk', 'full cream', ...],
//     default_sweetener_qty: 0,
//   }
//
// Falls back to a sensible Aussie default set if the endpoint is
// unreachable (offline mode), so the dialog can always render.
//
// Module-level cache + in-flight dedup so multiple dialog opens
// share one round-trip.
import { useState, useEffect } from 'react';
import ApiService from '../services/ApiService';

const FALLBACK_DEFAULTS = Object.freeze({
  default_coffee_type: 'Flat White',
  default_size:        'Small (8oz)',
  default_shots:       '1',
  default_milk_preference_order: [
    'whole milk', 'full cream', 'regular', 'standard',
    'dairy', 'milk', 'skim', 'low fat',
  ],
  default_sweetener_qty: 0,
});

let _cached = null;
let _inflight = null;

/**
 * @returns {{defaults: object, loaded: boolean}}
 *   - defaults: the configured walk-in defaults (or fallback while loading)
 *   - loaded:   true once an API response (or failure) has settled
 */
export default function useWalkinDefaults() {
  const [defaults, setDefaults] = useState(_cached || FALLBACK_DEFAULTS);
  const [loaded, setLoaded] = useState(_cached != null);

  useEffect(() => {
    if (_cached) return;
    if (!_inflight) {
      const api = new ApiService();
      _inflight = api.get('/walkin-defaults')
        .then(resp => {
          if (resp && typeof resp === 'object') {
            _cached = { ...FALLBACK_DEFAULTS, ...resp };
            return _cached;
          }
          _cached = FALLBACK_DEFAULTS;
          return _cached;
        })
        .catch(err => {
          console.warn('walkin-defaults load failed, using built-in:', err?.message);
          _cached = FALLBACK_DEFAULTS;
          return _cached;
        })
        .finally(() => { _inflight = null; });
    }
    let cancelled = false;
    _inflight.then(d => {
      if (!cancelled) {
        setDefaults(d);
        setLoaded(true);
      }
    });
    return () => { cancelled = true; };
  }, []);

  return { defaults, loaded };
}

/**
 * Test helper — drop the module-level cache so a fresh fetch happens
 * on next hook mount. Useful after saving new defaults in QuickSetup.
 */
export function invalidateWalkinDefaults() {
  _cached = null;
}
