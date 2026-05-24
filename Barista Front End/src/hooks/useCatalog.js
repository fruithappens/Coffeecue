// hooks/useCatalog.js
//
// Read canonical option lists from the backend's /api/catalog endpoint.
// This is the source of truth for milk / drink / size / sweetener
// option lists — see services/migrations.py _m009_catalog_items for
// the architecture.
//
// Usage:
//   const { items, loading, error, refresh } = useCatalog('milk');
//   // items is an array of {id, name, short_name, subcategory,
//   //                       properties, sort_order, is_active, is_custom}
//
// Any component that used to read DEFAULT_MILK_TYPES or hardcoded
// drink lists should use this hook instead. That way changes to
// the canonical list (via Inventory editor or POST /api/catalog)
// flow through every UI without redeploys.
import { useState, useEffect, useCallback, useRef } from 'react';
import ApiService from '../services/ApiService';

// Module-level cache so multiple components calling useCatalog('milk')
// share one network round-trip. Keyed by category + include_inactive
// + include_custom so different views don't collide.
const _cache = new Map();
const _inflight = new Map();

const _cacheKey = (category, opts) =>
  `${category}|${opts.includeInactive ? 1 : 0}|${opts.includeCustom !== false ? 1 : 0}`;

/**
 * @param {('milk'|'drink'|'size'|'sweetener')} category
 * @param {object} options
 * @param {boolean} [options.includeInactive=false]
 * @param {boolean} [options.includeCustom=true]
 * @returns {{items:Array, loading:boolean, error:string|null,
 *           refresh:()=>void, addCustom:(payload)=>Promise}}
 */
export default function useCatalog(category, options = {}) {
  const opts = {
    includeInactive: !!options.includeInactive,
    includeCustom: options.includeCustom !== false,
  };
  const key = _cacheKey(category, opts);

  const [items, setItems] = useState(() => _cache.get(key) || []);
  const [loading, setLoading] = useState(() => !_cache.has(key));
  const [error, setError] = useState(null);

  // Stable api instance for the lifetime of this hook.
  const apiRef = useRef(null);
  if (!apiRef.current) apiRef.current = new ApiService();

  const fetchCatalog = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (opts.includeInactive) params.set('include_inactive', '1');
      if (!opts.includeCustom) params.set('include_custom', '0');
      const qs = params.toString();
      const path = `/catalog/${category}${qs ? '?' + qs : ''}`;

      // Deduplicate in-flight requests for the same key
      let req = _inflight.get(key);
      if (!req) {
        req = apiRef.current.get(path);
        _inflight.set(key, req);
      }
      const resp = await req;
      _inflight.delete(key);

      const list = (resp && resp.items) || [];
      _cache.set(key, list);
      setItems(list);
    } catch (err) {
      _inflight.delete(key);
      console.warn(`useCatalog(${category}) failed:`, err?.message);
      setError(err?.message || 'Catalog fetch failed');
      // Don't clobber whatever we had cached on failure — better to
      // show stale-but-real than empty.
    } finally {
      setLoading(false);
    }
  }, [category, key, opts.includeInactive, opts.includeCustom]);

  // Initial load. If a cache entry exists, we already populated items
  // synchronously above and don't refetch — caller can call refresh()
  // if they want fresh data.
  useEffect(() => {
    if (!_cache.has(key)) {
      fetchCatalog();
    }
  }, [key, fetchCatalog]);

  const refresh = useCallback(() => {
    _cache.delete(key);
    return fetchCatalog();
  }, [key, fetchCatalog]);

  const addCustom = useCallback(async (payload) => {
    // payload: {name, short_name?, subcategory?, properties?}
    const resp = await apiRef.current.post(`/catalog/${category}`, payload);
    if (resp && resp.success && resp.item) {
      _cache.delete(key);
      await fetchCatalog();
      return { success: true, item: resp.item };
    }
    return { success: false, message: (resp && resp.error) || 'Add failed' };
  }, [category, key, fetchCatalog]);

  return { items, loading, error, refresh, addCustom };
}

/**
 * Drop the in-memory cache. Useful after an admin-side edit that
 * affects everyone (e.g. operator hides a milk in the Inventory
 * editor — every open dialog should refetch).
 */
export function invalidateCatalog(category) {
  if (category) {
    for (const k of [..._cache.keys()]) {
      if (k.startsWith(category + '|')) _cache.delete(k);
    }
  } else {
    _cache.clear();
  }
}
