// useLiveStock — the barista Stock tab, reading the REAL inventory.
//
// Steve found the bug: the Stock tab showed 5 L skim while the low-stock
// warning (and the depletion engine) said 0.19 L. They were two different
// stores -- the tab mirrored a per-station BLOB in localStorage
// (/api/stations/N/stock via StockService), while depletion and the
// warnings use the inventory_items TABLE. This hook reads that table, so
// what a barista sees is exactly what the warnings and the recipes act on.
//
// Same endpoints the Organiser Event Stock screen already uses, so there
// is one source of truth across both surfaces.
import { useState, useEffect, useCallback, useRef } from 'react';
import ApiService from '../services/ApiService';

const api = new ApiService();

export default function useLiveStock(stationId) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    if (!stationId) return;
    try {
      // station-view semantics: this station's own rows PLUS the shared
      // event-pool rows it can draw on (station_id filter = OR IS NULL).
      const r = await api.get(`/inventory?station_id=${stationId}`);
      const list = (r && (r.items || r.data)) || [];
      if (mounted.current) { setItems(Array.isArray(list) ? list : []); setError(null); }
    } catch (e) {
      if (mounted.current) setError('Could not load live stock');
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [stationId]);

  useEffect(() => {
    mounted.current = true;
    load();
    // Re-read on a slow loop so depletion from live orders shows up here
    // without a manual refresh.
    const t = setInterval(load, 10000);
    return () => { mounted.current = false; clearInterval(t); };
  }, [load]);

  // Set an item's amount to an absolute value (the /adjust endpoint takes
  // new_amount, not a delta) and re-read so the row reflects the truth.
  const setAmount = useCallback(async (id, newAmount) => {
    const amt = Math.max(0, parseFloat(newAmount) || 0);
    try {
      await api.post(`/inventory/${id}/adjust`, {
        new_amount: amt, change_reason: 'barista_manual',
      });
    } finally {
      await load();
    }
  }, [load]);

  // Group by category for the tab's category selector.
  const byCategory = {};
  for (const it of items) {
    const c = String(it.category || 'other').toLowerCase();
    (byCategory[c] = byCategory[c] || []).push(it);
  }
  const categories = Object.keys(byCategory).sort();

  // low = at/under the minimum; critical = at/under half of it.
  const level = (it) => {
    const amt = parseFloat(it.amount) || 0;
    const min = parseFloat(it.minimum_threshold) || 0;
    if (min <= 0) return 'ok';
    if (amt <= min * 0.5) return 'critical';
    if (amt <= min) return 'low';
    return 'ok';
  };
  const lowCount = items.filter((i) => level(i) === 'low').length;
  const criticalCount = items.filter((i) => level(i) === 'critical').length;

  return { items, byCategory, categories, loading, error,
           reload: load, setAmount, level, lowCount, criticalCount };
}
