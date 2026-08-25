// EventInventoryService.js
//
// Source-of-truth wrapper around the event_inventory data (the master
// menu list — milks, coffees, cups, syrups, sweeteners, drinks, extras).
//
// Before this service:
//   - InventoryManagement.js wrote directly to localStorage.event_inventory
//   - Quick Setup wrote directly to localStorage.event_inventory
//   - Walk-in dialog read from localStorage.event_inventory
//   - SMS bot read from the parallel inventory_items table
//   → three places to "fix" when one drifted from the others.
//
// With this service:
//   - All writes go through save() which POSTs to /api/event-inventory
//     AND mirrors to localStorage (cache + offline fallback).
//   - All reads go through load() which prefers the backend on first
//     call, then serves from the local cache for snappy subsequent
//     reads. WS event 'event_inventory_updated' invalidates the cache.
//   - Existing components that read localStorage.event_inventory keep
//     working — the mirror keeps that key in sync.
//
// Keep this thin. The whole point is that the BACKEND is the source
// of truth; this is just a frontend convenience.

import ApiServiceClass from './ApiService';

const LS_KEY = 'event_inventory';
const api = new ApiServiceClass();

let memoryCache = null;
let inFlight = null;

// A category map is {category: [items]}. Anything else that reaches us
// gets straightened out here rather than at each of the six call sites.
export const normaliseInventory = (raw) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  // Unwrap the API envelope. Only when `inventory` is the ONLY key --
  // a real category map could legitimately contain a category called
  // "inventory" alongside others, and that must not be unwrapped.
  let blob = raw;
  const keys = Object.keys(raw);
  if (keys.length === 1 && ['inventory', 'data'].includes(keys[0])
      && raw[keys[0]] && typeof raw[keys[0]] === 'object'
      && !Array.isArray(raw[keys[0]])) {
    blob = raw[keys[0]];
  }
  const out = {};
  for (const [category, items] of Object.entries(blob)) {
    if (Array.isArray(items)) out[category] = items;
    // A dict keyed by id is the other shape that has turned up; its
    // values are the items, so take those rather than dropping the lot.
    else if (items && typeof items === 'object') out[category] = Object.values(items);
    else out[category] = [];
  }
  return out;
};

const readLocal = () => {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    // Heal a copy written by the pre-fix code, which stored the envelope.
    return normaliseInventory(JSON.parse(raw));
  } catch (e) {
    console.warn('[EventInventoryService] localStorage parse failed:', e);
    return null;
  }
};

const writeLocal = (payload) => {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(payload));
    window.dispatchEvent(new CustomEvent('inventory:updated', { detail: payload }));
  } catch (e) {
    console.warn('[EventInventoryService] localStorage write failed:', e);
  }
};

const EventInventoryService = {
  /**
   * Get the master inventory list. Reads the backend on first call;
   * subsequent calls hit the in-memory cache until invalidate() is
   * called or a 'inventory:updated' event fires.
   *
   * @param {object} opts
   * @param {boolean} opts.forceReload  bypass cache, always hit backend
   * @returns {Promise<object>}
   */
  async load(opts = {}) {
    if (!opts.forceReload && memoryCache) return memoryCache;
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        const resp = await api.request('/event-inventory', { method: 'GET' });
        // normaliseInventory unwraps the {"inventory": {...}} envelope the
        // endpoint actually returns. Storing it un-unwrapped is what broke
        // Event Stock.
        const blob = (resp && typeof resp === 'object' && !('error' in resp))
          ? normaliseInventory(resp) : {};
        if (Object.keys(blob).length > 0) {
          memoryCache = blob;
          writeLocal(blob);  // keep localStorage in sync
          return blob;
        }
        // Backend has nothing yet — first run. Bootstrap from the local
        // copy if it exists, then write it back to the backend so future
        // loads work. If no local copy either, callers fall through to
        // InventoryManagement's hardcoded defaults.
        const local = readLocal();
        if (local && Object.keys(local).length > 0) {
          memoryCache = local;
          try {
            await api.request('/event-inventory', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(local),
            });
            console.log('[EventInventoryService] migrated local → backend');
          } catch (migrateErr) {
            console.warn('[EventInventoryService] migration write failed:', migrateErr);
          }
          return local;
        }
        memoryCache = {};
        return {};
      } catch (e) {
        // Backend offline — fall back to local cache so the UI still works.
        console.warn('[EventInventoryService] backend load failed, using local cache:', e?.message || e);
        const local = readLocal();
        memoryCache = local || {};
        return memoryCache;
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  },

  /**
   * Persist the master inventory list. Writes the backend and mirrors
   * to localStorage. Optimistic UI — local cache updates immediately,
   * backend failure surfaces via the rejected promise.
   *
   * @param {object} payload  full inventory blob
   * @returns {Promise<object>}
   */
  async save(payload) {
    if (!payload || typeof payload !== 'object') {
      throw new Error('save() requires an object');
    }
    memoryCache = payload;
    writeLocal(payload);  // optimistic local update
    try {
      const resp = await api.request('/event-inventory', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      return resp && resp.event_inventory ? resp.event_inventory : payload;
    } catch (e) {
      console.error('[EventInventoryService] backend save failed:', e);
      throw e;
    }
  },

  /**
   * Force the next load() to refetch from the backend. Call this after
   * a sibling component or another tab has changed the inventory.
   */
  invalidate() {
    memoryCache = null;
  },

  /**
   * Synchronous read of the in-memory cache. Returns null if load()
   * hasn't been called yet. Use load() in async paths.
   */
  peek() {
    return memoryCache;
  },
};

// Wire cache invalidation to the existing inventory:updated event so
// any component that pushes a fresh blob to localStorage (e.g. Quick
// Setup's rebuildLocalInventory) keeps the in-memory cache fresh.
if (typeof window !== 'undefined') {
  window.addEventListener('inventory:updated', (e) => {
    if (e && e.detail && typeof e.detail === 'object') {
      memoryCache = e.detail;
    } else {
      memoryCache = null;
    }
  });
  // Cross-tab sync: when another tab writes the localStorage key,
  // invalidate the in-memory cache so the next read picks it up.
  window.addEventListener('storage', (e) => {
    if (e.key === LS_KEY) memoryCache = null;
  });
  // WebSocket forwards a 'event_inventory_updated' window event when
  // the backend emits one (e.g. another barista saved). Invalidate
  // the cache; the next load() will refetch.
  window.addEventListener('event_inventory_updated', () => {
    memoryCache = null;
  });
}

export default EventInventoryService;
