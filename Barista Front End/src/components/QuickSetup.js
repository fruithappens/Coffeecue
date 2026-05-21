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
import ApiServiceClass from '../services/ApiService';
import EventInventoryService from '../services/EventInventoryService';

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
};

const QuickSetup = () => {
  const [config, setConfig] = useState(DEFAULT_STATE);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState(null);

  // Fetch the server's suggested defaults on mount so the UI stays
  // in sync if we change them later in the backend.
  useEffect(() => {
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

  const rebuildPerStationStock = (stations, enabledByCategory) => {
    if (!Array.isArray(stations) || stations.length === 0) return;
    const unlimited = !!config.unlimited_stock;

    stations.forEach(station => {
      const stationId = station.id;
      const stockData = {
        milk: [], coffee: [], cups: [], sweeteners: [], drinks: [], other: [],
        lastUpdated: new Date().toISOString(),
      };
      // Milks
      enabledByCategory.milk.forEach(name => {
        const id = name.toLowerCase().replace(/\s+/g, '_');
        stockData.milk.push(buildStockItem(id, name, 'milk', unlimited));
      });
      // Coffee beans — Quick Setup always seeds house blend + decaf
      // on the backend; mirror those here so coffee-based drinks
      // light up in the walk-in dialog.
      [['house_blend', 'House Blend Beans'], ['decaf', 'Decaf Beans']]
        .forEach(([id, name]) => {
          stockData.coffee.push(buildStockItem(id, name, 'coffee', unlimited));
        });
      // Cups
      enabledByCategory.cups.forEach(name => {
        const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
        stockData.cups.push(buildStockItem(id, name, 'cups', unlimited));
      });
      // Sweeteners
      enabledByCategory.sweeteners.forEach(name => {
        const id = name.toLowerCase().replace(/\s+/g, '_');
        stockData.sweeteners.push(buildStockItem(id, name, 'sweeteners', unlimited));
      });
      // Non-coffee drinks (chai, hot chocolate, matcha, tea)
      enabledByCategory.drinks.forEach(name => {
        const id = name.toLowerCase().replace(/\s+/g, '_');
        stockData.drinks.push(buildStockItem(id, name, 'drinks', unlimited));
      });

      const stockKey = `coffee_stock_station_${stationId}`;
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
  // WalkInOrderDialog. When all_stations_same is on every station
  // gets every enabled item; when off we preserve existing
  // per-station configs (the operator wants fine-grained control).
  const rebuildStationConfigs = (stations, eventInventory) => {
    if (!Array.isArray(stations) || stations.length === 0) return;
    const allSame = !!config.all_stations_same_capabilities;
    if (!allSame) return;  // preserve existing per-station configs

    const cfg = {};
    stations.forEach(station => {
      const stationCfg = {};
      Object.entries(eventInventory).forEach(([cat, items]) => {
        if (!Array.isArray(items)) return;
        stationCfg[cat] = {};
        items.forEach(item => {
          // Every enabled item is on for every station.
          stationCfg[cat][item.id] = !!item.enabled;
        });
      });
      cfg[station.id] = stationCfg;
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

    // On a fresh install the operator has never opened the Inventory
    // Management panel — so localStorage.event_inventory is empty,
    // `existing` is {}, and the loop below produces an empty `updated`.
    // Quick Setup then writes that empty blob to the backend, and
    // when InventoryManagement opens it sees nothing and falls back
    // to the FULL default list with everything enabled — which is
    // exactly what the operator just opted OUT of.
    //
    // Fix: seed `existing` with the same defaults InventoryManagement
    // would use so the loop has something to iterate over. The seed
    // is only used to populate empty categories; categories the
    // operator has already customised pass through unchanged.
    const DEFAULT_SEED = {
      milk: [
        { name: 'Whole Milk',     description: 'Regular dairy milk' },
        { name: 'Skim Milk',      description: 'Low-fat dairy milk' },
        { name: 'Oat Milk',       description: 'Plant-based oat milk' },
        { name: 'Almond Milk',    description: 'Plant-based almond milk' },
        { name: 'Soy Milk',       description: 'Plant-based soy milk' },
        { name: 'Coconut Milk',   description: 'Plant-based coconut milk' },
        { name: 'Macadamia Milk', description: 'Plant-based macadamia milk' },
        { name: 'Rice Milk',      description: 'Plant-based rice milk' },
      ],
      coffee: [
        { name: 'Espresso',    description: 'Strong coffee shot' },
        { name: 'Americano',   description: 'Espresso with hot water' },
        { name: 'Latte',       description: 'Espresso with steamed milk' },
        { name: 'Cappuccino',  description: 'Espresso with foam' },
        { name: 'Flat White',  description: 'Double shot with microfoam' },
        { name: 'Mocha',       description: 'Chocolate coffee drink' },
        { name: 'Macchiato',   description: 'Espresso with milk foam' },
        { name: 'Cortado',     description: 'Equal parts espresso and warm milk' },
        { name: 'Filter Coffee', description: 'Drip brewed coffee' },
        { name: 'Cold Brew',   description: 'Cold steeped coffee' },
      ],
      cups: [
        { name: 'Small',  description: 'Small cup' },
        { name: 'Medium', description: 'Medium cup' },
        { name: 'Large',  description: 'Large cup' },
      ],
      sweeteners: [
        { name: 'White Sugar', description: 'Regular granulated sugar' },
        { name: 'Brown Sugar', description: 'Raw cane sugar' },
        { name: 'Honey',       description: 'Natural honey sweetener' },
        { name: 'Stevia',      description: 'Natural leaf sweetener' },
      ],
      drinks: [
        { name: 'Hot Chocolate', description: 'Rich chocolate drink' },
        { name: 'Chai Latte',    description: 'Spiced tea with milk' },
        { name: 'Matcha Latte',  description: 'Green tea latte' },
        { name: 'Hot Tea',                description: 'Generic hot tea',          isTea: true },
        { name: 'English Breakfast Tea',  description: 'Classic black tea blend',  isTea: true },
        { name: 'Earl Grey Tea',          description: 'Black tea with bergamot',  isTea: true },
        { name: 'Green Tea',              description: 'Light green tea',          isTea: true },
        { name: 'Peppermint Tea',         description: 'Caffeine-free mint',       isTea: true },
        { name: 'Chamomile Tea',          description: 'Caffeine-free floral',     isTea: true },
        { name: 'Lemon & Ginger Tea',     description: 'Zesty herbal infusion',    isTea: true },
        { name: 'Rooibos Tea',            description: 'South African red tea',    isTea: true },
      ],
      syrups: [],
      extras: [],
    };
    Object.keys(DEFAULT_SEED).forEach((catKey) => {
      if (!Array.isArray(existing[catKey]) || existing[catKey].length === 0) {
        // Seed only EMPTY categories. If the operator has already
        // built out e.g. Syrups by hand, leave their list alone.
        existing[catKey] = DEFAULT_SEED[catKey].map((item, i) => ({
          id: `qs-seed-${catKey}-${i}-${Date.now()}`,
          ...item,
          enabled: true,  // will be re-toggled by the loop below
        }));
      }
    });

    const updated = {};
    Object.entries(existing).forEach(([catKey, items]) => {
      const allowed = categoryFilter[catKey];
      if (!Array.isArray(items)) {
        updated[catKey] = items;
        return;
      }
      updated[catKey] = items.map(item => {
        // Don't delete items — toggle `enabled`. Keeps them
        // discoverable in the inventory panel for re-enable later.
        const shouldBeOn = allowed ? allowed.has(item.name) : false;
        return { ...item, enabled: shouldBeOn };
      });
    });

    // Lactose-Free is not in InventoryManagement.js defaults but the
    // Quick Setup defaults include it — add it if missing so it
    // surfaces in the panel.
    if (config.milks.includes('lactose free') && updated.milk) {
      const has = updated.milk.some(m => /lactose/i.test(m.name));
      if (!has) {
        updated.milk.push({
          id: `qs-lactose-${Date.now()}`,
          name: 'Lactose-Free Milk',
          description: 'Added by Quick Setup',
          enabled: true,
        });
      }
    }

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
    // Reconcile Menu Management's separate `event_menu` localStorage
    // against what the operator just selected. Without this, the
    // "Menu Items" sub-tab keeps showing the default (with iced
    // drinks, etc) regardless of Quick Setup — see the operator's
    // bug report: "Menu items also have iced coffee etc ticked even
    // after quick setup complete".
    rebuildEventMenu(config);
  };

  // Quick Setup's drink toggles ↔ MenuManagement.js menu-item ids.
  // The menu uses dashed-kebab ids (cold-brew, flat-white). When a
  // Quick Setup category is enabled, every drink id in its list flips
  // to enabled: true. Anything NOT listed under any enabled category
  // is set to enabled: false. Conservative — when in doubt, off, so
  // operators see exactly what they selected.
  const MENU_IDS_BY_CATEGORY = {
    // espresso_drinks covers the hot espresso-based family
    espresso_drinks: [
      'espresso', 'long-black', 'cappuccino', 'latte', 'flat-white',
      'macchiato', 'piccolo', 'cortado', 'mocha', 'affogato',
      'filter-coffee',
    ],
    hot_chocolate: ['hot-chocolate', 'babycino'],
    chai: ['chai-latte'],
    matcha: ['matcha-latte', 'turmeric-latte'],
    // No Quick Setup toggle for cold/iced drinks yet — they stay
    // disabled until the operator turns them on manually in the
    // Menu Items panel. This is intentional: iced drinks default
    // ON in defaultCoffeeMenu, which was the bug report's complaint.
  };

  const rebuildEventMenu = (cfg) => {
    try {
      // Decide which menu ids should be enabled, then load and patch
      // existing event_menu so per-drink station-availability and
      // custom additions aren't blown away.
      const enabledIds = new Set();
      Object.entries(MENU_IDS_BY_CATEGORY).forEach(([category, ids]) => {
        if (cfg.drinks && cfg.drinks[category]) {
          ids.forEach(id => enabledIds.add(id));
        }
      });

      let menu = {};
      try {
        menu = JSON.parse(localStorage.getItem('event_menu') || '{}');
      } catch (_) {
        menu = {};
      }
      if (!menu || typeof menu !== 'object' || Object.keys(menu).length === 0) {
        // No saved menu — MenuManagement will hydrate from defaults
        // on next render. Nothing to reconcile here.
        return;
      }

      let touched = false;
      Object.keys(menu).forEach(drinkId => {
        const drink = menu[drinkId];
        if (!drink || typeof drink !== 'object') return;
        // Only touch drinks Quick Setup knows about. Custom drinks
        // the operator added are left alone.
        const isKnown = Object.values(MENU_IDS_BY_CATEGORY)
          .some(ids => ids.includes(drinkId));
        if (!isKnown && !drinkId.startsWith('iced-') && drinkId !== 'cold-brew') {
          return;
        }
        // Iced/cold drinks → force off (Quick Setup doesn't surface
        // them, so they shouldn't silently stay on after a reset).
        const isIced = drinkId.startsWith('iced-') || drinkId === 'cold-brew';
        const target = !isIced && enabledIds.has(drinkId);
        if (drink.enabled !== target) {
          menu[drinkId] = { ...drink, enabled: target };
          touched = true;
        }
      });
      if (touched) {
        localStorage.setItem('event_menu', JSON.stringify(menu));
        // Tell MenuManagement to re-read (if mounted).
        window.dispatchEvent(new CustomEvent('event_menu_updated', { detail: menu }));
      }
    } catch (err) {
      console.warn('Could not reconcile event_menu from Quick Setup:', err);
    }
  };

  const apply = async () => {
    if (!window.confirm(
      'Apply Quick Setup?\n\nThis REPLACES the current inventory items with the ' +
      'defaults selected here AND disables anything you haven\'t ticked in the ' +
      'Inventory Management panel. Existing orders / customers / stations are kept. ' +
      'Continue?'
    )) return;
    setApplying(true);
    setResult(null);
    try {
      const resp = await api.request('/quick-setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preset: config }),
      });
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
      setResult({
        success: !!resp.success,
        summary: resp.summary || (resp.applied || []).join('; '),
        applied: resp.applied || [],
        error: resp.error,
      });
    } catch (err) {
      setResult({ success: false, error: err.message });
    } finally {
      setApplying(false);
    }
  };

  const resetDefaults = () => setConfig(DEFAULT_STATE);

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
    <div className="p-6 max-w-4xl">
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6 flex items-start">
        <Zap className="w-6 h-6 text-amber-600 mr-3 mt-0.5 flex-shrink-0" />
        <div>
          <h2 className="text-xl font-bold text-amber-800">Quick Setup</h2>
          <p className="text-amber-700 text-sm mt-1">
            One click. Replaces your inventory with the selections below, copies
            station capabilities, and (optionally) puts the schedule in
            always-open mode. Use this for a fresh event setup; if you've
            already configured things by hand, prefer the individual settings
            panels.
          </p>
        </div>
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
          <div className="grid grid-cols-3 gap-2 mb-4">
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

export default QuickSetup;
