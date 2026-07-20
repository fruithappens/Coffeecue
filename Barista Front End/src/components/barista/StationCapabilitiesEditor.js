// components/StationCapabilitiesEditor.js
//
// Per-station capabilities editor. The operator picks which milks /
// drinks / sizes each station can serve, plus a few boolean flags
// (alt_milk, high_volume, vip_service) and capacity.
//
// What it drives: `services/coffee_system.py::_assign_station` reads
// each station's capabilities JSONB blob to decide where to send an
// incoming SMS order. If Station 3 doesn't have "oat" in milk_types,
// oat-milk orders won't be routed there. Quick Setup writes the same
// capabilities to every station when "all stations same" is on; this
// editor lets the operator break out of that uniformity (e.g.
// "Station 3's milk frother is broken — disable everything except
// filter coffee, route the rest to Station 4 for the next hour").
//
// Data flow:
//   GET  /api/stations                              → list of stations
//   GET  /api/stations/<id>/capabilities            → current caps per station
//   GET  /api/event-inventory (via service)         → master list of milks/drinks/sizes to choose from
//   POST /api/stations/<id>/capabilities            → save changes
//
// All saves are merging on the backend (existing keys preserved
// unless we explicitly overwrite), so partial saves are safe.

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Save, RotateCcw, AlertCircle, Check } from 'lucide-react';
import ApiServiceClass from '../../services/ApiService';
import StationsService from '../../services/StationsService';
import EventInventoryService from '../../services/EventInventoryService';
import useCatalog from '../../hooks/useCatalog';

const api = new ApiServiceClass();

// Static fallbacks for when both event_inventory AND the catalog
// endpoint are unreachable (fresh install with no network, demo mode).
// Catalog is preferred — these are last-resort.
const STATIC_FALLBACK_MILKS = [
  'full cream', 'skim', 'oat', 'almond', 'soy',
  'lactose free', 'coconut', 'macadamia',
];
const STATIC_FALLBACK_DRINKS = [
  'espresso drinks', 'hot chocolate', 'chai latte', 'matcha latte',
  'hot tea', 'english breakfast tea', 'earl grey tea',
  'green tea', 'peppermint tea', 'chamomile tea',
];
const STATIC_FALLBACK_SIZES = ['small', 'medium', 'large'];

// Translate the inventory blob's category arrays into name lists
// that match the canonical strings the backend uses. Lowercased so
// the checkboxes line up with what _assign_station reads. Catalog
// is passed in to canonicalise names (so 'Whole Milk' in inventory
// becomes 'full cream' in the checkbox list, matching what the
// backend's capability check is comparing against).
const namesFromInventory = (inventory, catalog) => {
  // Build a name → canonical short_name map from catalog. Used to
  // collapse synonyms (Whole Milk → full cream, etc.).
  const lc = (s) => (s || '').toString().toLowerCase().trim();
  const synonymMap = {};
  for (const cat of (catalog.milks || [])) {
    const canon = cat.short_name || cat.id || cat.name;
    if (canon) {
      synonymMap[lc(cat.id)] = canon;
      synonymMap[lc(cat.short_name)] = canon;
      synonymMap[lc(cat.name)] = canon;
      synonymMap[lc(cat.name).replace(/\s+milk$/, '')] = canon;
      for (const syn of (cat.properties?.synonyms || [])) {
        synonymMap[lc(syn)] = canon;
      }
    }
  }
  const canonMilk = (raw) => {
    const t = lc(raw).replace(/\s+milk$/, '').trim();
    return synonymMap[t] || t;
  };

  // Catalog-driven defaults take precedence over the static fallback.
  const catalogMilkNames = (catalog.milks || []).map(m => m.short_name || m.id);
  const catalogDrinkNames = ['espresso drinks',
    ...(catalog.drinks || [])
      .filter(d => d.subcategory !== 'espresso')
      .map(d => d.short_name || d.id),
  ];
  const catalogSizeNames = (catalog.sizes || []).map(s => s.short_name || s.id);

  if (!inventory) {
    return {
      milks: catalogMilkNames.length ? catalogMilkNames : STATIC_FALLBACK_MILKS,
      drinks: catalogDrinkNames.length > 1 ? catalogDrinkNames : STATIC_FALLBACK_DRINKS,
      sizes: catalogSizeNames.length ? catalogSizeNames : STATIC_FALLBACK_SIZES,
    };
  }

  const enabled = (arr) => Array.isArray(arr) ? arr.filter(i => i && i.enabled !== false) : [];
  // Milks: canonicalised through catalog synonyms so 'Whole Milk'
  // and 'full cream' both end up as 'full cream' on the checkbox row.
  const milks = enabled(inventory.milk).map(m => canonMilk(m.name));
  // Drinks: include both non-coffee drinks and tea flavours. Espresso
  // drinks are implicit (no inventory row); we always offer the
  // "espresso drinks" toggle as one bundle since SMS-bot treats them
  // collectively (latte/cappuccino/flat white).
  const drinks = ['espresso drinks',
                  ...enabled(inventory.drinks).map(d => lc(d.name))];
  // Sizes: from the cups category, canonicalised (small/medium/large)
  const sizes = enabled(inventory.cups).map(c => {
    const n = lc(c.name);
    if (n.includes('small') || n.includes('8oz')) return 'small';
    if (n.includes('medium') || n.includes('12oz')) return 'medium';
    if (n.includes('large') || n.includes('16oz')) return 'large';
    return n;
  });
  // De-dupe (medium-12oz and Ceramic Mug both → "medium")
  return {
    milks: [...new Set(milks)],
    drinks: [...new Set(drinks)],
    sizes: [...new Set(sizes.length ? sizes : (catalogSizeNames.length ? catalogSizeNames : STATIC_FALLBACK_SIZES))],
  };
};

