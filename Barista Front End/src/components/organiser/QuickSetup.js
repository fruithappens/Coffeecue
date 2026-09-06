// components/QuickSetup.js
//
// One-page wizard that ends "configuring an event takes 30 clicks".
// Single Apply button POSTs to /api/quick-setup which rebuilds
// inventory, sets the unlimited-stock flag, clones station
// capabilities, and (optionally) clears the break schedule.
//
// Defaults are the operator's "café style" — full cream / skim / oat /
// almond / lactose-free; medium cup only; sugar; espresso-based drinks
// only; everything else off. Operators tweak the checkboxes if they
// need more.
import React, { useEffect, useState } from 'react';
import { Zap, Check, AlertTriangle, RefreshCw } from 'lucide-react';
import ApiServiceClass from '../../services/ApiService';
import EventInventoryService from '../../services/EventInventoryService';
import useCatalog from '../../hooks/useCatalog';
import { event as logEvent } from '../../services/logging';

const api = new ApiServiceClass();

const MILK_OPTIONS = ['full cream', 'skim', 'oat', 'almond', 'lactose free',
                      'soy', 'coconut', 'macadamia'];
const SIZE_OPTIONS = ['small', 'medium', 'large'];
const SWEETENER_OPTIONS = ['no sugar', '1 sugar', '2 sugar', '3 sugar', 'half sugar'];
const EXTRA_DRINK_OPTIONS = [
  { key: 'hot_chocolate', label: 'Hot Chocolate' },
  { key: 'chai',          label: 'Chai Latte' },
  { key: 'matcha',        label: 'Matcha Latte' },
];

// Tea is its own section now (operator wanted per-flavor control).
// Each key maps to a single drink name in InventoryManagement.
const TEA_OPTIONS = [
  { key: 'english_breakfast', label: 'English Breakfast', name: 'English Breakfast Tea' },
  { key: 'earl_grey',         label: 'Earl Grey',         name: 'Earl Grey Tea' },
  { key: 'green',             label: 'Green Tea',         name: 'Green Tea' },
  { key: 'peppermint',        label: 'Peppermint',        name: 'Peppermint Tea' },
  { key: 'chamomile',         label: 'Chamomile',         name: 'Chamomile Tea' },
  { key: 'lemon_ginger',      label: 'Lemon & Ginger',    name: 'Lemon & Ginger Tea' },
  { key: 'rooibos',           label: 'Rooibos',           name: 'Rooibos Tea' },
  { key: 'generic',           label: 'Generic Hot Tea',   name: 'Hot Tea' },
];

// The InventoryManagement UI uses a different, prettier set of names
// than the SMS bot. Map between them so a selection here propagates to
// the localStorage that the UI reads. Anything not in these maps is
// DISABLED (rather than deleted) in localStorage so the operator can
// re-enable individual items later from the inventory panel.
const MILK_NAME_MAP = {
  'full cream':   'Whole Milk',
  'skim':         'Skim Milk',
  'oat':          'Oat Milk',
  'almond':       'Almond Milk',
  'soy':          'Soy Milk',
  'coconut':      'Coconut Milk',
  'macadamia':    'Macadamia Milk',
  'lactose free': 'Lactose-Free Milk',  // not in defaults — gets added
};
const SIZE_NAME_MAP = {
  'small':  ['Small (8oz)', 'Takeaway Cup Small'],
  'medium': ['Medium (12oz)', 'Takeaway Cup Medium', 'Ceramic Mug'],
  'large':  ['Large (16oz)', 'Takeaway Cup Large'],
};
// Per-station stock only gets ONE canonical cup name per selected
// size. The map above is intentionally broader so any pre-existing
// cup variant in InventoryManagement gets toggled on; using all of
// them in walk-in stock made Steve see "Takeaway Medium", "12oz" and
// "Ceramic Mug" after ticking just "medium".
const CANONICAL_SIZE_NAME = {
  'small':  'Small',
  'medium': 'Medium',
  'large':  'Large',
};
const SWEETENER_NAME_MAP = {
  'no sugar':    [],                 // "no sugar" needs no inventory row
  '1 sugar':     ['White Sugar'],
  '2 sugar':     ['White Sugar'],
  '3 sugar':     ['White Sugar'],
  'half sugar':  ['White Sugar'],
};
// The "extra drink" checkboxes map to specific Non-Coffee Drinks
// entries. Tea is handled separately (see TEA_OPTIONS) so each
// flavor can be toggled independently.
const EXTRA_DRINK_NAME_MAP = {
  hot_chocolate: ['Hot Chocolate'],
  chai:          ['Chai Latte'],
  matcha:        ['Matcha Latte'],
};
// Always-keep coffee types (espresso-based drinks the SMS bot supports
// by default). Cold Brew / Filter / Americano / Macchiato / Cortado /
// Golden Latte / Iced Tea / Juice / Smoothie are all DISABLED by Quick
// Setup unless the operator turns them back on individually.
const KEEP_COFFEE_NAMES = new Set([
  'Espresso', 'Latte', 'Cappuccino', 'Flat White', 'Mocha',
  // Long Black isn't in InventoryManagement defaults but is in the
  // backend menu — included for completeness if the operator adds it.
  'Long Black',
]);

const DEFAULT_STATE = {
  milks: ['full cream', 'skim', 'oat', 'almond', 'lactose free'],
  sizes: ['medium'],
  sweeteners: ['no sugar', '1 sugar', '2 sugar'],
  drinks: {
    espresso_drinks: true,
    hot_chocolate: false,
    chai: false,
    matcha: false,
  },
  teas: {
    english_breakfast: false,
    earl_grey: false,
    green: false,
    peppermint: false,
    chamomile: false,
    lemon_ginger: false,
    rooibos: false,
    generic: false,
  },
  // Free-text additional tea blends — comma-separated. Each becomes
  // its own drinks-category inventory row.
  custom_teas: '',
  unlimited_stock: true,
  all_stations_same_capabilities: true,
  always_open_schedule: true,
  // Generic demo-friendly VIP code. Operator changes for real events.
  // Set to '' to skip — preserves whatever code is currently saved.
  vip_code: 'VIP',
  // Flip every station status to 'active' on apply. Saves the new
  // operator from going into Stations and toggling each one.
  activate_all_stations: true,
  // SMS "started" policy. queue_only = smart suppression for small
  // events; default per Steve. Persisted to settings/sms-policy via
  // a side-call from apply(); not part of the main quick-setup payload.
  started_sms_policy: 'queue_only',
  // Event identity — the human-readable name that shows up in welcome
  // SMS, display screens, and the header. First thing a new operator
  // sees in Quick Setup. Empty = preserve whatever is already saved.
  event_name: '',
  // Event accounts. If filled in, apply() creates one admin and N
  // barista accounts using a naming convention so a single event has
  // tiered access without sharing the admin login. Empty slug or empty
  // password skips account creation.
  // Example: slug=treenet, password=Tree2026, count=3 →
  //   treenetadmin (admin), treenet1, treenet2, treenet3 (baristas)
  event_slug: '',
  event_password: '',
  num_event_baristas: 3,
};

// localStorage key for the in-progress Quick Setup form. Persisting
// here means an operator who ticks Hot Chocolate, switches to Live
// Ops, then comes back doesn't lose their selection. Cleared after
// a successful Apply so a fresh visit gets the backend's defaults.
const DRAFT_KEY = 'quick_setup_draft';

const _readDraft = () => {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_) {
    return null;
  }
};

const _writeDraft = (cfg, forEvent) => {
  try {
    // Stamp the draft with the event it was typed FOR. A draft is
    // per-event working state, not a preference: after a wipe the old
    // event's half-finished form must not repopulate the new event's
    // Quick Setup (Steve: "Quicksetup has ctn details in the field
    // when a wipe occurs").
    localStorage.setItem(DRAFT_KEY, JSON.stringify(
      forEvent ? { ...cfg, _for_event: forEvent } : cfg));
  } catch (_) { /* localStorage full / disabled — non-fatal */ }
};

const QuickSetup = () => {
  // Hydrate from the saved draft synchronously so the first render
  // already shows the operator's last selections. Backend defaults
  // only kick in if there's no draft.
  const [config, setConfig] = useState(() => {
    const draft = _readDraft();
    return draft ? { ...DEFAULT_STATE, ...draft,
      // Deep-merge the nested objects so partially-saved drafts
      // (e.g. only `drinks` filled in) don't drop the top-level
      // defaults for the other fields.
      drinks: { ...DEFAULT_STATE.drinks, ...(draft.drinks || {}) },
      teas:   { ...DEFAULT_STATE.teas,   ...(draft.teas   || {}) },
    } : DEFAULT_STATE;
  });
  // Which event does the SERVER currently think this is? Used to
  // decide whether the saved draft belongs to this event or to a
  // previous one that has since been wiped.
  const [serverEventName, setServerEventName] = useState(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/display/config');
        const b = r.ok ? await r.json() : {};
        const c = b.config || b.data || b || {};
        const name = c.event_name || '';
        if (cancelled) return;
        setServerEventName(name);
        const draft = _readDraft();
        if (!draft) return;
        // A draft stamped for a DIFFERENT event is a leftover from
        // before a wipe: discard it and show clean defaults. Legacy
        // unstamped drafts are judged by the event name typed in them.
        const draftEvent = draft._for_event ?? draft.event_name ?? null;
        if (draftEvent && name && draftEvent !== name) {
          localStorage.removeItem(DRAFT_KEY);
          setConfig({ ...DEFAULT_STATE });
        }
      } catch (_) { /* offline: keep the draft, it may still be right */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState(null);
  const [savingVip, setSavingVip] = useState(false);

  // Save ONLY the VIP code — no rebuild, no diff, nothing else touched.
  // The full Apply below is destructive (it rebuilds inventory); making a
  // one-field change go through that was alarming and dangerous mid-event
  // (Steve). This writes settings.vip_code on its own.
  const saveVipCodeOnly = async () => {
    setSavingVip(true);
    const code = (config.vip_code || '').trim();
    try {
      await api.request('/settings/vip-code', {
        method: 'PUT', body: JSON.stringify({ vip_code: code }),
      });
      window.dispatchEvent(new CustomEvent('app:toast', { detail: {
        message: code ? `VIP code saved as "${code}" — nothing else changed.`
                      : 'VIP code cleared — nothing else changed.',
        type: 'success', duration: 5000 } }));
    } catch (e) {
      window.dispatchEvent(new CustomEvent('app:toast', { detail: {
        message: 'Could not save the VIP code — check the connection and try again.',
        type: 'error', duration: 6000 } }));
    } finally {
      setSavingVip(false);
    }
  };
  // Drift-preview modal state. opened by the Apply button; the real
  // apply is gated behind the operator confirming the diff.
  const [previewLoading, setPreviewLoading] = useState(false);
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState(null);

  // Fetch the server's suggested defaults on mount. We ONLY apply
  // them when there's no draft — if the operator has ticks in
  // progress, we don't want a backend fetch to clobber them.
  useEffect(() => {
    if (_readDraft()) return;  // local draft wins
    api.request('/quick-setup/preset', { method: 'GET' })
       .then(resp => {
         if (resp && resp.preset) {
           setConfig(c => ({ ...c, ...resp.preset,
             drinks: { ...c.drinks, ...(resp.preset.drinks || {}) },
           }));
         }
       })
       .catch(() => { /* defaults are fine if server is unreachable */ });
  }, []);

  // Persist every config change. Cheap — fires on every tick/untick,
  // writes a small JSON blob. The draft is cleared after a
  // successful Apply (see apply() below).
  useEffect(() => {
    _writeDraft(config, serverEventName);
  }, [config]);

  const toggleArrayItem = (key, value) => {
    setConfig(c => {
      const arr = c[key] || [];
      return {
        ...c,
        [key]: arr.includes(value) ? arr.filter(v => v !== value) : [...arr, value],
      };
    });
  };

  const toggleDrink = (key) => {
    setConfig(c => ({ ...c, drinks: { ...c.drinks, [key]: !c.drinks[key] } }));
  };

  const toggleTea = (key) => {
    setConfig(c => ({ ...c, teas: { ...(c.teas || {}), [key]: !(c.teas || {})[key] } }));
  };

  const setCustomTeas = (val) => {
    setConfig(c => ({ ...c, custom_teas: val }));
  };

  // Parse the free-text custom_teas string into an array of names.
  // Splits on commas/newlines, trims, drops empties, and de-dupes
  // against the existing tea checkboxes.
  const customTeaList = () => {
    const raw = (config.custom_teas || '').trim();
    if (!raw) return [];
    const builtIn = new Set(TEA_OPTIONS.map(t => t.name.toLowerCase()));
    return raw.split(/[,\n]+/)
      .map(s => s.trim())
      .filter(s => s.length > 0 && !builtIn.has(s.toLowerCase()))
      // Make sure each entry ends in "Tea" so it's discoverable
      // alongside the standard tea names.
      .map(s => /\btea\b/i.test(s) ? s : `${s} Tea`);
  };

  // Build the per-station stock data the Barista UI and walk-in
  // dialog actually read (localStorage `coffee_stock_station_N`).
  // Without this each station shows whatever stock it had before
  // Quick Setup ran — inconsistent milks, missing options, etc.
  //
  // Stock items use the structure the rest of the UI expects:
  // { id, name, amount, capacity, unit, status, lowThreshold,
  //   criticalThreshold, enabled }.
  // When unlimited_stock is on we use a large capacity so the
  // station never appears low; when off we use modest event-style
  // starting amounts.
  const buildStockItem = (id, name, category, unlimited) => {
    const big = unlimited;
    let amount = 20, capacity = 40, unit = 'L';
    if (category === 'milk') {
      amount = big ? 999 : 30; capacity = big ? 999 : 60; unit = 'L';
    } else if (category === 'coffee') {
      amount = big ? 999 : 5; capacity = big ? 999 : 10; unit = 'kg';
    } else if (category === 'cups') {
      amount = big ? 9999 : 200; capacity = big ? 9999 : 500; unit = 'pcs';
    } else if (category === 'sweeteners') {
      amount = big ? 9999 : 500; capacity = big ? 9999 : 1000; unit = 'pcs';
    } else if (category === 'drinks') {
      amount = big ? 9999 : 50; capacity = big ? 9999 : 100; unit = 'units';
    } else {
      amount = big ? 9999 : 100; capacity = big ? 9999 : 200; unit = 'units';
    }
    return {
      id, name, amount, capacity, unit,
      status: 'good',
      lowThreshold: Math.max(1, capacity * 0.25),
      criticalThreshold: Math.max(1, capacity * 0.1),
      enabled: true,
      category,
    };
  };

  // Build per-station stock with MERGE semantics — preserve any
  // amount the operator has adjusted. Steve's framing: 'Quick Setup
  // should auto-populate but not override. If the barista sets a
  // milk to 2L during service, re-running Quick Setup must not
  // reset it to 30L.'
  //
  // Merge rules per item:
  //   - exists in current stock + still enabled by QS → keep existing
  //     (amount, capacity, thresholds — all operator-tuned values)
  //   - exists in current stock + no longer enabled → drop (operator
  //     intent: 'no longer offering this' propagates)
  //   - newly enabled by QS → seed with default amount/capacity
  //   - manually-added custom item (id starts with 'custom_' or has
  //     no QS-matching name) → always preserve
  const rebuildPerStationStock = (stations, enabledByCategory) => {
    if (!Array.isArray(stations) || stations.length === 0) return;
    const unlimited = !!config.unlimited_stock;

    // Helper: index a stock category by id for fast lookup.
    const _byId = (arr) => {
      const m = new Map();
      if (Array.isArray(arr)) arr.forEach(it => it && it.id && m.set(it.id, it));
      return m;
    };
    const _isCustom = (id) =>
      typeof id === 'string' && (id.startsWith('custom_') || id.startsWith('user_'));

    stations.forEach(station => {
      const stationId = station.id;
      const stockKey = `coffee_stock_station_${stationId}`;

      // Read existing stock so we can preserve operator-tuned amounts.
      let existing = { milk: [], coffee: [], cups: [], sweeteners: [], drinks: [], other: [] };
      try {
        const cur = JSON.parse(localStorage.getItem(stockKey) || 'null');
        if (cur && typeof cur === 'object') existing = { ...existing, ...cur };
      } catch { /* ignore parse errors */ }

      const stockData = {
        milk: [], coffee: [], cups: [], sweeteners: [], drinks: [], other: [],
        lastUpdated: new Date().toISOString(),
      };

      // For each category, merge the QS-enabled list with existing.
      const _mergeCategory = (catKey, enabledNames) => {
        const existingById = _byId(existing[catKey]);
        const idFromName = (name) => {
          if (catKey === 'cups') return name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
          return name.toLowerCase().replace(/\s+/g, '_');
        };
        // 1. QS-enabled items: preserve if exists (normal mode), or
        //    overwrite with 999 amounts (unlimited mode). Steve's
        //    expectation: ticking 'unlimited stock' should put every
        //    item to high amounts even on a re-run. Preserve-mode is
        //    only right when the operator is tracking real quantities.
        enabledNames.forEach(name => {
          const id = idFromName(name);
          const prior = existingById.get(id);
          if (prior && !unlimited) {
            // Normal mode: keep operator-tuned amount/capacity.
            stockData[catKey].push({ ...prior, name, enabled: true });
            existingById.delete(id);
          } else if (prior && unlimited) {
            // Unlimited mode: force to 999 so the operator's intent
            // ('don't reject orders for stock') actually takes effect.
            // Preserve id (for stable React keys) but overwrite the
            // amount fields from buildStockItem.
            const fresh = buildStockItem(id, name, catKey, unlimited);
            stockData[catKey].push({ ...prior, ...fresh, name, enabled: true });
            existingById.delete(id);
          } else {
            // No prior — seed with default amount.
            stockData[catKey].push(buildStockItem(id, name, catKey, unlimited));
          }
        });
        // 2. What's left in existingById is either:
        //    (a) a custom operator-added item — KEEP (still respect
        //        unlimited mode by bumping amounts)
        //    (b) something QS just disabled — DROP
        existingById.forEach((item, id) => {
          if (_isCustom(id)) {
            if (unlimited) {
              const fresh = buildStockItem(id, item.name, catKey, true);
              stockData[catKey].push({ ...item, ...fresh, name: item.name, enabled: true });
            } else {
              stockData[catKey].push(item);
            }
          }
        });
      };

      _mergeCategory('milk',       enabledByCategory.milk);
      _mergeCategory('cups',       enabledByCategory.cups);
      _mergeCategory('sweeteners', enabledByCategory.sweeteners);
      _mergeCategory('drinks',     enabledByCategory.drinks);

      // Coffee beans — Quick Setup always seeds house blend + decaf,
      // same merge logic.
      _mergeCategory('coffee', ['House Blend Beans', 'Decaf Beans']);

      // Preserve any items in 'other' the operator added manually.
      if (Array.isArray(existing.other)) stockData.other = existing.other;

      localStorage.setItem(stockKey, JSON.stringify(stockData));
    });

    // Tell any listening UI to refresh.
    window.dispatchEvent(new CustomEvent('stock:updated', {
      detail: { stations: stations.map(s => s.id) },
    }));
  };

  // Build the per-station inventory config (which items are
  // enabled at which station). Same shape used by
  // StationInventoryConfig and the sweetener-availability check in
  // WalkInOrderDialog.
  //
  // Three modes:
  //   - all_stations_same=true → overwrite ALL stations with the
  //     enabled-everywhere config (clean slate from Quick Setup)
  //   - all_stations_same=false AND station has an existing config
  //     → preserve it (operator wants per-station control)
  //   - all_stations_same=false AND station has NO config (or empty)
  //     → seed it with the enabled-everywhere config (so new stations
  //     or untouched ones get something rather than zero items)
  //
  // The third case is what Steve hit: opening Station 1's inventory
  // tab showed 0/18 items after Quick Setup because all_stations_same
  // was off and the function returned without touching anything.
  const rebuildStationConfigs = (stations, eventInventory) => {
    if (!Array.isArray(stations) || stations.length === 0) return;
    const allSame = !!config.all_stations_same_capabilities;

    // Build the canonical "enabled everywhere" config from event inventory.
    const enabledEverywhereCfg = {};
    Object.entries(eventInventory).forEach(([cat, items]) => {
      if (!Array.isArray(items)) return;
      enabledEverywhereCfg[cat] = {};
      items.forEach(item => {
        enabledEverywhereCfg[cat][item.id] = !!item.enabled;
      });
    });

    // Load existing configs so we know which stations to preserve vs seed.
    let existing = {};
    try {
      existing = JSON.parse(localStorage.getItem('station_inventory_configs') || '{}') || {};
    } catch { existing = {}; }

    const _isEmpty = (cfg) => {
      if (!cfg || typeof cfg !== 'object') return true;
      // Empty if no category has any item set to true.
      return !Object.values(cfg).some(catObj =>
        catObj && typeof catObj === 'object' &&
        Object.values(catObj).some(v => v === true));
    };

    const cfg = {};
    stations.forEach(station => {
      const existingForStation = existing[station.id];
      if (allSame) {
        // Overwrite mode — every station gets the canonical config.
        cfg[station.id] = JSON.parse(JSON.stringify(enabledEverywhereCfg));
      } else if (_isEmpty(existingForStation)) {
        // Seed mode — station has nothing enabled, give it the default.
        // Without this, Station 1 stayed at 0/18 after Quick Setup.
        cfg[station.id] = JSON.parse(JSON.stringify(enabledEverywhereCfg));
      } else {
        // Preserve mode — operator has set this one up manually.
        cfg[station.id] = existingForStation;
      }
    });

    localStorage.setItem('station_inventory_configs', JSON.stringify(cfg));
    // Legacy key still read by WalkInOrderDialog's sweetener check
    // and StationDefaults — keep them in sync.
    localStorage.setItem('stationInventoryConfig', JSON.stringify(cfg));
    window.dispatchEvent(new CustomEvent('stationConfig:updated', { detail: cfg }));
  };

  // Rebuild the localStorage inventory the InventoryManagement panel
  // reads. Without this, the operator opens that panel after Quick
  // Setup and sees Rice Milk, Cold Brew, every syrup, every extra
  // still enabled because they live in a separate store. We
  // overwrite the whole `event_inventory` blob with: defaults for
  // every category, but `enabled` set only for items in the
  // operator's Quick Setup selection.
  const rebuildLocalInventory = (stationsFromBackend) => {
    const enabledMilks = new Set(config.milks.map(m => MILK_NAME_MAP[m]).filter(Boolean));
    const enabledSizes = new Set(config.sizes.flatMap(s => SIZE_NAME_MAP[s] || []));
    const enabledSweeteners = new Set(config.sweeteners.flatMap(s => SWEETENER_NAME_MAP[s] || []));
    const enabledDrinks = new Set();
    if (config.drinks.hot_chocolate) EXTRA_DRINK_NAME_MAP.hot_chocolate.forEach(n => enabledDrinks.add(n));
    if (config.drinks.chai)          EXTRA_DRINK_NAME_MAP.chai.forEach(n => enabledDrinks.add(n));
    if (config.drinks.matcha)        EXTRA_DRINK_NAME_MAP.matcha.forEach(n => enabledDrinks.add(n));
    // Teas — both the built-in flavors and any custom blends the
    // operator typed in free-text.
    TEA_OPTIONS.forEach(t => {
      if (config.teas && config.teas[t.key]) enabledDrinks.add(t.name);
    });
    customTeaList().forEach(n => enabledDrinks.add(n));

    const categoryFilter = {
      milk:       enabledMilks,
      coffee:     KEEP_COFFEE_NAMES,  // espresso drinks; nothing turns off
      cups:       enabledSizes,
      sweeteners: enabledSweeteners,
      drinks:     enabledDrinks,
      syrups:     new Set(),  // all OFF
      extras:     new Set(),  // all OFF
    };

    let existing = {};
    try {
      existing = JSON.parse(localStorage.getItem('event_inventory') || '{}');
    } catch (e) {
      existing = {};
    }

    // The toggle loop below relies on `item.name` matching one of the
    // canonical names in `categoryFilter` (MILK_NAME_MAP values,
    // SIZE_NAME_MAP values, etc.). On a fresh install
    // localStorage.event_inventory is empty, so the loop never runs
    // and we write {} to the backend — InventoryManagement then
    // hydrates from its hardcoded defaults with EVERYTHING enabled.
    //
    // Worse: on a partial / stale install (an operator ran an older
    // Quick Setup at some point), `existing` has SOME rows but
    // possibly under different names than the current mappers expect.
    // E.g. cups seed used 'Small' but SIZE_NAME_MAP looks for
    // 'Small (8oz)' — so the cup toggle never matched anything,
    // showing every cup disabled regardless of the operator's pick.
    //
    // Fix: for each category, ENSURE every name our matcher knows
    // about is present. Don't replace existing items — just add the
    // missing canonical entries. The toggle loop then produces the
    // right result whether the install is fresh OR stale.
    //
    // Names listed here MUST match the values that appear in
    // MILK_NAME_MAP / SIZE_NAME_MAP / SWEETENER_NAME_MAP /
    // EXTRA_DRINK_NAME_MAP / TEA_OPTIONS at the top of this file.
    const CANONICAL_BY_CATEGORY = {
      milk: [
        { name: 'Whole Milk',        description: 'Regular dairy milk' },
        { name: 'Skim Milk',         description: 'Low-fat dairy milk' },
        { name: 'Oat Milk',          description: 'Plant-based oat milk' },
        { name: 'Almond Milk',       description: 'Plant-based almond milk' },
        { name: 'Soy Milk',          description: 'Plant-based soy milk' },
        { name: 'Coconut Milk',      description: 'Plant-based coconut milk' },
        { name: 'Macadamia Milk',    description: 'Plant-based macadamia milk' },
        { name: 'Lactose-Free Milk', description: 'Lactose-free dairy alternative' },
        { name: 'Rice Milk',         description: 'Plant-based rice milk' },
      ],
      coffee: [
        { name: 'Espresso',    description: 'Strong coffee shot' },
        { name: 'Americano',   description: 'Espresso with hot water' },
        { name: 'Latte',       description: 'Espresso with steamed milk' },
        { name: 'Cappuccino',  description: 'Espresso with foam' },
        { name: 'Flat White',  description: 'Double shot with microfoam' },
        { name: 'Long Black',  description: 'Espresso shots topped with hot water' },
        { name: 'Mocha',       description: 'Chocolate coffee drink' },
        { name: 'Macchiato',   description: 'Espresso with milk foam' },
        { name: 'Cortado',     description: 'Equal parts espresso and warm milk' },
        { name: 'Filter Coffee', description: 'Drip brewed coffee' },
        { name: 'Cold Brew',   description: 'Cold steeped coffee' },
      ],
      // Cup names MUST match SIZE_NAME_MAP entries above, including
      // the parenthetical size + the takeaway/ceramic variants.
      cups: [
        { name: 'Small (8oz)',          description: '240ml cup', volume: 240, shots: 1 },
        { name: 'Medium (12oz)',        description: '350ml cup', volume: 350, shots: 1 },
        { name: 'Large (16oz)',         description: '470ml cup', volume: 470, shots: 2 },
        { name: 'Takeaway Cup Small',   description: 'Small disposable cup',  volume: 240, shots: 1 },
        { name: 'Takeaway Cup Medium',  description: 'Medium disposable cup', volume: 350, shots: 1 },
        { name: 'Takeaway Cup Large',   description: 'Large disposable cup',  volume: 470, shots: 2 },
        { name: 'Ceramic Mug',          description: 'Reusable ceramic mug',  volume: 300, shots: 1 },
      ],
      sweeteners: [
        { name: 'White Sugar', description: 'Regular granulated sugar' },
        { name: 'Brown Sugar', description: 'Raw cane sugar' },
        { name: 'Honey',       description: 'Natural honey sweetener' },
        { name: 'Stevia',      description: 'Natural leaf sweetener' },
      ],
      drinks: [
        { name: 'Hot Chocolate',          description: 'Rich chocolate drink' },
        { name: 'Chai Latte',             description: 'Spiced tea with milk' },
        { name: 'Matcha Latte',           description: 'Green tea latte' },
        { name: 'Hot Tea',                description: 'Generic hot tea',         isTea: true },
        { name: 'English Breakfast Tea',  description: 'Classic black tea blend', isTea: true },
        { name: 'Earl Grey Tea',          description: 'Black tea with bergamot', isTea: true },
        { name: 'Green Tea',              description: 'Light green tea',         isTea: true },
        { name: 'Peppermint Tea',         description: 'Caffeine-free mint',      isTea: true },
        { name: 'Chamomile Tea',          description: 'Caffeine-free floral',    isTea: true },
        { name: 'Lemon & Ginger Tea',     description: 'Zesty herbal infusion',   isTea: true },
        { name: 'Rooibos Tea',            description: 'South African red tea',   isTea: true },
      ],
      // syrups + extras intentionally NOT seeded — Quick Setup turns
      // them all OFF, so the operator's existing list (if any) stays
      // untouched. They can opt items back in via Event Inventory.
    };
    Object.keys(CANONICAL_BY_CATEGORY).forEach((catKey) => {
      if (!Array.isArray(existing[catKey])) existing[catKey] = [];
      const existingNames = new Set(
        existing[catKey]
          .map((it) => it && it.name)
          .filter(Boolean)
          .map((n) => n.toLowerCase())
      );
      CANONICAL_BY_CATEGORY[catKey].forEach((tmpl) => {
        if (!existingNames.has(tmpl.name.toLowerCase())) {
          existing[catKey].push({
            id: `qs-add-${catKey}-${tmpl.name.replace(/\W+/g, '-')}`,
            ...tmpl,
            enabled: false,  // toggle loop below flips this if selected
          });
        }
      });
    });

    // Build case-insensitive lookup sets so we match operator-selected
    // names against existing items regardless of how they were
    // originally written ('hot chocolate' vs 'Hot Chocolate' vs
    // 'HOT CHOCOLATE'). Without this, an older Quick Setup run that
    // saved drinks with different casing would never re-enable on
    // a fresh Quick Setup — exactly the 'non-coffee drinks not
    // getting checked' bug.
    const _lower = (s) => (s || '').toString().toLowerCase().trim();
    const lowerCaseFilter = {};
    Object.entries(categoryFilter).forEach(([k, v]) => {
      lowerCaseFilter[k] = v instanceof Set
        ? new Set(Array.from(v).map(_lower))
        : v;
    });

    // Build a "QS knows about this name" set per category. Anything
    // NOT in this set is an operator-added custom item — Quick Setup
    // should leave it alone (don't disable it, don't touch enabled).
    // Steve's framing: 'quick setup is setting up app and not
    // overriding'. So a 'Hemp Milk' the operator added in
    // InventoryManagement won't get auto-disabled the next time
    // Quick Setup runs just because QS doesn't have a Hemp toggle.
    const qsKnownByCategory = {};
    Object.entries(CANONICAL_BY_CATEGORY).forEach(([catKey, tmpls]) => {
      qsKnownByCategory[catKey] = new Set(tmpls.map(t => _lower(t.name)));
    });

    const updated = {};
    Object.entries(existing).forEach(([catKey, items]) => {
      const allowed = lowerCaseFilter[catKey];
      const qsKnown = qsKnownByCategory[catKey] || new Set();
      if (!Array.isArray(items)) {
        updated[catKey] = items;
        return;
      }
      updated[catKey] = items.map(item => {
        const lname = _lower(item.name);
        const isQsManaged = qsKnown.has(lname);
        if (!isQsManaged) {
          // Operator-added custom item — leave enabled state alone.
          return item;
        }
        // QS-managed item — flip enabled based on operator's QS selection.
        const shouldBeOn = allowed ? allowed.has(lname) : false;
        return { ...item, enabled: shouldBeOn };
      });
    });

    // (Lactose-Free Milk now lives in CANONICAL_BY_CATEGORY above —
    // the toggle loop handles it like every other milk. The old
    // special-case here was a workaround for it being absent from
    // InventoryManagement.js defaults.)

    // Add any custom tea blends as new rows in the drinks category
    // so they're discoverable in InventoryManagement after Quick
    // Setup runs. Existing rows are not touched.
    const customTeas = customTeaList();
    if (customTeas.length > 0) {
      if (!Array.isArray(updated.drinks)) updated.drinks = [];
      customTeas.forEach((teaName, i) => {
        const exists = updated.drinks.some(d =>
          d && d.name && d.name.toLowerCase() === teaName.toLowerCase());
        if (!exists) {
          updated.drinks.push({
            id: `qs-tea-${Date.now()}-${i}`,
            name: teaName,
            description: 'Custom tea blend added by Quick Setup',
            isTea: true,
            enabled: true,
          });
        }
      });
    }

    // Diagnostic log so an operator hitting "the drinks aren't
    // checked" can confirm at-a-glance what Quick Setup actually
    // sent through. Open the browser console and look for
    // [QuickSetup] rebuilt event_inventory: ...
    try {
      const summary = {};
      Object.entries(updated).forEach(([k, v]) => {
        if (Array.isArray(v)) {
          summary[k] = {
            total: v.length,
            enabled: v.filter(it => it && it.enabled).map(it => it.name),
          };
        }
      });
      console.log('[QuickSetup] rebuilt event_inventory:', summary);
    } catch (_) { /* logging is best-effort */ }

    // Save to the source-of-truth backend (which also mirrors to
    // localStorage and dispatches inventory:updated). Fire-and-forget
    // — the rest of the Quick Setup flow doesn't need to wait.
    EventInventoryService.save(updated).catch(err => {
      console.warn('Quick Setup: backend inventory save failed (local kept):', err);
      // Local write still happened inside save(); also dispatch the
      // event manually so listeners refresh even if backend was down.
      window.dispatchEvent(new CustomEvent('inventory:updated', { detail: updated }));
    });

    // --- Now mirror into the per-station stores the Barista UI and
    // walk-in dialog actually read. ---
    //
    // The walk-in dialog showing inconsistent milks across stations
    // was traced to `coffee_stock_station_N` keys being whatever each
    // station happened to have set previously. Quick Setup updating
    // only `event_inventory` is not enough — those keys need to be
    // overwritten directly, per station.
    //
    // We need the real station list. Caller passes it from the
    // /api/quick-setup response; if missing we fall back to a small
    // probe of common station IDs so it still does something useful.
    let stations = Array.isArray(stationsFromBackend) ? stationsFromBackend : [];
    if (stations.length === 0) {
      // Best-effort fallback: scan existing localStorage stock keys
      // to find which station IDs currently exist.
      for (let i = 1; i <= 10; i++) {
        if (localStorage.getItem(`coffee_stock_station_${i}`)) {
          stations.push({ id: i, name: `Station ${i}` });
        }
      }
    }

    // Enabled items per category, by display name (matching what
    // the walk-in dialog filters on). For cups we use a single
    // canonical name per selected size — the broader SIZE_NAME_MAP
    // is only used to toggle existing InventoryManagement rows.
    const canonicalCups = config.sizes
      .map(s => CANONICAL_SIZE_NAME[s])
      .filter(Boolean);
    const enabledByCategory = {
      milk: Array.from(enabledMilks),
      cups: canonicalCups,
      sweeteners: Array.from(enabledSweeteners),
      drinks: Array.from(enabledDrinks),
    };

    rebuildPerStationStock(stations, enabledByCategory);
    rebuildStationConfigs(stations, updated);
    // The 'event_menu' reconciliation that used to live here is gone with
    // the Menu Items tab. It kept a SECOND drinks menu in localStorage in
    // step with Quick Setup — a store the server never read, so it decided
    // nothing. Event Inventory is the menu now, and Quick Setup already
    // writes that.
  };


  // Step 1: fetch the dry-run diff. Opens the preview modal; operator
  // confirms there before the destructive apply runs. Replaces the old
  // window.confirm() prompt that just said "trust me."
  const openPreview = async () => {
    setPreviewLoading(true);
    setPreviewError(null);
    setPreview(null);
    logEvent('QUICK_SETUP_PREVIEW_OPEN');
    try {
      const resp = await api.request('/quick-setup/dry-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preset: config }),
      });
      if (resp && resp.success) {
        setPreview(resp);
      } else {
        logEvent('QUICK_SETUP_PREVIEW_FAIL', { reason: 'no_success_flag' });
        // Endpoint missing on older backends — fall back to the old
        // window.confirm so we don't block the operator.
        if (window.confirm(
          'Could not preview changes (dry-run endpoint unavailable).\n\n' +
          'Apply Quick Setup anyway? This rebuilds inventory and may ' +
          'change stock amounts.'
        )) {
          await applyForReal();
        }
      }
    } catch (err) {
      setPreviewError(err.message || String(err));
      logEvent('QUICK_SETUP_PREVIEW_FAIL', { reason: err?.message || 'exception' });
    } finally {
      setPreviewLoading(false);
    }
  };

  const closePreview = () => {
    setPreview(null);
    setPreviewError(null);
  };

  const apply = async () => {
    // Old entry point — kept for back-compat with anything calling
    // apply() directly. Now goes through the preview modal.
    await openPreview();
  };

  const applyForReal = async () => {
    closePreview();
    setApplying(true);
    setResult(null);
    // Things that failed but did not stop the setup. Shown to the operator
    // rather than left in a console nobody has open.
    const warnings = [];
    try {
      const resp = await api.request('/quick-setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preset: config }),
      });

      // Persist the "started" SMS policy separately — it lives in its
      // own settings/sms-policy endpoint so the policy gate can read
      // it from anywhere (not just after Quick Setup runs).
      try {
        await api.request('/settings/sms-policy', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            policy: config.started_sms_policy || 'queue_only',
            threshold_seconds: 60,
          }),
        });
      } catch (smsPolErr) {
        // Non-fatal — the main Quick Setup still succeeded.
        console.warn('Could not save started_sms_policy:', smsPolErr);
      }

      // Event identity — only push if the operator actually typed a
      // name. Blank means "preserve existing", which matters when
      // re-running Quick Setup to add a new milk without wiping the
      // event branding.
      //
      // Two endpoints, two stores: SMS welcome copy reads from the
      // top-level `settings` table (admin_routes.py:692 hardcodes
      // SELECT value FROM settings WHERE key = 'event_name'), while
      // the Branding tab UI reads from the `branding_settings` JSON
      // blob via _kv_get. Push to both so neither view goes stale.
      const eventName = (config.event_name || '').trim();
      if (eventName) {
        try {
          await api.request('/settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ event_name: eventName }),
          });
        } catch (brandErr) {
          // Same treatment as the branding save below: recorded and shown.
          // This is the key the SMS welcome copy reads, so a silent
          // failure here means texts keep naming the previous event.
          console.warn('Could not save event_name to /settings:', brandErr);
          warnings.push(
            `Event name not saved to SMS settings: ${brandErr?.message || brandErr}`
          );
        }
        try {
          // Send ONLY the field this screen owns. The server merges under
          // a row lock, so the Branding tab's logo and colours survive.
          // This used to be a client-side GET-then-PUT read-merge-write,
          // which had a gap: a branding save landing between the two was
          // silently overwritten.
          await api.request('/settings/branding', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ settings: { event_name: eventName } }),
          });
        } catch (brandErr) {
          // Recorded and shown, not just logged. NOT thrown: the main
          // /quick-setup call above has already created stations and
          // inventory, and account creation still has to run below —
          // failing the whole apply over the event name would cost more
          // than it saves.
          console.warn('Could not save event_name to /settings/branding:', brandErr);
          warnings.push(
            `Event name not saved: ${brandErr?.message || brandErr}`
          );
        }
      }

      // Event accounts — create one {slug}admin and N {slug}1..N. We
      // POST sequentially because /api/users/ doesn't do bulk and
      // ordering keeps the audit log readable. Each request is wrapped
      // in its own try so a duplicate-username error (which is the
      // expected re-run case) doesn't break later accounts.
      const accountsCreated = [];
      const accountsSkipped = [];
      const slug = (config.event_slug || '').trim().toLowerCase();
      const pw = config.event_password || '';
      const baristaCount = Math.max(1, Math.min(30, config.num_event_baristas || 3));
      if (slug && pw) {
        const accounts = [
          {
            username: `${slug}admin`,
            fullName: `${slug} Admin`,
            role: 'admin',
            email: `${slug}admin@local`,
          },
          ...Array.from({ length: baristaCount }, (_, i) => ({
            username: `${slug}${i + 1}`,
            fullName: `${slug} Barista ${i + 1}`,
            role: 'barista',
            email: `${slug}${i + 1}@local`,
          })),
        ];
        for (const acct of accounts) {
          try {
            // Trailing slash matters — /api/users 308-redirects to
            // /api/users/ and the redirect drops the JWT header on
            // some browsers, producing a confusing 401.
            await api.request('/users/', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                username: acct.username,
                password: pw,
                full_name: acct.fullName,
                email: acct.email,
                role: acct.role,
              }),
            });
            accountsCreated.push(acct.username);
          } catch (acctErr) {
            // Duplicate username is the expected re-run case. Anything
            // else (e.g. password too weak) gets logged but doesn't
            // abort — partial success is better than zero on re-run.
            const msg = (acctErr && acctErr.message) || '';
            if (/already|exist|duplicate|409/i.test(msg)) {
              accountsSkipped.push(`${acct.username} (exists)`);
            } else {
              accountsSkipped.push(`${acct.username} (${msg.slice(0, 40)})`);
              console.warn(`Could not create ${acct.username}:`, acctErr);
            }
          }
        }
      }

      // Mirror the selections into localStorage so the Inventory
      // Management UI reflects the same enabled-set, AND so each
      // station's `coffee_stock_station_N` blob shows the same
      // milks/coffees/cups (this is what fixes the "walk-in shows
      // different milks at different stations" issue).
      try {
        rebuildLocalInventory(resp.stations);
      } catch (e) {
        console.warn('Could not rebuild localStorage inventory:', e);
      }
      // Stamp the time Quick Setup applied so other tabs (Event
      // Inventory, Station Inventory, Schedule, Menu Items) can show
      // a "this was populated by Quick Setup X ago" banner. Otherwise
      // operators run Quick Setup, open one of those tabs, and have
      // no visual confirmation that anything happened — the
      // populated data looks identical to data they typed in by hand.
      try {
        const stamp = {
          appliedAt: new Date().toISOString(),
          preset: config,
        };
        localStorage.setItem('quick_setup_last_applied', JSON.stringify(stamp));
        // Dispatch so any open tabs refresh their banners immediately.
        window.dispatchEvent(new CustomEvent('quick_setup_applied', { detail: stamp }));
      } catch (_) { /* localStorage may be full / disabled */ }

      // Merge account-creation outcome into the summary so the
      // operator gets one consolidated success card instead of having
      // to dig through the network tab to see if their logins were made.
      const applied = [...(resp.applied || [])];
      if (eventName) applied.push(`Event name: ${eventName}`);
      if (accountsCreated.length) applied.push(`Created accounts: ${accountsCreated.join(', ')}`);
      if (accountsSkipped.length) applied.push(`Skipped accounts: ${accountsSkipped.join(', ')}`);
      setResult({
        success: !!resp.success,
        summary: resp.summary || applied.join('; '),
        applied,
        warnings,
        error: resp.error,
      });
      if (resp.success) {
        logEvent('QUICK_SETUP_APPLIED', {
          appliedCount: applied.length,
          accountsCreated: accountsCreated.length,
        });
      }
    } catch (err) {
      setResult({ success: false, error: err.message });
    } finally {
      setApplying(false);
    }
  };

  const resetDefaults = () => {
    setConfig(DEFAULT_STATE);
    // Drop the persisted draft so the next mount doesn't immediately
    // re-hydrate the just-cleared selections. The autosave effect
    // above will then write DEFAULT_STATE back as the new draft on
    // the next render — that's fine, it just means "Reset → Reset"
    // is idempotent.
    try { localStorage.removeItem(DRAFT_KEY); } catch (_) { /* non-fatal */ }
  };

  const Checkbox = ({ checked, onChange, label }) => (
    <label className="inline-flex items-center mr-3 mb-2 cursor-pointer select-none">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="mr-2 h-4 w-4 accent-amber-600"
      />
      <span className={checked ? 'text-gray-900' : 'text-gray-500'}>{label}</span>
    </label>
  );

  return (
    <div className="p-0 sm:p-6 max-w-4xl">
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6 flex items-start">
        <Zap className="w-6 h-6 text-amber-600 mr-3 mt-0.5 flex-shrink-0" />
        <div>
          <h2 className="text-xl font-bold text-amber-800">Quick Setup</h2>
          <p className="text-amber-700 text-sm mt-1">
            One click to fill in sensible defaults across inventory, station
            configs, stock amounts, menu, schedule, and VIP code — enough
            to demo the whole app or get a fresh event ready to take orders.
          </p>
          <p className="text-amber-700 text-sm mt-2">
            <strong>Safe to re-run.</strong> Quick Setup seeds — it doesn't
            override. Existing stock amounts, custom items you added in
            Inventory Management, and per-station tweaks all survive.
            Only QS-managed items get reconciled to match the selections
            below.
          </p>
        </div>
      </div>

      {/* Event templates — load a previously-saved preset, or save the
          current form state as a template for future events. Templates
          strip per-event identity (event_name, password, slug) before
          saving so they apply cleanly across venues. */}
      <EventTemplatesSection config={config} setConfig={setConfig} />

      {/* Event identity — the human name of THIS event. Promoted from
          Branding into Quick Setup because it's the first thing every
          new operator types and it drives SMS welcome copy + display
          screen header. Empty = preserve existing setting (so re-running
          Quick Setup doesn't wipe the name). */}
      <div className="bg-white rounded-lg shadow-sm p-6 mb-4">
        <h3 className="font-semibold text-lg mb-1">Event identity</h3>
        <p className="text-sm text-gray-500 mb-3">
          The name of this event. Shows up in welcome SMS ("Welcome to
          {' '}<em>Hills Baptist 2026</em>"), the Display screen header,
          and the Organiser sidebar. Leave blank to keep the existing name.
        </p>
        <input
          type="text"
          value={config.event_name || ''}
          onChange={(e) => setConfig(c => ({ ...c, event_name: e.target.value }))}
          placeholder="e.g. Hills Baptist 2026, Treenet Conference"
          className="w-full max-w-md px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-amber-500"
          maxLength={80}
        />
      </div>

      {/* Event accounts — Steve's pattern. One admin account with full
          control + N barista accounts with limited control, all sharing
          one password per event. Naming convention: {slug}admin gets
          full access; {slug}1, {slug}2, {slug}3 are baristas (can take
          orders but can't change stock or setup). Skipped if slug or
          password is blank. Idempotent on the backend — re-applying
          with the same slug returns "already exists" rather than
          erroring, so this is safe to re-run. */}
      <div className="bg-white rounded-lg shadow-sm p-6 mb-4">
        <h3 className="font-semibold text-lg mb-1">Event accounts</h3>
        <p className="text-sm text-gray-500 mb-3">
          Create one admin + N barista logins for this event in one go.
          They all share the same password (simpler for a single event;
          rotate after). Leave the slug or password blank to skip.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="text-sm">
            <span className="block text-gray-600 mb-1">Event slug</span>
            <input
              type="text"
              value={config.event_slug || ''}
              onChange={(e) => setConfig(c => ({
                ...c,
                // Sanitise to lowercase alphanumerics — usernames need
                // to be URL/login-safe. Strip spaces and punctuation.
                event_slug: e.target.value
                  .toLowerCase()
                  .replace(/[^a-z0-9]/g, '')
                  .slice(0, 20),
              }))}
              placeholder="treenet"
              className="w-full px-2 py-1 border border-gray-300 rounded font-mono"
              maxLength={20}
            />
          </label>
          <label className="text-sm">
            <span className="block text-gray-600 mb-1">Shared password</span>
            <input
              type="text"
              value={config.event_password || ''}
              onChange={(e) => setConfig(c => ({ ...c, event_password: e.target.value }))}
              placeholder="Tree2026"
              className="w-full px-2 py-1 border border-gray-300 rounded font-mono"
              maxLength={64}
            />
          </label>
          <label className="text-sm">
            <span className="block text-gray-600 mb-1">Barista accounts</span>
            <input
              type="number"
              min={1}
              max={30}
              value={config.num_event_baristas || 3}
              onChange={(e) => setConfig(c => ({
                ...c,
                num_event_baristas: Math.max(1, Math.min(30, parseInt(e.target.value, 10) || 1)),
              }))}
              className="w-full px-2 py-1 border border-gray-300 rounded font-mono"
            />
          </label>
        </div>
        {config.event_slug && config.event_password && (
          <div className="mt-3 p-3 bg-gray-50 border border-gray-200 rounded text-sm">
            <div className="font-medium text-gray-700 mb-1">Will create:</div>
            <ul className="text-gray-600 font-mono text-xs space-y-0.5">
              <li>{config.event_slug}admin <span className="text-gray-400">— full control (stock, setup, etc.)</span></li>
              {Array.from({ length: config.num_event_baristas || 3 }, (_, i) => (
                <li key={i}>
                  {config.event_slug}{i + 1} <span className="text-gray-400">— barista (take orders only)</span>
                </li>
              ))}
            </ul>
            <div className="text-xs text-gray-500 mt-2">
              All accounts use the same password. Already-existing usernames are skipped (safe to re-run).
            </div>
          </div>
        )}
      </div>

      <div className="bg-white rounded-lg shadow-sm p-6 mb-4">
        <h3 className="font-semibold text-lg mb-3">Milks</h3>
        <div>
          {MILK_OPTIONS.map(m => (
            <Checkbox key={m}
              checked={config.milks.includes(m)}
              onChange={() => toggleArrayItem('milks', m)}
              label={m}
            />
          ))}
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm p-6 mb-4">
        <h3 className="font-semibold text-lg mb-3">Cup sizes</h3>
        <div>
          {SIZE_OPTIONS.map(s => (
            <Checkbox key={s}
              checked={config.sizes.includes(s)}
              onChange={() => toggleArrayItem('sizes', s)}
              label={s}
            />
          ))}
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm p-6 mb-4">
        <h3 className="font-semibold text-lg mb-3">Sweeteners</h3>
        <div>
          {SWEETENER_OPTIONS.map(s => (
            <Checkbox key={s}
              checked={config.sweeteners.includes(s)}
              onChange={() => toggleArrayItem('sweeteners', s)}
              label={s}
            />
          ))}
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm p-6 mb-4">
        <h3 className="font-semibold text-lg mb-1">Drink categories</h3>
        <p className="text-sm text-gray-500 mb-3">
          Espresso drinks (latte, cappuccino, flat white, etc.) are always
          enabled when coffee beans are stocked. Tick anything else you want
          on offer.
        </p>
        <div>
          {EXTRA_DRINK_OPTIONS.map(d => (
            <Checkbox key={d.key}
              checked={!!config.drinks[d.key]}
              onChange={() => toggleDrink(d.key)}
              label={d.label}
            />
          ))}
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm p-6 mb-4">
        <h3 className="font-semibold text-lg mb-1">Teas</h3>
        <p className="text-sm text-gray-500 mb-3">
          Tick each tea flavor you want on the menu. Walk-in orders for
          tea will show strength (weak / standard / strong) and a
          double-cup option (tea is hot — most baristas double-cup).
        </p>
        <div>
          {TEA_OPTIONS.map(t => (
            <Checkbox key={t.key}
              checked={!!(config.teas && config.teas[t.key])}
              onChange={() => toggleTea(t.key)}
              label={t.label}
            />
          ))}
        </div>
        <div className="mt-3">
          <label className="block text-sm text-gray-700 mb-1">
            Other tea blends (comma-separated)
          </label>
          <input
            type="text"
            value={config.custom_teas || ''}
            onChange={(e) => setCustomTeas(e.target.value)}
            placeholder="e.g. Pu'er, Oolong, House Special Blend"
            className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-amber-500"
          />
          <p className="text-xs text-gray-500 mt-1">
            Each name becomes a row in Inventory Management → Non-Coffee
            Drinks. "Tea" is appended automatically if you don't include it.
          </p>
        </div>
      </div>

      <PricingSection />

      <WalkinDefaultsSection />

      <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
        <h3 className="font-semibold text-lg mb-3">Event-wide options</h3>
        <Checkbox
          checked={config.unlimited_stock}
          onChange={() => setConfig(c => ({ ...c, unlimited_stock: !c.unlimited_stock }))}
          label="Unlimited stock — don't reject orders when amounts run low"
        />
        <br />
        <Checkbox
          checked={config.all_stations_same_capabilities}
          onChange={() => setConfig(c => ({ ...c, all_stations_same_capabilities: !c.all_stations_same_capabilities }))}
          label="All stations have the same capabilities (every milk, every drink)"
        />
        <br />
        <Checkbox
          checked={config.always_open_schedule}
          onChange={() => setConfig(c => ({ ...c, always_open_schedule: !c.always_open_schedule }))}
          label="Always open — clear any scheduled breaks; orders flow all day"
        />
        <br />
        <Checkbox
          checked={config.activate_all_stations}
          onChange={() => setConfig(c => ({ ...c, activate_all_stations: !c.activate_all_stations }))}
          label="Activate all stations — flip every station to status=active so they can take orders"
        />

        {/* VIP code — sets the magic SMS code that flags a customer
            as VIP. 'VIP' is a sensible demo default; operator can
            change to a private code for real events. Blank skips
            (preserves any existing saved code). */}
        <div className="mt-4">
          <label className="text-sm">
            <span className="block text-gray-600 mb-1">
              VIP code (SMS customers texting this become VIP)
            </span>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={config.vip_code || ''}
                onChange={(e) => setConfig(c => ({ ...c, vip_code: e.target.value }))}
                placeholder="VIP"
                className="w-48 px-2 py-1 border border-gray-300 rounded font-mono"
                maxLength={20}
              />
              <button
                type="button"
                onClick={saveVipCodeOnly}
                disabled={savingVip}
                className="px-3 py-1 rounded bg-amber-600 text-white text-sm font-semibold hover:bg-amber-700 disabled:opacity-50"
              >
                {savingVip ? 'Saving…' : 'Save VIP code'}
              </button>
            </div>
            <span className="block text-xs text-gray-500 mt-1">
              <strong>Save VIP code</strong> changes ONLY the VIP code — safe to use
              mid-event, it doesn't touch inventory, stations or anything else.
              (The big Apply at the bottom rebuilds the whole event.)
            </span>
          </label>
        </div>

        {/* "Started" SMS policy — Steve flagged that small events
            don't want to text the customer every 30 seconds when
            there's no real queue. Default 'queue_only' suppresses
            the started SMS for orders <60s old; 'always' restores
            the legacy behaviour for big events; 'never' kills it
            entirely. See _should_send_started_sms in
            routes/consolidated_api_routes.py. */}
        <div className="mt-4">
          <span className="block text-gray-600 mb-1 text-sm">
            "Started" SMS policy
          </span>
          <div className="flex flex-wrap gap-3">
            {[
              { value: 'queue_only', label: 'Queue only', sub: 'skip if started <60s after order' },
              { value: 'always',     label: 'Always',     sub: 'every order gets a "started" SMS' },
              { value: 'never',      label: 'Never',      sub: 'no "started" SMS at all' },
            ].map(opt => (
              <label
                key={opt.value}
                className={`px-3 py-2 border rounded-lg cursor-pointer text-sm ${
                  (config.started_sms_policy || 'queue_only') === opt.value
                    ? 'border-amber-500 bg-amber-50'
                    : 'border-gray-300 hover:border-gray-400'
                }`}
              >
                <input
                  type="radio"
                  name="started_sms_policy"
                  value={opt.value}
                  checked={(config.started_sms_policy || 'queue_only') === opt.value}
                  onChange={() => setConfig(c => ({ ...c, started_sms_policy: opt.value }))}
                  className="mr-2"
                />
                <span className="font-medium">{opt.label}</span>
                <span className="block text-xs text-gray-500 ml-5">{opt.sub}</span>
              </label>
            ))}
          </div>
          <span className="block text-xs text-gray-500 mt-1">
            Order confirmation and "ready for pickup" SMS always fire — this only controls the "your barista just started your X" one.
          </span>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={apply}
          disabled={applying}
          className="px-6 py-3 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-semibold disabled:opacity-50 flex items-center"
        >
          {applying
            ? (<><RefreshCw className="w-5 h-5 mr-2 animate-spin" /> Applying…</>)
            : (<><Zap className="w-5 h-5 mr-2" /> Apply Quick Setup</>)
          }
        </button>
        <button
          onClick={resetDefaults}
          disabled={applying}
          className="px-4 py-3 bg-gray-100 hover:bg-gray-200 rounded-lg text-gray-700"
        >
          Reset to café defaults
        </button>
      </div>

      {result && result.success && (
        <div className="mt-4 p-4 border-l-4 border-green-500 bg-green-50 rounded">
          <div className="flex items-start">
            <Check className="w-5 h-5 text-green-700 mr-2 mt-0.5" />
            <div>
              <p className="font-semibold text-green-800">Applied successfully</p>
              <p className="text-sm text-green-700 mt-1">{result.summary}</p>
              {/* Partial failures. The setup worked, but something in it
                  did not — say so here rather than in the console. */}
              {!!(result.warnings || []).length && (
                <ul className="mt-2 text-sm text-amber-800 list-disc list-inside">
                  {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
      {result && !result.success && (
        <div className="mt-4 p-4 border-l-4 border-red-500 bg-red-50 rounded">
          <div className="flex items-start">
            <AlertTriangle className="w-5 h-5 text-red-700 mr-2 mt-0.5" />
            <div>
              <p className="font-semibold text-red-800">Quick Setup failed</p>
              <p className="text-sm text-red-700 mt-1">{result.error || 'Unknown error'}</p>
            </div>
          </div>
        </div>
      )}

      {(previewLoading || preview || previewError) && (
        <QuickSetupPreviewModal
          loading={previewLoading}
          preview={preview}
          error={previewError}
          onConfirm={applyForReal}
          onCancel={closePreview}
        />
      )}
    </div>
  );
};

// --- Drift-preview modal ---------------------------------
// Side-by-side "current → proposed" before the apply runs. The big
// thing it answers: "will this wipe my custom stock amounts?" Yes,
// removed items list shows exactly which rows get DELETEd.
const QuickSetupPreviewModal = ({ loading, preview, error, onConfirm, onCancel }) => {
  const inv = preview?.inventory;
  const caps = preview?.capabilities;
  const settings = preview?.settings;
  const destructive = inv?.destructive;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-lg max-w-3xl w-full max-h-[85vh] overflow-y-auto shadow-xl">
        <div className="p-5 border-b sticky top-0 bg-white">
          <h3 className="text-lg font-semibold">Review changes before applying</h3>
          <p className="text-sm text-gray-600 mt-1">
            Nothing has been written yet. This is what an Apply would do.
          </p>
        </div>
        <div className="p-5 space-y-4">
          {loading && (
            <div className="flex items-center text-gray-600">
              <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Computing diff…
            </div>
          )}
          {error && (
            <div className="p-3 border-l-4 border-red-500 bg-red-50 text-sm text-red-800">
              {error}
            </div>
          )}

          {inv && (
            <div>
              <h4 className="font-semibold text-sm mb-2 flex items-center">
                Inventory items
                {destructive && (
                  <span className="ml-2 text-xs px-2 py-0.5 bg-amber-100 text-amber-800 rounded">
                    destructive — rebuilds the inventory_items table
                  </span>
                )}
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div>
                  <div className="font-medium text-green-700 mb-1">
                    Adding ({inv.added.length})
                  </div>
                  <div className="border rounded bg-green-50 p-2 max-h-48 overflow-y-auto">
                    {inv.added.length === 0
                      ? <span className="text-gray-400">none</span>
                      : inv.added.map((r, i) => (
                          <div key={i}>{r.category}: {r.name}</div>
                        ))}
                  </div>
                </div>
                <div>
                  <div className="font-medium text-red-700 mb-1">
                    Removing ({inv.removed.length})
                  </div>
                  <div className="border rounded bg-red-50 p-2 max-h-48 overflow-y-auto">
                    {inv.removed.length === 0
                      ? <span className="text-gray-400">none</span>
                      : inv.removed.map((r, i) => (
                          <div key={i}>
                            {r.category}: {r.name}
                            {r.amount != null && (
                              <span className="text-gray-500"> ({r.amount}{r.unit ? ' ' + r.unit : ''})</span>
                            )}
                          </div>
                        ))}
                  </div>
                </div>
                <div>
                  <div className="font-medium text-gray-700 mb-1">
                    Unchanged ({inv.unchanged.length})
                  </div>
                  <div className="border rounded bg-gray-50 p-2 max-h-48 overflow-y-auto">
                    {inv.unchanged.length === 0
                      ? <span className="text-gray-400">none</span>
                      : inv.unchanged.map((r, i) => (
                          <div key={i}>{r.category}: {r.name}</div>
                        ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {caps && caps.will_overwrite_all && caps.stations?.length > 0 && (
            <div>
              <h4 className="font-semibold text-sm mb-2">
                Station capabilities — {caps.stations.length} station(s) will be overwritten
              </h4>
              <div className="text-xs text-gray-600 border rounded p-2 bg-amber-50">
                All stations will be given identical capabilities (same milks,
                espresso drinks, sizes). Per-station capability tweaks will be lost.
              </div>
            </div>
          )}

          {settings && (
            <div>
              <h4 className="font-semibold text-sm mb-2">Other settings</h4>
              <ul className="text-sm space-y-1">
                {settings.vip_code?.changed && (
                  <li>
                    <span className="text-gray-600">VIP code:</span>{' '}
                    <span className="line-through text-red-700">
                      {settings.vip_code.current || '(unset)'}
                    </span>{' '}→{' '}
                    <span className="text-green-700">{settings.vip_code.proposed}</span>
                  </li>
                )}
                {settings.unlimited_stock?.changed && (
                  <li>
                    <span className="text-gray-600">Unlimited stock:</span>{' '}
                    {settings.unlimited_stock.current ? 'ON' : 'OFF'} →{' '}
                    <strong>{settings.unlimited_stock.proposed ? 'ON' : 'OFF'}</strong>
                  </li>
                )}
                {settings.activate_all_stations?.will_activate > 0 && (
                  <li>
                    <span className="text-gray-600">Stations to activate:</span>{' '}
                    <strong>{settings.activate_all_stations.will_activate}</strong>
                  </li>
                )}
                {settings.always_open_schedule?.breaks_to_delete > 0 && (
                  <li>
                    <span className="text-gray-600">Scheduled breaks to delete:</span>{' '}
                    <strong>{settings.always_open_schedule.breaks_to_delete}</strong>
                  </li>
                )}
              </ul>
            </div>
          )}
        </div>
        <div className="p-4 border-t bg-gray-50 flex items-center justify-end gap-2 sticky bottom-0">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded bg-white border border-gray-300 hover:bg-gray-100 text-gray-700"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading || !!error}
            className={`px-5 py-2 rounded text-white font-semibold disabled:opacity-50 ${
              destructive
                ? 'bg-amber-600 hover:bg-amber-700'
                : 'bg-green-600 hover:bg-green-700'
            }`}
          >
            {destructive ? 'Apply (destructive)' : 'Apply changes'}
          </button>
        </div>
      </div>
    </div>
  );
};

// --- Event templates ------------------------------------
// Load a saved Quick Setup preset to populate the form, or save the
// current form state for re-use at the next event. Per-event
// identity fields (event_name, event_slug, event_password,
// num_event_baristas) are stripped before save by the backend —
// templates apply across venues without carrying the previous
// event's name or credentials.
const EventTemplatesSection = ({ config, setConfig }) => {
  const [templates, setTemplates] = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  const [selected, setSelected] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [status, setStatus] = React.useState(null);

  const loadList = React.useCallback(async () => {
    setLoading(true);
    try {
      const resp = await api.request('/event-templates', { method: 'GET' });
      setTemplates(Array.isArray(resp?.templates) ? resp.templates : []);
    } catch (e) {
      // Endpoint missing (not yet deployed) — silent, the dropdown
      // just stays empty. Mirrors the pattern used elsewhere.
      console.warn('EventTemplatesSection: loadList failed', e);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { loadList(); }, [loadList]);

  const handleLoad = async () => {
    if (!selected) return;
    setStatus(null);
    try {
      const resp = await api.request(`/event-templates/${selected}`, { method: 'GET' });
      if (resp?.template?.payload) {
        // Merge over current config so unrelated fields (event_name etc)
        // aren't wiped. The backend strips per-event identity before
        // saving, so payload won't carry stale credentials.
        setConfig(prev => ({ ...prev, ...resp.template.payload }));
        setStatus({ ok: true, msg: `Loaded "${resp.template.name}" — review and click Apply.` });
      } else {
        setStatus({ ok: false, msg: 'Template payload was empty.' });
      }
    } catch (e) {
      setStatus({ ok: false, msg: e?.message || 'Load failed' });
    }
  };

  const handleSave = async () => {
    const name = window.prompt(
      'Save current Quick Setup config as a template.\n\n' +
      'Name (e.g. "Hills Baptist standard", "Café cart default"):'
    );
    if (!name || !name.trim()) return;
    setSaving(true);
    setStatus(null);
    try {
      // The whole `config` object IS the payload — the backend strips
      // per-event identity fields itself, so we don't need to filter here.
      const resp = await api.request('/event-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), payload: config }),
      });
      if (resp?.success) {
        setStatus({ ok: true, msg: `Saved as "${name.trim()}".` });
        await loadList();
        setSelected(String(resp.id || ''));
      } else {
        setStatus({ ok: false, msg: resp?.error || 'Save failed' });
      }
    } catch (e) {
      setStatus({ ok: false, msg: e?.message || 'Save failed' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-sm p-6 mb-4">
      <h3 className="font-semibold text-lg mb-1">Templates</h3>
      <p className="text-sm text-gray-500 mb-3">
        Save the current selections as a reusable template, or load one
        you saved earlier. Templates omit per-event details (name,
        accounts) so they apply cleanly to new events.
      </p>
      <div className="flex flex-wrap gap-2 items-center">
        <select
          value={selected}
          onChange={e => setSelected(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded min-w-[220px]"
        >
          <option value="">
            {loading ? 'Loading…' : (templates.length ? '— choose a template —' : '— no templates yet —')}
          </option>
          {templates.map(t => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={handleLoad}
          disabled={!selected}
          className="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded text-sm disabled:opacity-50"
        >
          Load into form
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="px-3 py-2 bg-amber-100 hover:bg-amber-200 text-amber-900 rounded text-sm disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save current as template'}
        </button>
      </div>
      {status && (
        <div className={`text-sm mt-3 ${status.ok ? 'text-green-700' : 'text-red-700'}`}>
          {status.ok ? '✓ ' : '✗ '}{status.msg}
        </div>
      )}
    </div>
  );
};


// --- Pricing (honor-system) ------------------------------------
// Talks directly to /api/pricing-settings rather than going through
// the Quick Setup apply payload. Operator can enable/disable and
// edit per-drink prices independently of the rest of Quick Setup.
const PricingSection = () => {
  const [loaded, setLoaded] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [savedMsg, setSavedMsg] = React.useState('');
  const [pricing, setPricing] = React.useState({
    enabled: false,
    currency: 'AUD',
    symbol: '$',
    per_drink: {},
    unknown_drink_price: 4.50,
    milk_surcharge: {},
    size_surcharge: { small: -0.50, medium: 0.00, large: 0.50 },
    sugar_surcharge_per_sachet: 0,
    vip_free: false,
    show_in_sms: true,
    show_in_barista: true,
    show_on_display: false,
  });

  React.useEffect(() => {
    let cancelled = false;
    api.request('/pricing-settings', { method: 'GET' })
       .then(resp => { if (!cancelled && resp) { setPricing(p => ({ ...p, ...resp })); setLoaded(true); } })
       .catch(() => setLoaded(true));
    return () => { cancelled = true; };
  }, []);

  const save = async () => {
    setSaving(true); setSavedMsg('');
    try {
      await api.request('/pricing-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pricing),
      });
      setSavedMsg('Saved');
      setTimeout(() => setSavedMsg(''), 2500);
    } catch (e) {
      setSavedMsg('Save failed: ' + (e.message || 'unknown'));
    } finally {
      setSaving(false);
    }
  };

  const numericInput = (val, setter) => (
    <input
      type="number"
      step="0.10"
      value={val ?? 0}
      onChange={(e) => setter(parseFloat(e.target.value) || 0)}
      className="w-24 px-2 py-1 border border-gray-300 rounded text-right"
    />
  );

  // Flat-fee state derived from the saved shape:
  //   flat_price_by_size = {small: 2, medium: 2.5}  → per-size mode
  //   flat_price = 2                                → one-price mode
  //   neither                                       → itemised (flat off)
  const flatBySize = pricing.flat_price_by_size || {};
  const perSizeMode = Object.keys(flatBySize).length > 0;
  const flatOn = perSizeMode || (pricing.flat_price != null && pricing.flat_price !== '');
  const setFlatMode = (mode) => setPricing(p => {
    if (mode === 'off') return { ...p, flat_price: null, flat_price_by_size: null };
    if (mode === 'single') return { ...p, flat_price: (p.flat_price ?? 2.00), flat_price_by_size: null };
    // per-size: seed a sensible table the operator can edit/blank
    const existing = p.flat_price_by_size && Object.keys(p.flat_price_by_size).length
      ? p.flat_price_by_size : { small: 2.00, medium: 2.50 };
    return { ...p, flat_price: null, flat_price_by_size: existing };
  });

  return (
    <div className="bg-white rounded-lg shadow-sm p-6 mb-4">
      <h3 className="font-semibold text-lg mb-1">Pricing (honor system)</h3>
      <p className="text-sm text-gray-500 mb-3">
        When enabled, the SMS confirmation tells the customer the total
        and asks them to pay at the counter at collection time. No card
        processing — just embeds the price in the conversation.
      </p>

      <label className="inline-flex items-center mb-4 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={!!pricing.enabled}
          onChange={(e) => setPricing(p => ({ ...p, enabled: e.target.checked }))}
          className="mr-2 h-4 w-4 accent-amber-600"
        />
        <span className="font-medium">Enable pricing</span>
      </label>

      {pricing.enabled && (
        <>
          {/* Flat-fee mode — fixed price regardless of drink and milk
              (alt milk is free). Either one price for everything, or a
              price per cup size (small $2 / medium $2.50). The common
              event case; edit + Save any time. When on, per-drink prices
              and surcharges below are ignored. */}
          <div className="bg-amber-50 border border-amber-200 rounded p-3 mb-4">
            <label className="flex items-center cursor-pointer select-none mb-2">
              <input
                type="checkbox"
                checked={flatOn}
                onChange={(e) => setFlatMode(e.target.checked ? 'single' : 'off')}
                className="mr-2 h-4 w-4 accent-amber-600"
              />
              <span className="font-medium">Flat fee — same price regardless of drink / milk</span>
            </label>

            {flatOn && (
              <div className="ml-6 space-y-2">
                <div className="flex gap-4 text-sm">
                  <label className="flex items-center cursor-pointer">
                    <input type="radio" name="flatmode" className="mr-1 accent-amber-600"
                      checked={!perSizeMode} onChange={() => setFlatMode('single')} />
                    One price for everything
                  </label>
                  <label className="flex items-center cursor-pointer">
                    <input type="radio" name="flatmode" className="mr-1 accent-amber-600"
                      checked={perSizeMode} onChange={() => setFlatMode('persize')} />
                    Price per cup size
                  </label>
                </div>

                {!perSizeMode && (
                  <div className="flex items-center gap-1">
                    <span className="text-gray-600">{pricing.symbol || '$'}</span>
                    {numericInput(pricing.flat_price,
                      v => setPricing(p => ({ ...p, flat_price: v })))}
                    <span className="text-sm text-gray-600 ml-1">— every drink, any size</span>
                  </div>
                )}

                {perSizeMode && (
                  <div className="flex flex-wrap gap-4">
                    {['small', 'medium', 'large'].map(sz => (
                      <label key={sz} className="flex items-center gap-1 text-sm">
                        <span className="capitalize w-16">{sz}</span>
                        <span className="text-gray-600">{pricing.symbol || '$'}</span>
                        {numericInput(flatBySize[sz],
                          v => setPricing(p => ({
                            ...p,
                            flat_price_by_size: { ...(p.flat_price_by_size || {}), [sz]: v },
                          })))}
                      </label>
                    ))}
                    <p className="w-full text-xs text-amber-700">
                      Set a price for the sizes you offer; leave others as-is. Alt milks are free in flat-fee mode.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <label className="text-sm">
              <span className="block text-gray-600">Currency symbol</span>
              <input
                type="text" maxLength={3}
                value={pricing.symbol || '$'}
                onChange={(e) => setPricing(p => ({ ...p, symbol: e.target.value }))}
                className="w-full px-2 py-1 border border-gray-300 rounded"
              />
            </label>
            <label className="text-sm">
              <span className="block text-gray-600">Unknown drink fallback</span>
              {numericInput(pricing.unknown_drink_price,
                v => setPricing(p => ({ ...p, unknown_drink_price: v })))}
            </label>
            <label className="text-sm">
              <span className="block text-gray-600">Sugar per sachet</span>
              {numericInput(pricing.sugar_surcharge_per_sachet,
                v => setPricing(p => ({ ...p, sugar_surcharge_per_sachet: v })))}
            </label>
          </div>

          <h4 className="font-semibold mt-2 mb-2">Per-drink price</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-4">
            {Object.entries(pricing.per_drink || {}).sort().map(([drink, price]) => (
              <div key={drink} className="flex items-center gap-2 justify-between">
                <span className="text-sm capitalize">{drink}</span>
                {numericInput(price, v => setPricing(p => ({
                  ...p, per_drink: { ...p.per_drink, [drink]: v }
                })))}
              </div>
            ))}
          </div>

          <h4 className="font-semibold mt-2 mb-2">Alt milk surcharge</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-4">
            {Object.entries(pricing.milk_surcharge || {}).sort().map(([milk, price]) => (
              <div key={milk} className="flex items-center gap-2 justify-between">
                <span className="text-sm capitalize">{milk}</span>
                {numericInput(price, v => setPricing(p => ({
                  ...p, milk_surcharge: { ...p.milk_surcharge, [milk]: v }
                })))}
              </div>
            ))}
          </div>

          <h4 className="font-semibold mt-2 mb-2">Size surcharge</h4>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-4">
            {Object.entries(pricing.size_surcharge || {}).map(([size, price]) => (
              <div key={size} className="flex items-center gap-2 justify-between">
                <span className="text-sm capitalize">{size}</span>
                {numericInput(price, v => setPricing(p => ({
                  ...p, size_surcharge: { ...p.size_surcharge, [size]: v }
                })))}
              </div>
            ))}
          </div>

          <div className="space-y-1 text-sm mb-4">
            <label className="flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={!!pricing.show_in_sms}
                onChange={(e) => setPricing(p => ({ ...p, show_in_sms: e.target.checked }))}
                className="mr-2"
              />
              Include total in SMS confirmation
            </label>
            <label className="flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={!!pricing.show_in_barista}
                onChange={(e) => setPricing(p => ({ ...p, show_in_barista: e.target.checked }))}
                className="mr-2"
              />
              Show price tag on Barista order cards
            </label>
            {/* VIP comp — sponsors / staff / press tagged as VIP via
                the SMS VIP code get a free drink. Their order card
                shows "VIP — no charge" and their SMS says the drink
                is complimentary instead of asking them to pay. To
                give staff the same treatment, set them up with the
                VIP code (Organiser → Settings) and have them text it
                in — no separate "staff_free" flag needed. */}
            <label className="flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={!!pricing.vip_free}
                onChange={(e) => setPricing(p => ({ ...p, vip_free: e.target.checked }))}
                className="mr-2"
              />
              <span>
                VIP orders are free
                <span className="block text-xs text-gray-500 ml-0">
                  Staff get this too — give them the VIP code.
                </span>
              </span>
            </label>
          </div>
        </>
      )}

      <button
        onClick={save}
        disabled={saving || !loaded}
        className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Save pricing'}
      </button>
      {savedMsg && <span className="ml-3 text-sm text-green-700">{savedMsg}</span>}
    </div>
  );
};


// --- Walk-in defaults --------------------------------------------------
// The walk-in dialog used to hardcode 'Flat White', 'Small (8oz)', and
// a milk-priority order ('whole milk' > 'full cream' > ...). Different
// markets prefer different defaults — Australian events want 'full
// cream' first, US events 'whole milk', oat-heavy crowds 'oat'. This
// section moves those choices out of the JS into a setting per event.
//
// Backend: /api/walkin-defaults (GET/PUT). Default blob is in
// consolidated_api_routes.py DEFAULT_WALKIN_DEFAULTS.
const WalkinDefaultsSection = () => {
  const [loaded, setLoaded] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [savedMsg, setSavedMsg] = React.useState('');
  const [defaults, setDefaults] = React.useState({
    default_coffee_type: 'Flat White',
    default_size: 'Small (8oz)',
    default_shots: '1',
    default_milk_preference_order: [],
    default_sweetener_qty: 0,
  });

  React.useEffect(() => {
    let cancelled = false;
    api.request('/walkin-defaults', { method: 'GET' })
       .then(resp => { if (!cancelled && resp) { setDefaults(d => ({ ...d, ...resp })); setLoaded(true); } })
       .catch(() => setLoaded(true));
    return () => { cancelled = true; };
  }, []);

  const save = async () => {
    setSaving(true); setSavedMsg('');
    try {
      await api.request('/walkin-defaults', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(defaults),
      });
      setSavedMsg('Saved');
      setTimeout(() => setSavedMsg(''), 2500);
    } catch (e) {
      setSavedMsg('Save failed: ' + (e.message || 'unknown'));
    } finally {
      setSaving(false);
    }
  };

  // Milk preference: edited as a single comma-separated string for
  // simplicity. Spaces in milk names ('full cream') are preserved.
  // Order matters — first match wins when the dialog picks a default.
  const milkPrefAsString = (defaults.default_milk_preference_order || []).join(', ');
  const setMilkPrefFromString = (s) => {
    const list = s.split(',').map(x => x.trim()).filter(Boolean);
    setDefaults(d => ({ ...d, default_milk_preference_order: list }));
  };

  return (
    <div className="bg-white rounded-lg shadow-sm p-6 mb-4">
      <h3 className="font-semibold text-lg mb-1">Walk-in defaults</h3>
      <p className="text-sm text-gray-500 mb-3">
        What the walk-in dialog pre-fills before the operator confirms
        and submits. Set these to your most common values to cut clicks.
      </p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <label className="text-sm">
          <span className="block text-gray-600">Default drink</span>
          {/* Drinks are loaded from /api/catalog/drink — the single
              source of truth that capability editor, walk-in dialog
              etc. also read. To add a new drink, POST to the catalog
              once and it shows up everywhere. No hardcoded list. */}
          <CatalogDrinkSelect
            value={defaults.default_coffee_type}
            onChange={(v) => setDefaults(d => ({ ...d, default_coffee_type: v }))}
          />
        </label>
        <label className="text-sm">
          <span className="block text-gray-600">Default size</span>
          <CatalogSimpleSelect
            category="size"
            value={defaults.default_size}
            onChange={(v) => setDefaults(d => ({ ...d, default_size: v }))}
            fallback="Small (8oz)"
          />
        </label>
        <label className="text-sm">
          <span className="block text-gray-600">Default shots</span>
          <select
            value={defaults.default_shots || '1'}
            onChange={(e) => setDefaults(d => ({ ...d, default_shots: e.target.value }))}
            className="w-full px-2 py-1 border border-gray-300 rounded"
          >
            <option value="0.5">1/2 shot</option>
            <option value="1">1 (single)</option>
            <option value="2">2 (double)</option>
            <option value="3">3 (triple)</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="block text-gray-600">Default sugar qty</span>
          <input
            type="number"
            min="0"
            max="6"
            value={defaults.default_sweetener_qty ?? 0}
            onChange={(e) => setDefaults(d => ({ ...d, default_sweetener_qty: parseInt(e.target.value) || 0 }))}
            className="w-full px-2 py-1 border border-gray-300 rounded"
          />
        </label>
      </div>

      <div className="mb-4">
        <label className="text-sm">
          <span className="block text-gray-600">Milk preference order</span>
          <input
            type="text"
            value={milkPrefAsString}
            onChange={(e) => setMilkPrefFromString(e.target.value)}
            placeholder="full cream, whole milk, dairy, skim, oat"
            className="w-full px-2 py-1 border border-gray-300 rounded"
          />
          <span className="block text-xs text-gray-500 mt-1">
            Comma-separated, in order of preference. The dialog picks the
            first one stocked at the station. Anything not in this list
            is only chosen if nothing in the list is available.
          </span>
        </label>
      </div>

      <button
        onClick={save}
        disabled={saving || !loaded}
        className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Save walk-in defaults'}
      </button>
      {savedMsg && <span className="ml-3 text-sm text-green-700">{savedMsg}</span>}
    </div>
  );
};

// --- Catalog-backed select primitives -----------------------------
// Tiny wrappers around useCatalog so dropdowns read from the
// canonical option lists rather than embedded hardcoded arrays.
// See useCatalog.js and migrations.py _m009_catalog_items.

const CatalogSimpleSelect = ({ category, value, onChange, fallback }) => {
  const { items, loading, error } = useCatalog(category);

  if (loading && items.length === 0) {
    return (
      <select disabled className="w-full px-2 py-1 border border-gray-300 rounded bg-gray-50">
        <option>Loading…</option>
      </select>
    );
  }

  // If the catalog failed entirely, fall back to a degenerate select
  // showing the current value so the operator can still save.
  if (error && items.length === 0) {
    return (
      <input
        type="text"
        value={value || fallback || ''}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-2 py-1 border border-amber-300 rounded"
        title={`Catalog unavailable (${error}) — typing freely`}
      />
    );
  }

  const currentMatches = items.some(i => i.name === value);
  const displayValue = currentMatches ? value : (items[0]?.name || fallback || '');

  return (
    <select
      value={displayValue}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-2 py-1 border border-gray-300 rounded"
    >
      {items.map(i => (
        <option key={i.id} value={i.name}>{i.name}</option>
      ))}
    </select>
  );
};

// Drinks pick: grouped by subcategory (espresso / tea / other).
const CatalogDrinkSelect = ({ value, onChange }) => {
  const { items, loading, error } = useCatalog('drink');

  if (loading && items.length === 0) {
    return (
      <select disabled className="w-full px-2 py-1 border border-gray-300 rounded bg-gray-50">
        <option>Loading…</option>
      </select>
    );
  }

  if (error && items.length === 0) {
    return (
      <input
        type="text"
        value={value || 'Flat White'}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-2 py-1 border border-amber-300 rounded"
        title={`Catalog unavailable (${error}) — typing freely`}
      />
    );
  }

  // Group by subcategory for the optgroup labels.
  const groups = items.reduce((acc, item) => {
    const sub = item.subcategory || 'other';
    if (!acc[sub]) acc[sub] = [];
    acc[sub].push(item);
    return acc;
  }, {});
  const groupOrder = ['espresso', 'other', 'tea'];
  const subLabels = {
    espresso: 'Espresso drinks',
    other: 'Non-coffee',
    tea: 'Teas',
  };

  const currentMatches = items.some(i => i.name === value);
  const displayValue = currentMatches ? value : (items[0]?.name || 'Flat White');

  return (
    <select
      value={displayValue}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-2 py-1 border border-gray-300 rounded"
    >
      {groupOrder.filter(g => groups[g]?.length).map(sub => (
        <optgroup key={sub} label={subLabels[sub] || sub}>
          {groups[sub].map(item => (
            <option key={item.id} value={item.name}>{item.name}</option>
          ))}
        </optgroup>
      ))}
    </select>
  );
};

export default QuickSetup;