// ── Single-station card ──────────────────────────────────────────────
const StationCapabilityCard = ({ station, choices, onSaved }) => {
  const [caps, setCaps] = useState(null);     // current backend value
  const [dirty, setDirty] = useState(null);   // local edits (null = no edits)
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null); // 'saved' | 'error' | null

  const load = useCallback(async () => {
    try {
      const resp = await api.request(`/stations/${station.id}/capabilities`, { method: 'GET' });
      const c = (resp && resp.capabilities) || {};
      setCaps(c);
      setDirty(null);
    } catch (e) {
      console.warn(`Could not load caps for station ${station.id}:`, e);
      setCaps({});
    }
  }, [station.id]);

  useEffect(() => { load(); }, [load]);

  // The "current" view: edited values if dirty, otherwise backend caps.
  const current = dirty != null ? dirty : (caps || {});

  const setField = (key, value) => {
    const next = { ...current, [key]: value };
    setDirty(next);
    setStatus(null);
  };

  const toggleListItem = (key, item) => {
    const list = Array.isArray(current[key]) ? current[key] : [];
    const next = list.includes(item)
      ? list.filter(x => x !== item)
      : [...list, item];
    setField(key, next);
  };

  const save = async () => {
    if (dirty == null) return;
    setSaving(true);
    setStatus(null);
    try {
      const resp = await api.request(`/stations/${station.id}/capabilities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ capabilities: dirty }),
      });
      const merged = (resp && resp.capabilities) || dirty;
      setCaps(merged);
      setDirty(null);
      setStatus('saved');
      if (onSaved) onSaved(station.id, merged);
      // Clear the toast after a moment.
      setTimeout(() => setStatus(null), 2500);
    } catch (e) {
      console.error(`Save failed for station ${station.id}:`, e);
      setStatus('error');
    } finally {
      setSaving(false);
    }
  };

  const revert = () => {
    setDirty(null);
    setStatus(null);
  };

  if (caps == null) {
    return (
      <div className="border rounded-lg p-4 bg-gray-50">
        <h4 className="font-semibold mb-2">{station.name || `Station ${station.id}`}</h4>
        <p className="text-sm text-gray-500">Loading…</p>
      </div>
    );
  }

  // Selected sets for the checkboxes (case-insensitive).
  const selectedMilks  = new Set((current.milk_types  || []).map(s => s.toLowerCase()));
  const selectedDrinks = new Set((current.coffee_types || []).map(s => s.toLowerCase()));
  const selectedSizes  = new Set((current.sizes        || []).map(s => s.toLowerCase()));

  // Routing derives alt-milk truth from the ticked milk list — the alt_milk
  // flag is a label. Warn when the two disagree so the label can't mislead.
  const ALT_MILK_WORDS = ['oat', 'almond', 'soy', 'coconut', 'macadamia', 'lactose', 'rice'];
  const milksListedExplicitly = (current.milk_types || []).length > 0;
  const listHasAltMilk = [...selectedMilks].some(
    m => ALT_MILK_WORDS.some(alt => m.includes(alt))
  );
  const altMilkContradiction = milksListedExplicitly && (
    (!!current.alt_milk && !listHasAltMilk) ||   // flagged yes, list says no
    (!current.alt_milk && listHasAltMilk)         // flagged no, list says yes
  );

  const RowCheckboxes = ({ label, items, selected, fieldKey }) => (
    <div>
      <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{label}</div>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {items.map(item => (
          <label key={item} className="inline-flex items-center text-sm cursor-pointer select-none">
            <input
              type="checkbox"
              checked={selected.has(item)}
              onChange={() => toggleListItem(fieldKey, item)}
              className="mr-1.5 h-4 w-4 accent-amber-600"
            />
            <span className="capitalize">{item}</span>
          </label>
        ))}
      </div>
    </div>
  );

  return (
    <div className={`border rounded-lg p-4 ${dirty ? 'border-amber-400 bg-amber-50' : 'bg-white'}`}>
      <div className="flex justify-between items-start mb-3">
        <div>
          <h4 className="font-bold text-lg">{station.name || `Station ${station.id}`}</h4>
          {station.location && (
            <div className="text-xs text-gray-500">{station.location}</div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {status === 'saved' && (
            <span className="text-green-700 text-sm flex items-center">
              <Check size={14} className="mr-1" /> Saved
            </span>
          )}
          {status === 'error' && (
            <span className="text-red-700 text-sm flex items-center">
              <AlertCircle size={14} className="mr-1" /> Save failed
            </span>
          )}
          {dirty && (
            <button
              onClick={revert}
              className="text-xs px-2 py-1 bg-gray-200 hover:bg-gray-300 rounded inline-flex items-center"
              title="Revert unsaved changes"
            >
              <RotateCcw size={12} className="mr-1" /> Revert
            </button>
          )}
          <button
            onClick={save}
            disabled={!dirty || saving}
            className="text-xs px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded disabled:opacity-40 inline-flex items-center"
          >
            <Save size={12} className="mr-1" /> {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      <div className="space-y-3">
        <RowCheckboxes
          label="Milks this station can serve"
          items={choices.milks}
          selected={selectedMilks}
          fieldKey="milk_types"
        />
        <RowCheckboxes
          label="Drinks this station can make"
          items={choices.drinks}
          selected={selectedDrinks}
          fieldKey="coffee_types"
        />
        {selectedDrinks.size === 0 && (
          <div className="text-xs text-gray-500 italic -mt-2">
            Nothing ticked = this station can make all drinks.
          </div>
        )}
        <RowCheckboxes
          label="Cup sizes"
          items={choices.sizes}
          selected={selectedSizes}
          fieldKey="sizes"
        />

        <div className="flex flex-wrap items-center gap-4 pt-2 border-t border-gray-200">
          <label className="inline-flex items-center text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={!!current.alt_milk}
              onChange={(e) => setField('alt_milk', e.target.checked)}
              className="mr-1.5 h-4 w-4 accent-amber-600"
            />
            <span>Alt milk available</span>
            <span className="ml-1 text-gray-400" title="Label only — order routing follows the ticked milk list above, not this box.">ⓘ</span>
          </label>
          {altMilkContradiction && (
            <span className={`text-xs px-2 py-0.5 rounded ${current.alt_milk ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'}`}>
              {current.alt_milk
                ? '⚠ No alt milk is ticked above — routing follows the milk list, so alt-milk orders will NOT come here.'
                : '⚠ Alt milks ARE ticked above — routing follows the milk list, so alt-milk orders WILL come here.'}
            </span>
          )}
          <label className="inline-flex items-center text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={!!current.high_volume}
              onChange={(e) => setField('high_volume', e.target.checked)}
              className="mr-1.5 h-4 w-4 accent-amber-600"
            />
            <span>High volume</span>
          </label>
          <label className="inline-flex items-center text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={!!current.vip_service}
              onChange={(e) => setField('vip_service', e.target.checked)}
              className="mr-1.5 h-4 w-4 accent-amber-600"
            />
            <span>VIP service</span>
          </label>
          <label className="inline-flex items-center text-sm" title="Max orders this station can hold in its queue (used by load balancing)">
            <span className="mr-2 text-gray-600">Max queue:</span>
            <input
              type="number"
              min="1"
              max="100"
              value={current.capacity || 10}
              onChange={(e) => setField('capacity', parseInt(e.target.value, 10) || 10)}
              className="w-16 px-2 py-1 border border-gray-300 rounded text-sm"
            />
          </label>
          <label className="inline-flex items-center text-sm" title="How many drinks this station makes at the same time (steam wands / group heads / baristas). Feeds the wait-time estimate — a 3-group station clears its queue ~3× faster.">
            <span className="mr-2 text-gray-600">Drinks at once:</span>
            <input
              type="number"
              min="1"
              max="20"
              value={current.concurrent || 1}
              onChange={(e) => setField('concurrent', Math.max(1, parseInt(e.target.value, 10) || 1))}
              className="w-16 px-2 py-1 border border-gray-300 rounded text-sm"
            />
          </label>
          <label className="inline-flex items-center text-sm" title="How many baristas are on this station (context for throughput; shown in the post-event report).">
            <span className="mr-2 text-gray-600">Baristas:</span>
            <input
              type="number"
              min="0"
              max="20"
              value={current.baristas ?? ''}
              placeholder="—"
              onChange={(e) => setField('baristas', e.target.value === '' ? null : Math.max(0, parseInt(e.target.value, 10) || 0))}
              className="w-16 px-2 py-1 border border-gray-300 rounded text-sm"
            />
          </label>
          <label className="inline-flex items-center text-sm" title="The team's expected throughput in orders/hour. Used for the wait estimate before real make-times exist; the post-event report shows the ACTUAL rate so you can refine this next time.">
            <span className="mr-2 text-gray-600">Expected /hour:</span>
            <input
              type="number"
              min="0"
              max="1000"
              value={current.throughput_per_hour ?? ''}
              placeholder="—"
              onChange={(e) => setField('throughput_per_hour', e.target.value === '' ? null : Math.max(0, parseInt(e.target.value, 10) || 0))}
              className="w-20 px-2 py-1 border border-gray-300 rounded text-sm"
            />
          </label>
        </div>
      </div>
    </div>
  );
};

// ── Top-level editor ─────────────────────────────────────────────────
const StationCapabilitiesEditor = () => {
  const [stations, setStations] = useState([]);
  const [inventory, setInventory] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [s, inv] = await Promise.all([
          StationsService.getStations(),
          EventInventoryService.load(),
        ]);
        if (cancelled) return;
        setStations(Array.isArray(s) ? s : (s?.stations || []));
        setInventory(inv);
      } catch (e) {
        console.error('CapabilitiesEditor load failed:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Pull the canonical catalog lists so the capability checkboxes
  // show the same names the order pipeline uses end-to-end.
  const { items: catalogMilks } = useCatalog('milk');
  const { items: catalogDrinks } = useCatalog('drink');
  const { items: catalogSizes } = useCatalog('size');
  const catalog = useMemo(() => ({
    milks: catalogMilks || [], drinks: catalogDrinks || [], sizes: catalogSizes || [],
  }), [catalogMilks, catalogDrinks, catalogSizes]);

  const choices = useMemo(() => namesFromInventory(inventory, catalog), [inventory, catalog]);

  if (loading) {
    return <div className="p-4 text-sm text-gray-500">Loading stations and inventory…</div>;
  }

  if (!stations.length) {
    return (
      <div className="p-4 text-sm text-gray-600">
        No stations found. Add stations in Organiser → Stations first.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-blue-50 border-l-4 border-blue-400 p-3 rounded">
        <p className="text-sm text-blue-900">
          <strong>What this controls:</strong> the SMS bot routes incoming
          orders to whichever station can actually make them. If a station
          doesn't have "oat" ticked, oat-milk orders won't be assigned there.
          Use this when a station's equipment changes mid-event (frother
          breaks, ran out of a specific milk, etc.).
        </p>
        <p className="text-xs text-blue-700 mt-1">
          Changes take effect on the next incoming order — no restart needed.
        </p>
      </div>

      {stations.map(station => (
        <StationCapabilityCard
          key={station.id}
          station={station}
          choices={choices}
        />
      ))}
    </div>
  );
};

export default StationCapabilitiesEditor;
