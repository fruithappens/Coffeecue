// components/dialogs/WalkInOrderDialog.js
import React, { useState, useEffect } from 'react';
import { XCircle, Search, Coffee, Users, Star, AlertTriangle } from 'lucide-react';
// DEFAULT_MILK_TYPES is the legacy hardcoded list; useCatalog('milk')
// is the canonical source. The legacy import is kept as a fallback
// for the brief moment before the catalog finishes loading on first
// mount, and for offline/demo mode where /api/catalog isn't reachable.
import { DEFAULT_MILK_TYPES } from '../../utils/milkConfig';
import useCatalog from '../../hooks/useCatalog';
import { QuickGroup, QuickTile } from '../shared/QuickTiles';
import useWalkinDefaults from '../../hooks/useWalkinDefaults';
import SettingsService from '../../services/SettingsService';
import StockService from '../../services/StockService';
import useStations from '../../hooks/useStations';
import { event as logEvent } from '../../services/logging';
// The same pictures the customer kiosk uses, so a drink looks the same
// wherever it is chosen.
import { drinkEmoji, milkEmoji } from '../display/KioskOrder';

const QUICK_KEY = 'coffee_walkin_quick_mode';

// One labelled row of tiles that wraps. Module scope, not inside the
// dialog: a component defined during render is a NEW type every render,
// so React unmounts and remounts the whole row on every keystroke -- which
// on this screen would drop focus out of the name field as you type it.
// GREY OR GONE.
//
// Steve, on oat still showing at a venue that does not stock it: "think
// oat should be greyed out or not there or a option to choose if its
// grey or hidden (grey not available) probably my preference but maybe
// a hidden would be less cluttered."
//
// Both are defensible, so it is a setting rather than an argument.
// Default is grey: a dimmed tile says "we know about oat, it is not on
// today", which is a different message from a tile that simply is not
// there -- and a barista asked for oat can answer the customer instead
// of wondering whether the system is broken.
//
// 'hidden' is the low-clutter option for events with a short menu and a
// long catalogue.
const UNAVAILABLE_DISPLAY_KEY = 'cupq_unavailable_display';

const unavailableDisplay = () => {
  try {
    const v = localStorage.getItem(UNAVAILABLE_DISPLAY_KEY);
    return v === 'hidden' ? 'hidden' : 'grey';
  } catch (e) {
    return 'grey';   // private mode, or storage blocked
  }
};

const WalkInOrderDialog = ({ onSubmit, onClose }) => {
  // TWO WAYS IN, and the barista picks. Steve: "the data entry for the
  // barista is bit clinical and not much of screen used and lots of
  // clicking and scrolling, some may like this format but i think most
  // would prefer the screen like the /my where its more icon driven, but
  // obviously needs more features bean, vip, and other things".
  //
  // Quick is NOT the kiosk wizard. A customer meets that screen once and
  // steps are kindness; a barista meets it two hundred times and a step
  // is a tap they did not need. So Quick is ONE dense screen, wide, with
  // everything visible and nothing to scroll past -- which is the actual
  // complaint. Detailed keeps every field for the odd order.
  //
  // Both write the SAME orderDetails, so switching mid-order keeps what
  // has been chosen, and there is one submit path rather than two.
  const [quickMode, setQuickMode] = useState(() => {
    try { return localStorage.getItem(QUICK_KEY) !== 'false'; } catch (e) { return true; }
  });
  const chooseMode = (q) => {
    setQuickMode(q);
    try { localStorage.setItem(QUICK_KEY, String(q)); } catch (e) { /* private mode */ }
    logEvent('WALKIN_MODE', { mode: q ? 'quick' : 'detailed' });
  };

  const { getCurrentStation, stations } = useStations();
  const currentStation = getCurrentStation();
  
  const [availableMilks, setAvailableMilks] = useState([]);
  const [availableCoffeeTypes, setAvailableCoffeeTypes] = useState([]);
  const [availableSizes, setAvailableSizes] = useState([]);
  const [availableSweeteners, setAvailableSweeteners] = useState([]);
  // Self-serve sugar venues: baristas never add sugar, so the picker is
  // hidden and the order always goes through sweetener-free.
  const [sugarSelfServe, setSugarSelfServe] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/display/menu');
        const b = r.ok ? await r.json() : null;
        if (!cancelled && b?.menu?.sugar_self_serve) setSugarSelfServe(true);
      } catch (e) { /* default: show the picker */ }
    })();
    return () => { cancelled = true; };
  }, []);
  const [availableBeanTypes, setAvailableBeanTypes] = useState([]);
  const [stationInventory, setStationInventory] = useState(null);
  const [loadingInventory, setLoadingInventory] = useState(true);
  const [inventoryError, setInventoryError] = useState(null);
  const [coffeeInventoryWarning, setCoffeeInventoryWarning] = useState(false);

  // Catalog: canonical milk + drink lists. Source of truth for
  // display names, ids, subcategories, and milk synonyms. Falls back
  // to DEFAULT_MILK_TYPES / name-based heuristics if the catalog
  // endpoint is unreachable (offline / demo mode).
  // The FULL catalogue, with each item carrying event_enabled. Steve
  // prefers unavailable milks greyed out rather than gone: "grey = not
  // available" reads as a decision, where a missing tile just looks like
  // the system has never heard of oat milk. Greying needs the item to
  // still be here, so we do not ask the server to filter -- see
  // UNAVAILABLE_DISPLAY below for the hide option.
  const { items: catalogMilks } = useCatalog('milk');
  const { items: catalogDrinks } = useCatalog('drink');

  // Walk-in defaults loaded from /api/walkin-defaults. Operator
  // configures these once per event in Quick Setup → Walk-in defaults.
  // Hook handles fetch + module-level caching + fallback when the
  // endpoint is unreachable. See hooks/useWalkinDefaults.js.
  // Used to be ~30 lines of inline useEffect; extracted 2026-05-25.
  const { defaults: walkinDefaults, loaded: walkinDefaultsLoaded } = useWalkinDefaults();
  // The rest of this file still checks `walkinDefaults` for null in
  // a couple of spots — that's fine because the hook returns the
  // fallback object immediately, so it's never null.
  // eslint-disable-next-line no-unused-vars
  void walkinDefaultsLoaded;
  
  // Remember the previous walk-in customer name. Often the next
  // walk-in is from the same group (a colleague picking up a round)
  // so showing the previous name as a suggestion saves a re-type.
  // Persisted in localStorage so it survives reload + dialog close.
  const [lastCustomerName, setLastCustomerName] = useState(() => {
    try {
      return localStorage.getItem('walkin_last_customer_name') || '';
    } catch (_) {
      return '';
    }
  });

  const [orderDetails, setOrderDetails] = useState({
    customerName: '',
    phoneNumber: '',
    coffeeType: 'Flat White',
    size: 'Regular',
    shots: '1', // Default to single shot
    beanType: '', // Will be set to default once bean types are loaded
    milkType: 'full_cream', // Use milk ID instead of display name
    sweetenerType: 'None',
    sweetenerQuantity: '0',
    extraHot: false,
    priority: false, // VIP flag for staff/VIP orders
    notes: '',
    collectionStation: null, // null means collect at same station
    // Tea-specific fields. Hidden unless the selected drink is a tea.
    teaStrength: 'standard',   // 'weak' | 'standard' | 'strong'
    teaDoubleCup: true,        // default ON — tea is hot
    teaCustomBlend: '',        // free-text override (e.g. "House Special")
  });
  // True once the operator taps a milk themselves -- the black-coffee
  // no-milk default must never fight a deliberate choice.
  const milkTouchedRef = React.useRef(false);

  // True when the selected drink is a tea — matches any drink with
  // "Tea" in the name. Drives the tea-specific UI block below.
  const isTeaDrink = (orderDetails.coffeeType || '').toLowerCase().includes('tea');
  
  // State for group code lookup
  const [groupCodeInput, setGroupCodeInput] = useState('');
  const [groupOrder, setGroupOrder] = useState(null);
  const [isLookingUp, setIsLookingUp] = useState(false);
  // Group lookup lives at the bottom now (collapsed by default) — it's
  // the rare path. Open auto-expands when the operator actually has a
  // code to type. Steve flagged that the prominent NEW banner at the
  // top was wasting vertical space the common path needed.
  const [groupLookupOpen, setGroupLookupOpen] = useState(false);
  
  // State to prevent duplicate submissions
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Enhanced close handler to reset submission state
  const handleClose = () => {
    setIsSubmitting(false);
    if (onClose) {
      onClose();
    }
  };
  
  // Determine which station's inventory to load
  const targetStationId = orderDetails.collectionStation || currentStation?.id;
  const targetStation = orderDetails.collectionStation 
    ? stations.find(s => s.id === orderDetails.collectionStation)
    : currentStation;

  // Initialize StockService for the target station
  useEffect(() => {
    if (targetStation) {
      console.log(`Initializing StockService for station: ${targetStation.id} (${targetStation.name})`);
      StockService.initialize(targetStation.id, targetStation.name);
    }
  }, [targetStation]);

  // Numeric quick-pick keyboard shortcuts. Press 1-9 to jump to the
  // first 9 available drinks. Ignored while typing into a text input
  // (otherwise typing a name with a digit would silently change the
  // drink — a real footgun in high-volume mode).
  useEffect(() => {
    const onKeyDown = (e) => {
      // Ignore modified keys (ctrl/cmd/alt) so we don't clobber browser
      // shortcuts. Shift+digit is fine — keeps Caps Lock cases working.
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = (e.target?.tagName || '').toLowerCase();
      const editable = e.target?.isContentEditable;
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || editable) return;
      const n = parseInt(e.key, 10);
      if (!Number.isInteger(n) || n < 1 || n > 9) return;
      const drink = availableCoffeeTypes[n - 1];
      if (!drink) return;
      e.preventDefault();
      setOrderDetails(prev => ({ ...prev, coffeeType: drink }));
      logEvent('WALKIN_SHORTCUT_USED', { key: n, drink });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [availableCoffeeTypes]);

  // Load station inventory and available options
  useEffect(() => {
    const loadStationInventory = async () => {
      if (!targetStation) return;
      
      setLoadingInventory(true);
      setInventoryError(null);
      
      try {
        console.log(`Loading inventory for station ${targetStation.id} (${targetStation.name})`);
        
        // Load inventory directly from localStorage barista stock (most accurate)
        let inventory = {
          milk: [],
          coffee: [],
          cups: [],
          sweeteners: [],
          drinks: [],
          other: [],
          lastUpdated: new Date().toISOString()
        };
        
        // ARCHITECTURE NOTE
        // -----------------
        // Used to read localStorage first, API as fallback. That meant
        // stale localStorage (drink names in 'coffee' category, typos
        // like 'Whoel Milk', items deleted in Inventory Management
        // that lingered locally) poisoned the dialog for sessions
        // until the operator manually cleared it.
        //
        // FLIP: API is the source of truth. localStorage is an offline
        // cache. On API success, we OVERWRITE the localStorage stock
        // so the next dialog open sees the fresh data. Threshold
        // metadata (capacity, lowThreshold, criticalThreshold) is
        // preserved per-item from whatever localStorage had.
        //
        // Stale-while-revalidate: if there's localStorage data, show
        // it instantly (no spinner flash), then refresh from API in
        // the background. If API confirms different data, the form-
        // validity useEffect re-runs and the dropdown updates.
        const stockKey = `coffee_stock_station_${targetStation.id}`;

        // Ignore-stock ("unlimited stock") mode: the event keeps taking
        // orders regardless of counters. The SMS bot already honours it —
        // but this dialog silently HID zero-stock items, so when the bean
        // counter bugged out to 0 the espresso menu vanished for walk-ins
        // while SMS kept selling (Steve's find). When the mode is ON we
        // keep offering everything; the barista low-stock banner is the
        // honest signal to restock.
        let unlimitedStock = false;
        try {
          const { default: ApiServiceClass0 } = await import('../../services/ApiService');
          const u = await new ApiServiceClass0().get('/settings/unlimited-stock');
          unlimitedStock = !!(u && (u.enabled ?? u.data?.enabled));
        } catch (e) {
          console.warn('Could not read unlimited-stock setting (assuming off):', e);
        }

        // Read cached localStorage immediately so the dialog has
        // SOMETHING to show while the API call is in flight.
        let cachedStock = null;
        try {
          const raw = localStorage.getItem(stockKey);
          if (raw) cachedStock = JSON.parse(raw);
        } catch (e) {
          console.warn('Could not parse cached stock:', e);
        }
        if (cachedStock) {
          Object.keys(cachedStock).forEach(category => {
            if (Array.isArray(cachedStock[category])) {
              inventory[category] = cachedStock[category].filter(
                item => item && (unlimitedStock || item.amount > 0));
            }
          });
        }

        // Now hit the API for the canonical view. If it succeeds,
        // overwrite inventory + cache with the fresh data.
        try {
          const { default: ApiServiceClass } = await import('../../services/ApiService');
          const apiService = new ApiServiceClass();
          const data = await apiService.get(`/inventory?station_id=${targetStation.id}`);

          if (data && Array.isArray(data.items)) {
            // Build category map keyed by lowercased name so we can
            // merge per-item with cached threshold metadata.
            const cachedById = {};
            if (cachedStock) {
              ['milk', 'coffee', 'cups', 'sweeteners', 'drinks', 'other'].forEach(cat => {
                if (Array.isArray(cachedStock[cat])) {
                  cachedStock[cat].forEach(it => {
                    if (it && it.id) cachedById[it.id] = it;
                  });
                }
              });
            }

            const fresh = {
              milk: [], coffee: [], cups: [], sweeteners: [], drinks: [], other: [],
              lastUpdated: new Date().toISOString(),
            };
            data.items.forEach(item => {
              if (!item || !item.name) return;
              const id = item.name.toLowerCase().replace(/\s+/g, '_');
              const cached = cachedById[id];
              const amount = parseFloat(item.amount);
              const stockItem = {
                id,
                name: item.name,
                // API amount is authoritative — use it. Cached thresholds
                // / capacity preserved if we have them.
                amount: isNaN(amount) ? (cached?.amount || 0) : amount,
                capacity: cached?.capacity || (isNaN(amount) ? 0 : amount * 2),
                unit: item.unit || cached?.unit || 'units',
                status: item.status || cached?.status || 'good',
                lowThreshold:      cached?.lowThreshold      || 5,
                criticalThreshold: cached?.criticalThreshold || 2,
                description:       cached?.description       || item.description,
                category:          item.category             || cached?.category,
                enabled: true,
              };
              if (stockItem.amount <= 0 && !unlimitedStock) return;
              // The DB uses several category spellings for sweeteners
              // ('sugar' from Quick Setup, 'sweetener'/'artificial_sweetener'
              // from the organiser catalog). The dialog buckets only knew
              // 'sweeteners', so every sugar row was silently dropped and
              // the walk-in sweetener dropdown showed nothing.
              const CAT_TO_BUCKET = {
                sugar: 'sweeteners',
                sweetener: 'sweeteners',
                artificial_sweetener: 'sweeteners',
                sweeteners: 'sweeteners',
              };
              const cat = CAT_TO_BUCKET[item.category] || item.category;
              if (fresh[cat]) fresh[cat].push(stockItem);
            });

            inventory = { ...fresh };
            // Overwrite the localStorage cache so next open is fresh.
            try {
              localStorage.setItem(stockKey, JSON.stringify(inventory));
            } catch (e) { /* quota? ignore */ }
            console.log(`✅ Inventory loaded from API for station ${targetStation.id} (cache refreshed)`);
          } else if (!cachedStock) {
            // API returned nothing useful AND we have no cache —
            // leave inventory as the empty default. Dialog will
            // show 'no items available' to the operator.
            console.warn('No inventory from API and no cache for station', targetStation.id);
          } else {
            // API empty but cache exists — keep showing the cache.
            console.log('API returned no items; keeping cached stock for station', targetStation.id);
          }
        } catch (apiErr) {
          // Network down / auth failure. We already loaded cache
          // above so the dialog stays functional.
          console.warn(`API inventory fetch failed (using cache):`, apiErr?.message);
          if (!cachedStock) {
            setInventoryError('Could not load station inventory (network down + no cache)');
          }
        }

        // Ignore-stock mode: inflate zero/negative counters so every
        // downstream "amount > 0" availability gate passes — one
        // transform instead of patching a dozen checks. The REAL
        // amounts were already written to the localStorage cache above,
        // so nothing dishonest is persisted.
        if (unlimitedStock) {
          ['milk', 'coffee', 'cups', 'sweeteners', 'drinks', 'other'].forEach(cat => {
            if (Array.isArray(inventory[cat])) {
              inventory[cat] = inventory[cat].map(i =>
                i && i.amount > 0 ? i : { ...i, amount: 999 });
            }
          });
        }

        setStationInventory(inventory);
        
        // Also load global settings for milk types
        const settings = await SettingsService.getSettings();
        
        // Debug logging for settings
        console.log('Global settings loaded:', settings);
        
        // Check if we have any milk settings at all
        if (!settings || !settings.availableMilks) {
          console.log('No global milk settings found, using inventory-based milks instead.');
        }
        
        // Process milk inventory - ROBUST APPROACH to support current and future milk options
        if (inventory && inventory.milk) {
          try {
            console.log(`Processing milk inventory for station ${targetStation.id} (${targetStation.name})`);
            
            // FLEXIBLE APPROACH: Build a complete set of milk options for this station
            const stationMilkTypes = [];
            
            // Get ONLY the milk items with amount > 0 directly from inventory
            const inStockMilkItems = inventory.milk.filter(item => item.amount > 0);
            console.log('In-stock milk items in inventory:', inStockMilkItems.map(m => `${m.id} (${m.amount} ${m.unit})`));
            
            // DEBUG: Log all milk items to check if we have any with zero amount
            const allMilkItems = inventory.milk;
            console.log('ALL milk items in inventory:', allMilkItems.map(m => `${m.id} (${m.amount} ${m.unit})`));
            
            // Log zero-amount milk items for debugging
            const zeroMilkItems = inventory.milk.filter(item => item.amount <= 0);
            if (zeroMilkItems.length > 0) {
              console.log('ZERO AMOUNT milk items (these will be EXCLUDED):', 
                zeroMilkItems.map(m => `${m.id} (${m.name})`));
            }
            
            // STEP 1: Match inventory items to canonical milk definitions
            // from the catalog (or DEFAULT_MILK_TYPES as offline fallback).
            // For items that don't match either, create new definitions
            // automatically.
            //
            // Catalog lookup is by ANY of: item_id, short_name,
            // display_name, or properties.synonyms — so 'whole_milk' /
            // 'whole milk' / 'Whole Milk' / 'full cream' / 'regular'
            // all resolve to the same canonical row (full_cream). This
            // is what kills the 'Whole Milk' vs 'full cream' bug at
            // the dropdown level — the dropdown shows the canonical
            // name regardless of how the inventory row spelled it.
            const _norm = (s) => (s || '').toString().toLowerCase().trim().replace(/^milk_/, '').replace(/\s*milk$/, '');
            const _catalogToMilkShape = (cat, inventoryItem) => ({
              // Map catalog row to the shape the rest of this file expects.
              id: cat.id,
              name: cat.name,
              category: cat.subcategory || 'standard',
              available: true,
              properties: {
                dairyFree: !!cat.properties?.dairyFree,
                lactoseFree: !!cat.properties?.lactoseFree,
                vegan: !!cat.properties?.vegan,
                lowFat: !!cat.properties?.lowFat,
              },
              inventoryAmount: inventoryItem.amount,
              inventoryUnit: inventoryItem.unit,
            });
            const _findInCatalog = (rawId, rawName) => {
              if (!Array.isArray(catalogMilks) || catalogMilks.length === 0) return null;
              const idN = _norm(rawId);
              const nameN = _norm(rawName);
              for (const c of catalogMilks) {
                if (_norm(c.id) === idN || _norm(c.id) === nameN) return c;
                if (_norm(c.short_name) === idN || _norm(c.short_name) === nameN) return c;
                if (_norm(c.name) === idN || _norm(c.name) === nameN) return c;
                const syns = Array.isArray(c.properties?.synonyms) ? c.properties.synonyms : [];
                for (const s of syns) {
                  if (_norm(s) === idN || _norm(s) === nameN) return c;
                }
              }
              return null;
            };

            inStockMilkItems.forEach(inventoryItem => {
              // First, clean up and normalize the inventory item ID
              const itemId = inventoryItem.id;

              // Determine base ID with or without milk_ prefix
              const baseId = itemId.startsWith('milk_') ? itemId.substring(5) : itemId;
              const prefixedId = itemId.startsWith('milk_') ? itemId : `milk_${itemId}`;

              // Catalog first — this is the canonical match. Falls back
              // to DEFAULT_MILK_TYPES if the catalog hasn't loaded yet.
              const catalogMatch = _findInCatalog(itemId, inventoryItem.name);
              let matchingMilk = catalogMatch
                ? _catalogToMilkShape(catalogMatch, inventoryItem)
                : null;
              if (!matchingMilk) {
                const legacyMatch = DEFAULT_MILK_TYPES.find(milk =>
                  milk.id === baseId || milk.id === prefixedId ||
                  milk.id === itemId
                );
                if (legacyMatch) matchingMilk = { ...legacyMatch };
              }

              if (matchingMilk) {
                console.log(`Resolved milk for inventory item ${itemId}: ${matchingMilk.name} (${catalogMatch ? 'catalog' : 'legacy'})`);
                stationMilkTypes.push({
                  ...matchingMilk,
                  inventoryAmount: inventoryItem.amount,
                  inventoryUnit: inventoryItem.unit
                });
              } else {
                // No matching definition found - create a new one on the fly
                console.log(`Creating new milk type definition for inventory item: ${itemId}`);
                
                // Determine category and properties based on naming patterns
                const itemName = inventoryItem.name || baseId;
                const isAlternative = (
                  itemName.toLowerCase().includes('soy') ||
                  itemName.toLowerCase().includes('almond') ||
                  itemName.toLowerCase().includes('oat') ||
                  itemName.toLowerCase().includes('coconut') ||
                  itemName.toLowerCase().includes('rice') ||
                  itemName.toLowerCase().includes('hemp') ||
                  itemName.toLowerCase().includes('pea') ||
                  itemName.toLowerCase().includes('macadamia') ||
                  itemName.toLowerCase().includes('cashew')
                );
                
                // Create new milk type definition
                const newMilkType = {
                  id: baseId,  // Use normalized ID without prefix
                  name: inventoryItem.name || `${baseId.charAt(0).toUpperCase() + baseId.slice(1)} Milk`,
                  category: isAlternative ? 'alternative' : 'standard',
                  available: true,
                  properties: {
                    dairyFree: isAlternative,
                    lactoseFree: isAlternative,
                    vegan: isAlternative,
                    lowFat: itemName.toLowerCase().includes('skim') || itemName.toLowerCase().includes('low')
                  },
                  // Add inventory information for reference
                  inventoryAmount: inventoryItem.amount,
                  inventoryUnit: inventoryItem.unit
                };
                
                console.log(`Created new milk type: ${newMilkType.name} (${newMilkType.category})`);
                stationMilkTypes.push(newMilkType);
              }
            });
            
            // STEP 2: Also check global settings if available
            // This allows event-wide restrictions to be applied
            const filteredMilkTypes = settings && settings.availableMilks 
              ? stationMilkTypes.filter(milk => {
                  // Try all possible ID variants for maximum compatibility
                  const baseId = milk.id.startsWith('milk_') ? milk.id.substring(5) : milk.id;
                  const prefixedId = milk.id.startsWith('milk_') ? milk.id : `milk_${milk.id}`;
                  
                  return settings.availableMilks[milk.id] === true || 
                         settings.availableMilks[baseId] === true ||
                         settings.availableMilks[prefixedId] === true;
                })
              : stationMilkTypes;
            
            // STEP 3: Set the available milk types
            console.log('FINAL MILK OPTIONS:', filteredMilkTypes.map(m => `${m.name} [ID: ${m.id}]`));
            
            // Diagnostic: which catalog milks are NOT in this station's
            // filtered list. Helpful when an operator expects to see a
            // milk and doesn't ("we stock oat but dropdown doesn't show
            // it" → check this log to see if it was filtered out).
            const _master = (Array.isArray(catalogMilks) && catalogMilks.length > 0)
              ? catalogMilks
              : DEFAULT_MILK_TYPES;
            const excludedMilkTypes = _master.filter(m =>
              !filteredMilkTypes.some(fm =>
                fm.id === m.id || fm.id === `milk_${m.id}` || `milk_${fm.id}` === m.id
              )
            );
            
            if (excludedMilkTypes.length > 0) {
              console.log('EXCLUDED MILK TYPES:', excludedMilkTypes.map(m => m.name));
            }
            
            // DEDUPE BEFORE IT REACHES THE SCREEN.
            //
            // The station list and the catalogue both carry the same milk
            // under different ids ("full_cream" and "milk_full_cream"),
            // so the list arrived with each milk twice. In the dropdown
            // that was merely untidy; as tiles it is unmissable -- and
            // BOTH copies rendered highlighted at once, because each
            // matched the selected id by a different rule. Caught by
            // opening the new screen and counting the tiles.
            //
            // Keep the first of each name; a later duplicate carries no
            // information the first one lacks.
            const _seenMilk = new Set();
            const _dedupedMilks = filteredMilkTypes.filter(m => {
              const key = String(m.name || m.id || '')
                .toLowerCase().replace(/\s*milk\s*$/, '').trim();
              if (!key || _seenMilk.has(key)) return false;
              _seenMilk.add(key);
              return true;
            });
            // Which of these does the EVENT actually serve? The catalogue
            // now annotates every item with event_enabled, so a milk that
            // is stocked-but-switched-off can be shown dimmed rather than
            // dropped. Absent flag means "no opinion" -> treat as available,
            // so an unconfigured event never greys its entire menu out.
            const _eventSays = new Map(
              (Array.isArray(catalogMilks) ? catalogMilks : []).map(c => [
                String(c.name || '').toLowerCase().replace(/\s*milk\s*$/, '').trim(),
                c.event_enabled !== false,
              ])
            );
            const _marked = _dedupedMilks.map(m => {
              const key = String(m.name || m.id || '')
                .toLowerCase().replace(/\s*milk\s*$/, '').trim();
              const ok = _eventSays.has(key) ? _eventSays.get(key) : true;
              return { ...m, unavailable: !ok };
            });
            setAvailableMilks(
              unavailableDisplay() === 'hidden'
                ? _marked.filter(m => !m.unavailable)
                : _marked
            );
            
            // Warn if no milk options are available
            if (filteredMilkTypes.length === 0) {
              console.warn('⚠️ WARNING: No milk options available for this station!');
              setInventoryError('No milk options available for this station. Please check your inventory.');
            } else {
              console.log(`Station ${targetStation.id} has ${filteredMilkTypes.length} milk types available`);
            }
          } catch (error) {
            console.error('Error processing milk inventory:', error);
            setInventoryError('Failed to process milk inventory: ' + error.message);
          }
        } else {
          console.warn('⚠️ WARNING: No milk inventory found for this station!');
          setInventoryError('No milk inventory found for this station. Please check your station setup.');
        }
        
        // Per-station item config, fetched ONCE from the server below and
        // reused by the drink gate and the sweetener list. Declared out here
        // because the sweetener block sits after this try/catch closes.
        let stationItemConfig = null;

        // Canonical cup sizes the EVENT allows, e.g. Set{'medium'}. Also out
        // here because cup sizes are processed after that try/catch. null
        // means "no event opinion" — then station stock decides, as before.
        let eventSizesAllowed = null;

        // Cup names differ by level: the event calls it 'Medium (12oz)',
        // station stock calls it 'medium'. Reduce both to one of three
        // canonical sizes so they can be compared. Mirrors
        // _SIZE_NAME_NORMALIZATION in services/coffee_system.py — keep the
        // two in step. 'extra large' is tested before the plain words so it
        // cannot be read as 'large' by accident.
        const canonSize = (raw) => {
          const key = String(raw || '').toLowerCase()
            .replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
          const tokens = new Set(key.split(' '));
          const MAP = [
            ['large',  ['extra large', 'large', 'lg', 'l', '16oz', '16 oz', 'xl']],
            ['small',  ['small', 'sm', 's', '8oz', '8 oz']],
            ['medium', ['medium', 'regular', 'med', 'reg', 'm', '12oz', '12 oz']],
          ];
          for (const [canon, variants] of MAP) {
            for (const v of variants) {
              if (v.includes(' ')) { if (key.includes(v)) return canon; }
              else if (tokens.has(v)) return canon;
            }
          }
          return null;
        };

        // Process coffee and drink inventory - including non-coffee drinks
        try {
          console.log('Processing coffee and drink types from inventory and menu...');
          
          // First, get ALL drink-related items from inventory
          const drinkTypes = new Set();
          
          // Check coffee inventory items
          if (inventory && inventory.coffee) {
            inventory.coffee.forEach(item => {
              // Add coffee bean types (these would be used for coffee-based drinks)
              console.log(`Found coffee item: ${item.name}`);
            });
          }
          
          // Station inventory config, from the SERVER first. localStorage is
          // only a fallback: a barista iPad that has never opened the
          // Organiser has no local copy, and without this the operator's
          // "switch this drink off at this station" would apply on their
          // laptop and nowhere else.
          try {
            const _tok = localStorage.getItem('coffee_system_token');
            const _r = await fetch('/api/settings/station-inventory-configs',
              { headers: _tok ? { Authorization: `Bearer ${_tok}` } : {} });
            if (_r.ok) {
              const _b = await _r.json();
              const _all = _b.data || _b.configs || _b.station_inventory_configs || _b;
              stationItemConfig = _all?.[targetStation.id] || _all?.[String(targetStation.id)] || null;
            }
          } catch (e) {
            console.warn('Could not load station inventory config from server:', e);
          }
          if (!stationItemConfig) {
            try {
              const _raw = localStorage.getItem('station_inventory_configs');
              if (_raw) {
                const _p = JSON.parse(_raw);
                stationItemConfig = _p?.[targetStation.id] || _p?.[String(targetStation.id)] || null;
              }
            } catch (e) { /* ignore — absent config just means no opinion */ }
          }

          // Event-level inventory. A drink switched off for the whole event
          // must not appear at any station either — Green Tea was disabled
          // event-wide and still showed up, for the same reason the station
          // teas did: nothing downstream consulted the setting.
          // The event menu decides what may be ordered at all. Station
          // stock only decides whether a station can make it.
          //
          // This block used to fail OPEN: on any error - or any non-OK
          // response, an expired token being the easy one - eventItemsOff
          // stayed empty, "nothing is switched off" , and every drink in
          // the station's cached stock was offered. Switched-off teas
          // reappeared on the walk-in screen with nothing to say why, and
          // it looked intermittent because it tracked the token, not the
          // settings. Reproduced by making this one call return 401:
          // teas went from 1 to 3.
          //
          // Now: cache the answer when it works, use the cache when it
          // does not, and if there is no cache say so instead of quietly
          // offering everything.
          const EVENT_GATE_CACHE = 'walkin_event_gate_cache';
          let eventItemsOff = new Set();
          let eventItemsKnown = new Set();
          let eventGateLoaded = false;
          const _norm = (v) => String(v || '').toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ').trim();
          let _gateFailReason = '';
          try {
            // Goes through ApiService, not a bare fetch. The bare fetch
            // read the token straight out of localStorage, so it had no
            // refresh, no retry and no shared base URL — any staleness
            // there produced a 401 that the rest of the app never saw,
            // because everything else goes through this client.
            const { default: _ApiSvc } = await import('../../services/ApiService');
            const _b = await new _ApiSvc().get('/event-inventory');
            {
              const _inv = (_b && (_b.data || _b.inventory)) || _b;
              Object.values(_inv || {}).forEach(list => {
                if (!Array.isArray(list)) return;
                list.forEach(it => {
                  if (!it || !it.name) return;
                  const _n = _norm(it.name);
                  if (_n) eventItemsKnown.add(_n);
                  if (it.enabled === false && _n) eventItemsOff.add(_n);
                  // Cups drive the size list further down.
                  const cs = canonSize(it.name);
                  if (cs && String(it.category || '').toLowerCase() === 'cups') {
                    if (eventSizesAllowed === null) eventSizesAllowed = new Set();
                    if (it.enabled) eventSizesAllowed.add(cs);
                  }
                });
              });
              eventGateLoaded = eventItemsKnown.size > 0;
              if (eventGateLoaded) {
                try {
                  localStorage.setItem(EVENT_GATE_CACHE, JSON.stringify({
                    off: [...eventItemsOff], known: [...eventItemsKnown],
                    at: new Date().toISOString(),
                  }));
                } catch (_) { /* quota - the gate still works this time */ }
              } else {
                // A 200 carrying an empty menu. Not an error, but not
                // usable either, and it used to slip past the catch below
                // and fail open with nothing said at all.
                _gateFailReason = 'the event menu is empty';
              }
            }
          } catch (e) {
            _gateFailReason = (e && e.message) ? e.message : String(e);
            console.warn('Could not load event inventory for enable check:', e);
            try {
              const _c = JSON.parse(localStorage.getItem(EVENT_GATE_CACHE) || 'null');
              if (_c && Array.isArray(_c.known) && _c.known.length) {
                eventItemsOff = new Set(_c.off || []);
                eventItemsKnown = new Set(_c.known);
                eventGateLoaded = true;
                console.warn('Using cached event menu from', _c.at);
              }
            } catch (_) { /* corrupt cache - treated as no cache */ }
          }
          if (!eventGateLoaded) {
            // Nothing to filter with. Still show the list, because an
            // event in progress needs to keep taking orders - but never
            // silently, or the operator reads switched-off drinks as
            // switched on. The reason is included: "keeps happening" is
            // only diagnosable if the message says which failure it is.
            setInventoryError(
              'Could not check the event menu, so this list may include '
              + 'drinks you switched off'
              + (_gateFailReason ? ` (${_gateFailReason})` : '')
              + '. Check the connection and reopen.'
            );
          }

          // RETIRED: localStorage 'coffeeMenu' and 'stationMenuAssignments'.
          //
          // Both were browser-only — the server never saw them, so they were
          // populated on whichever laptop happened to open the Organiser and
          // EMPTY everywhere else. The barista iPad has always run without
          // them, which is exactly why a drink switched off on the laptop
          // still appeared on the iPad. Worse than absent: when they were
          // present they could contradict the server.
          //
          // Every gate below now comes from the server — the event inventory
          // and the per-station config fetched above — so all devices agree.
          // These stay as empty objects rather than being ripped out, because
          // the menu-hierarchy loop below is the ONLY consumer and an empty
          // menu simply contributes nothing; the standard coffees come from
          // the bean-stock fallback and the extras from the inventory scan.
          const menuItems = {};
          const stationAssignments = {};
          
          // A drink the operator has TURNED OFF must never come back.
          //
          // The scan below infers drinks from inventory item NAMES, and it
          // used to test `amount > 0` alone. So a tea sitting in stock was
          // re-added to the same Set the menu checks had just filtered —
          // deselect Earl Grey at a station and it reappeared anyway. That
          // is what Steve hit: teas he had switched off still showing on
          // walk-in orders.
          //
          // Two signals, checked in this order:
          //   1. the stock row's own `enabled` flag. This lives in the
          //      SERVER-side blob coffee_stock_station_<id>, so it is the
          //      only one that also applies on the barista iPad.
          //   2. the event/station menu config. localStorage-only, so it
          //      only bites on the device that set it — still worth
          //      honouring where present.
          // Only an EXPLICIT off counts. Absent means "no opinion", not
          // "disabled", so drinks that were never in the menu still appear.
          // The station inventory config is the switch the operator actually
          // uses ("Capabilities"), and unlike the menu blobs it IS stored
          // server-side, so it is the only signal that also applies on the
          // barista iPad. It is keyed by ITEM ID — 'qs-add-drinks-Earl-Grey-Tea'
          // — while everything above matches on NAME ('earl grey tea'), which
          // is why a tea switched off at every station still appeared: the two
          // never met. Normalise both sides and compare.
          const _configOff = (drinkName) => {
            const want = String(drinkName || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
            if (!want || !stationItemConfig) return false;
            for (const byCategory of Object.values(stationItemConfig)) {
              if (!byCategory || typeof byCategory !== 'object') continue;
              for (const [itemId, on] of Object.entries(byCategory)) {
                if (on !== false) continue;          // only an EXPLICIT off counts
                const norm = String(itemId)
                  .replace(/^qs-add-[a-z]+-/i, '')   // drop the 'qs-add-drinks-' prefix
                  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
                if (norm && norm === want) return true;
              }
            }
            return false;
          };

          const _menuOff = (drinkName) => {
            const want = String(drinkName || '').toLowerCase().trim();
            if (!want) return false;
            for (const [drinkId, drink] of Object.entries(menuItems)) {
              const nm = String(drink?.name || drinkId || '').toLowerCase().trim();
              if (nm !== want) continue;
              if (drink?.enabled === false) return true;
              const perStation = stationAssignments?.[targetStation.id]?.[drinkId];
              if (perStation && perStation.enabled === false) return true;
            }
            return false;
          };
          const _eventOff = (drinkName) => {
            const want = _norm(drinkName);
            if (!want) return false;
            if (eventItemsOff.has(want)) return true;
            // Not on the event menu at all. Steve's model: "if the item is
            // not on the event menu, event stock should be irrelevant" -
            // a station carrying something the event never offered must
            // not put it on the order screen. Only applied when the menu
            // actually loaded; with no menu we cannot tell "absent" from
            // "unknown", and the warning above covers that case.
            if (eventGateLoaded && !eventItemsKnown.has(want)) {
              console.debug('walk-in: hiding', drinkName, '- not on the event menu');
              return true;
            }
            return false;
          };
          const _addDrink = (name, item) => {
            if (item && item.enabled === false) return;   // switched off in station stock
            if (_eventOff(name)) return;                   // switched off for the whole event
            if (_configOff(name)) return;                  // switched off in Capabilities (server)
            if (_menuOff(name)) return;                    // switched off in the menu
            drinkTypes.add(name);
          };

          // Check for non-coffee drinks in inventory (they might be in 'drinks', 'other' or other categories)
          // We need to check all inventory items for drink-related items
          const allCategories = ['coffee', 'milk', 'cups', 'sweeteners', 'drinks', 'other'];
          allCategories.forEach(category => {
            if (inventory[category]) {
              inventory[category].forEach(item => {
                // Check for drink-related items that might indicate available drinks
                const itemNameLower = item.name.toLowerCase();
                if (item.amount > 0 && (
                  itemNameLower.includes('hot chocolate') ||
                  itemNameLower.includes('chai') ||
                  itemNameLower.includes('matcha') ||
                  itemNameLower.includes('tea') ||
                  itemNameLower.includes('latte powder') ||
                  itemNameLower.includes('chocolate powder')
                )) {
                  console.log(`Found drink-related inventory item: ${item.name} (category: ${category})`);
                  
                  // Add corresponding drink types based on inventory.
                  // Via _addDrink so anything switched off — in this stock
                  // row or in the menu — stays off.
                  if (itemNameLower.includes('hot chocolate') || itemNameLower.includes('chocolate powder')) {
                    _addDrink('Hot Chocolate', item);
                  }
                  if (itemNameLower.includes('chai')) {
                    _addDrink('Chai Latte', item);
                  }
                  if (itemNameLower.includes('matcha')) {
                    _addDrink('Matcha Latte', item);
                  }
                  if (itemNameLower.includes('tea')) {
                    // Parse tea types if specified
                    if (itemNameLower.includes('english breakfast')) {
                      _addDrink('English Breakfast Tea', item);
                    } else if (itemNameLower.includes('earl grey')) {
                      _addDrink('Earl Grey Tea', item);
                    } else if (itemNameLower.includes('green')) {
                      _addDrink('Green Tea', item);
                    } else if (itemNameLower.includes('peppermint')) {
                      _addDrink('Peppermint Tea', item);
                    } else if (itemNameLower.includes('chamomile')) {
                      _addDrink('Chamomile Tea', item);
                    } else {
                      _addDrink('Tea', item);
                    }
                  }
                }
              });
            }
          });
          
          // Check drinks following the proper hierarchy:
          // 1. Event-level menu (must be enabled in menuItems)
          // 2. Station-specific availability (must be enabled in stationAssignments)
          // 3. Ingredient availability (must have required ingredients in inventory)
          
          Object.entries(menuItems).forEach(([drinkId, drink]) => {
            // Skip if drink is disabled at event level
            if (!drink.enabled) {
              console.log(`Skipping ${drink.name} - disabled at event level`);
              return;
            }
            
            // Check station-specific menu assignment
            const stationMenu = stationAssignments[targetStation.id];
            if (stationMenu && stationMenu[drinkId]) {
              if (!stationMenu[drinkId].enabled) {
                console.log(`Skipping ${drink.name} - disabled at station ${targetStation.id}`);
                return;
              }
            }
            
            // Check ingredient availability for coffee-based drinks
            if (drink.category === 'espresso-based' || drink.category === 'milk-based') {
              // Check if we have coffee beans
              const hasCoffeeBeans = inventory.coffee && inventory.coffee.some(c => c.amount > 0);
              if (!hasCoffeeBeans) {
                console.log(`Skipping ${drink.name} - no coffee beans in inventory`);
                return;
              }
            }
            
            // Check milk availability if drink requires milk
            if (drink.requiresMilk) {
              const hasMilk = inventory.milk && inventory.milk.some(m => m.amount > 0);
              if (!hasMilk) {
                console.log(`Skipping ${drink.name} - requires milk but none available`);
                return;
              }
            }
            
            // If we made it here, the drink is available!
            drinkTypes.add(drink.name);
            console.log(`✓ ${drink.name} is available at station ${targetStation.id}`);
            
            // Check for decaf variants if we have decaf beans
            if (drink.customizable?.decaf) {
              const hasDecaf = inventory.coffee && inventory.coffee.some(c => 
                c.name.toLowerCase().includes('decaf') && c.amount > 0
              );
              
              if (hasDecaf) {
                drinkTypes.add(`Decaf ${drink.name}`);
                console.log(`✓ Decaf ${drink.name} is also available`);
              }
            }
          });
          
          // Always offer the standard espresso-based drinks whenever
          // the station has coffee beans in stock. Previously this was
          // gated on `drinkTypes.size === 0`, so the moment a single
          // non-coffee item (e.g. chai) showed up in inventory, the
          // walk-in dialog stopped offering latte/flat-white/etc — the
          // exact bug the operator hit: "no coffee options, only chai,
          // hot chocolate, matcha." The standard coffees come from
          // available coffee beans, not from a per-event drink menu.
          const hasCoffeeBeansForFallback =
            inventory.coffee && inventory.coffee.some(c => c.amount > 0);
          // Still respects an EXPLICIT off. Turning Mocha off at a station
          // used to be undone here for the same reason the teas came back.
          if (hasCoffeeBeansForFallback) {
            ['Espresso', 'Long Black', 'Flat White', 'Cappuccino', 'Latte', 'Mocha']
              .forEach(d => { if (!_menuOff(d) && !_configOff(d)) drinkTypes.add(d); });
          } else if (drinkTypes.size === 0) {
            console.warn('No drink types found in menu, inventory, or fallback — offering empty defaults');
            ['Espresso', 'Long Black', 'Flat White', 'Cappuccino', 'Latte', 'Mocha']
              .forEach(d => { if (!_menuOff(d) && !_configOff(d)) drinkTypes.add(d); });
          }
          
          // Convert Set to Array and sort
          const sortedDrinkTypes = Array.from(drinkTypes).sort();
          
          // Check if we have coffee beans for warning purposes
          const hasCoffeeBeans = inventory.coffee && inventory.coffee.filter(c => c.amount > 0).length > 0;
          setCoffeeInventoryWarning(!hasCoffeeBeans && sortedDrinkTypes.some(d => 
            !d.includes('Tea') && !d.includes('Hot Chocolate') && !d.includes('Chai')
          ));
          
          setAvailableCoffeeTypes(sortedDrinkTypes);
          console.log(`✅ Station ${targetStation.id} has ${sortedDrinkTypes.length} drink types available:`, sortedDrinkTypes);
          
          // Process available bean types from coffee inventory.
          //
          // The 'coffee' category was historically (incorrectly) seeded
          // with DRINK names — 'Espresso', 'Latte', 'Cappuccino' etc. —
          // so without filtering we'd populate the Bean Type dropdown
          // with drinks, which is nonsense and what Steve flagged.
          // Same `_looksLikeBean` regex used elsewhere in this file
          // for the order-text bean prefix; centralizing the filter
          // here means the dropdown never shows drink-named rows even
          // on legacy events that haven't migrated to the new
          // 'Coffee Beans' SKU layout.
          const _itemLooksLikeBean = (name) => {
            const x = (name || '').toLowerCase();
            return /(bean|blend|roast|single\s*origin|decaf|colombian?|ethiopian?|brazilian?|kenyan?|guatemalan?)/.test(x);
          };
          const beanTypes = [];
          if (inventory.coffee && inventory.coffee.length > 0) {
            inventory.coffee.forEach(coffeeItem => {
              if (coffeeItem.amount > 0 && _itemLooksLikeBean(coffeeItem.name)) {
                // Extract bean type name (remove "Beans" or "Coffee Beans" suffix)
                let beanName = coffeeItem.name
                  .replace(/\s*(Coffee\s*)?Beans?\s*$/i, '')
                  .trim();

                // Don't add duplicates
                if (beanName && !beanTypes.includes(beanName)) {
                  beanTypes.push(beanName);
                }
              }
            });
          }
          
          // Sort bean types, putting house blend first if available
          beanTypes.sort((a, b) => {
            if (a.toLowerCase().includes('house') || a.toLowerCase().includes('blend')) return -1;
            if (b.toLowerCase().includes('house') || b.toLowerCase().includes('blend')) return 1;
            return a.localeCompare(b);
          });
          
          // Same duplicate problem as the milks, from the same cause:
          // the station list and the catalogue name the same bean
          // differently ("House Blend" / "house blend"). Two identical
          // tiles is obvious nonsense on screen.
          const _seenBean = new Set();
          setAvailableBeanTypes(beanTypes.filter(b => {
            const key = String(b || '').toLowerCase().trim();
            if (!key || _seenBean.has(key)) return false;
            _seenBean.add(key);
            return true;
          }));
          console.log(`Station ${targetStation.id} has ${beanTypes.length} bean types available:`, beanTypes);
        } catch (error) {
          console.error('Error processing coffee/drink inventory:', error);
          setInventoryError('Failed to process drink inventory: ' + error.message);
          // Set default coffee types on error
          setAvailableCoffeeTypes([
            'Espresso', 'Long Black', 'Flat White', 'Cappuccino', 'Latte', 'Mocha'
          ]);
        }
        
        // Process cup sizes inventory directly from station inventory
        try {
          if (inventory && inventory.cups && Array.isArray(inventory.cups)) {
            // Cups the station physically has AND the event still allows.
            //
            // This used to filter on amount > 0 alone, so a size switched off
            // in Inventory kept appearing on walk-in orders — station stock
            // still had rows for it. Steve: only Medium ticked, Small still
            // offered. Two extra gates now: the row's own `enabled` flag, and
            // the event's cup list, compared by canonical size because the
            // two levels name cups differently ('Small (8oz)' vs 'small').
            //
            // eventSizesAllowed === null means the event has no cup list at
            // all, in which case station stock decides exactly as before —
            // absent is never treated as "nothing allowed".
            const availableCups = inventory.cups.filter(cup => {
              if (!cup || !(cup.amount > 0)) return false;
              if (cup.enabled === false) return false;
              if (eventSizesAllowed === null) return true;
              const cs = canonSize(cup.name);
              return cs ? eventSizesAllowed.has(cs) : true;
            });
            console.log('Available cups in inventory:', availableCups.map(c => c.name));
            
            // Use actual cup names from inventory instead of mapping to generic sizes
            const availableCupSizes = availableCups.map(cup => cup.name);
            
            // Make sure we have at least one size available
            if (availableCupSizes.length === 0) {
              availableCupSizes.push('Regular Cup');
              console.warn('No cup sizes available in inventory, defaulting to Regular Cup');
            }
            
            setAvailableSizes(availableCupSizes);
            console.log(`✅ Station ${targetStation.id} has ${availableCupSizes.length} actual cup options available: ${availableCupSizes.join(', ')}`);
          } else {
            // No cup inventory found, use defaults
            setAvailableSizes(['Regular Cup']);
            console.warn('No cup inventory found, using default cup');
          }
        } catch (error) {
          console.error('Error processing cup sizes inventory:', error);
          setInventoryError('Failed to process cup sizes inventory: ' + error.message);
        }
        
        // Load and apply station default selections if available.
        //
        // From the SERVER first. StationDefaults.js has persisted these to
        // /api/station-defaults for a while, but this screen only ever read
        // the localStorage mirror — so defaults set in the Organiser
        // pre-filled the form on that laptop and nowhere else, least of all
        // the barista iPad that actually takes walk-ins. localStorage stays
        // as the offline fallback.
        try {
          let defaults = null;
          try {
            const _tok = localStorage.getItem('coffee_system_token');
            const _r = await fetch('/api/station-defaults',
              { headers: _tok ? { Authorization: `Bearer ${_tok}` } : {} });
            if (_r.ok) {
              const _b = await _r.json();
              defaults = _b?.data || _b?.defaults || _b || null;
            }
          } catch (e) {
            console.warn('station-defaults unavailable, using local copy:', e);
          }
          if (!defaults || !Object.keys(defaults).length) {
            const cached = localStorage.getItem('stationDefaults');
            defaults = cached ? JSON.parse(cached) : null;
          }
          if (defaults) {
            const stationDefault = defaults[targetStation.id]
              || defaults[String(targetStation.id)];
            if (stationDefault) {
              console.log(`Loading and applying defaults for station ${targetStation.id}:`, stationDefault);
              
              // Apply station defaults to order details
              setOrderDetails(prev => ({
                ...prev,
                coffeeType: stationDefault.coffeeType || prev.coffeeType,
                size: stationDefault.size || prev.size,
                milkType: stationDefault.milkType || prev.milkType,
                sweetenerType: stationDefault.sweetenerType || prev.sweetenerType,
                sweetenerQuantity: stationDefault.sweetenerQuantity || prev.sweetenerQuantity,
                shots: stationDefault.shots || prev.shots,
                beanType: stationDefault.beanType || prev.beanType
              }));
            }
          }
        } catch (e) {
          console.error('Error loading station defaults:', e);
        }
        
        // Process sweetener inventory - checking station-specific availability
        try {
          console.log('Processing sweetener inventory...');
          const sweetenerTypes = ['None']; // Always include None option
          
          // Which sweeteners this station carries, from the SERVER config
          // fetched above.
          //
          // This used to read localStorage 'stationInventoryConfig' — note the
          // singular. That is a DIFFERENT store from the server-backed
          // 'station_inventory_configs' (plural) that the Station Inventory
          // screen writes; the singular one is browser-only and written by
          // Quick Setup. So sweetener choices made in the Organiser applied on
          // the laptop that made them and nowhere else — the barista iPad has
          // its own empty localStorage. Same class of bug as the drinks gate
          // right above; same fix.
          const stationConfig = stationItemConfig || {};
          
          // Check both sweeteners category and other category for backward compatibility
          const sweetenerItems = [];
          if (inventory && inventory.sweeteners && Array.isArray(inventory.sweeteners)) {
            sweetenerItems.push(...inventory.sweeteners);
          }
          // Also check 'other' category for sweeteners (for backward compatibility)
          if (inventory && inventory.other && Array.isArray(inventory.other)) {
            const sweetenersFromOther = inventory.other.filter(item => 
              item.name.toLowerCase().includes('sugar') || 
              item.name.toLowerCase().includes('sweetener') ||
              item.name.toLowerCase().includes('honey')
            );
            sweetenerItems.push(...sweetenersFromOther);
          }
          
          if (sweetenerItems.length > 0) {
            // Get sweeteners with amount > 0 directly from inventory
            const availableSweetenerItems = sweetenerItems.filter(sweetener => {
              // Check if sweetener has stock
              if (sweetener.amount <= 0) return false;
              
              // Check if sweetener is enabled for this station
              const sweetenerId = sweetener.name.toLowerCase().replace(/\s+/g, '_');
              const isEnabledInConfig = !stationConfig.sweeteners || 
                                        stationConfig.sweeteners[sweetenerId] !== false;
              
              if (!isEnabledInConfig) {
                console.log(`Sweetener ${sweetener.name} is disabled for station ${targetStation.id}`);
                return false;
              }
              
              return true;
            });
            
            console.log('Available sweeteners after filtering:', availableSweetenerItems.map(s => s.name));

            // Add the enabled sweetener names. Quick Setup seeds COUNT-style
            // rows ('no sugar', 'half sugar', '1 sugar', '2 sugar', ...) —
            // those are the same product at different counts, not distinct
            // types, so collapse them into ONE 'Sugar' entry (the operator
            // picks the count with the quantity dropdown next to it).
            // Real named types (White Sugar, Honey, Stevia) pass through.
            const COUNT_STYLE_SUGAR = /^(no|half|\d+)\s*sugars?$/i;
            let hasCountStyleSugar = false;
            availableSweetenerItems.forEach(sweetener => {
              if (COUNT_STYLE_SUGAR.test((sweetener.name || '').trim())) {
                hasCountStyleSugar = true;
              } else {
                sweetenerTypes.push(sweetener.name);
              }
            });
            if (hasCountStyleSugar && !sweetenerTypes.some(t => /sugar/i.test(t))) {
              sweetenerTypes.push('Sugar');
            }
          }
          
          // If no sweeteners found in inventory, don't add defaults
          if (sweetenerTypes.length === 1) {
            console.warn('No sweeteners available for this station');
          }
          
          setAvailableSweeteners(sweetenerTypes);
          console.log(`✅ Station ${targetStation.id} has ${sweetenerTypes.length} sweetener types available:`, sweetenerTypes);
        } catch (error) {
          console.error('Error processing sweetener inventory:', error);
          // Set minimal default on error
          setAvailableSweeteners(['None']);
        }
      } catch (error) {
        console.error('Error loading station inventory:', error);
        setInventoryError('Failed to load station inventory');
      } finally {
        setLoadingInventory(false);
      }
    };
    
    loadStationInventory();
    // catalogMilks is in deps so once the catalog arrives we re-run
    // and milk dropdown labels switch from synthesised guesses to
    // canonical names.
  }, [targetStation, orderDetails.collectionStation, catalogMilks]);

  // Reset form values to valid defaults when available options change
  useEffect(() => {
    // Only update if we have finished loading inventory AND have the
    // operator-configured defaults. Without the defaults we'd seed
    // with stale hardcoded values and then re-flip when they arrive.
    if (loadingInventory) return;
    if (!walkinDefaults) return;

    let updatedDetails = { ...orderDetails };
    let hasChanges = false;

    // Shots + sweetener qty come from the configured defaults if the
    // operator hasn't touched them yet (i.e. they still hold the
    // hardcoded initial state values). Re-checking against the
    // configured defaults means changing them in Quick Setup updates
    // the dialog without a full reload.
    if (orderDetails.shots === '1' && walkinDefaults.default_shots && walkinDefaults.default_shots !== '1') {
      updatedDetails.shots = String(walkinDefaults.default_shots);
      hasChanges = true;
    }
    if (!sugarSelfServe && orderDetails.sweetenerQuantity === '0'
        && walkinDefaults.default_sweetener_qty != null
        && String(walkinDefaults.default_sweetener_qty) !== '0') {
      updatedDetails.sweetenerQuantity = String(walkinDefaults.default_sweetener_qty);
      hasChanges = true;
    }

    console.log('Checking form validity after inventory load:');
    console.log('- Current orderDetails.milkType:', orderDetails.milkType);
    console.log('- Available milks:', availableMilks.map(m => m.id));

    // Coffee type default: prefer the operator-configured default
    // (walkin_defaults.default_coffee_type) if it's available at this
    // station; otherwise fall through to the first available drink.
    if (availableCoffeeTypes.length > 0 && !availableCoffeeTypes.includes(orderDetails.coffeeType)) {
      const configuredDefault = walkinDefaults?.default_coffee_type;
      const useConfigured = configuredDefault && availableCoffeeTypes.includes(configuredDefault);
      updatedDetails.coffeeType = useConfigured
        ? configuredDefault
        : (availableCoffeeTypes[0] || 'Flat White');
      hasChanges = true;
    }

    // Size default: same pattern — operator's pick if stocked, else
    // first available. Avoids the dialog flipping to a weird size
    // when the configured default isn't on this station's menu.
    if (availableSizes.length > 0 && !availableSizes.includes(orderDetails.size)) {
      const configuredSize = walkinDefaults?.default_size;
      const useConfigured = configuredSize && availableSizes.includes(configuredSize);
      updatedDetails.size = useConfigured
        ? configuredSize
        : (availableSizes[0] || 'Regular');
      hasChanges = true;
    }

    // A black coffee defaults to NO MILK (Steve: "even when you're
    // selecting long black, the default should be no milk already
    // selected... for all menus"). Only flips the DEFAULT dairy pick --
    // a milk the operator chose by hand is never overridden.
    const _isBlack = /(espresso|long black|ristretto|americano)/
      .test(String(orderDetails.coffeeType || '').toLowerCase());
    if (_isBlack && orderDetails.milkType
        && orderDetails.milkType !== 'no_milk' && !milkTouchedRef.current) {
      updatedDetails.milkType = 'no_milk';
      hasChanges = true;
    }

    // Check if selected milk is still available - be more careful here.
    //
    // Default milk: walk through the operator-configured preference
    // list (walkin_defaults.default_milk_preference_order) and pick
    // the first one stocked at this station. Falls back to first
    // available milk if none of the preferences are stocked. This
    // replaces a hardcoded regex with a per-event setting — Aussie
    // events can lead with 'full cream', US events with 'whole milk',
    // oat-heavy crowds with 'oat'.
    const _pickDefaultMilk = (milks) => {
      if (!milks || milks.length === 0) return 'no_milk';
      const prefs = (walkinDefaults?.default_milk_preference_order || [])
        .map(p => (p || '').toLowerCase().trim())
        .filter(Boolean);
      for (const pref of prefs) {
        const match = milks.find(m => {
          const t = `${m.id || ''} ${m.name || ''}`.toLowerCase();
          return t.includes(pref);
        });
        if (match) return match.id;
      }
      return milks[0]?.id || 'no_milk';
    };

    // 'no_milk' is always a legitimate choice (black tea / long black) —
    // it's never in availableMilks, and this reset was snapping the
    // operator's "No milk" selection back to the default dairy.
    if (availableMilks.length > 0 && orderDetails.milkType !== 'no_milk'
        && !availableMilks.some(milk => milk.id === orderDetails.milkType)) {
      const def = _pickDefaultMilk(availableMilks);
      console.log('Milk type not available, updating from', orderDetails.milkType, 'to', def);
      updatedDetails.milkType = def;
      hasChanges = true;
    } else if (availableMilks.length > 0) {
      console.log('Current milk type is available:', orderDetails.milkType);
    }

    // Sweetener default: prefer the first REAL sweetener (e.g. "White
    // Sugar") over 'None'. Operators were having to click into the
    // dropdown and pick a type before the quantity selector even became
    // enabled — pure friction when 99% of stations only stock one
    // sweetener and qty=0 already means "no sugar". With the real
    // sweetener pre-selected at qty 0, the operator only touches the
    // quantity dropdown when the customer asks for sugar.
    const _realSweeteners = (availableSweeteners || []).filter(s => s && s !== 'None');
    if (availableSweeteners.length > 0 && !availableSweeteners.includes(orderDetails.sweetenerType)) {
      // Current type isn't valid — pick the first real one if there is
      // one, else fall back to whatever's first (likely 'None').
      updatedDetails.sweetenerType = _realSweeteners[0] || availableSweeteners[0] || 'None';
      hasChanges = true;
    } else if (orderDetails.sweetenerType === 'None' && _realSweeteners.length > 0) {
      // Current type is 'None' but a real sweetener is available — flip
      // the default. Quantity stays at 0 so this is invisible to the
      // operator unless the customer wants sugar.
      updatedDetails.sweetenerType = _realSweeteners[0];
      hasChanges = true;
    }
    
    // Check if selected bean type is still available (for coffee drinks)
    const isCoffeeDrink = orderDetails.coffeeType && 
      !orderDetails.coffeeType.includes('Tea') && 
      !orderDetails.coffeeType.includes('Hot Chocolate') &&
      !orderDetails.coffeeType.includes('Chai') &&
      !orderDetails.coffeeType.includes('Matcha');
      
    if (isCoffeeDrink && availableBeanTypes.length > 0 && !availableBeanTypes.includes(orderDetails.beanType)) {
      console.log('Bean type not available, updating from', orderDetails.beanType, 'to', availableBeanTypes[0]);
      updatedDetails.beanType = availableBeanTypes[0] || '';
      hasChanges = true;
    }

    if (hasChanges) {
      console.log('Form updates needed, applying changes:', updatedDetails);
      setOrderDetails(updatedDetails);
    }
  }, [availableCoffeeTypes, availableSizes, availableMilks, availableSweeteners, availableBeanTypes, loadingInventory, walkinDefaults]);
  
  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    
    // Debug logging for milk type changes
    if (name === 'milkType') {
      console.log('Milk type changed in form:');
      console.log('- Previous:', orderDetails.milkType);
      console.log('- New:', value);
      const selectedMilk = availableMilks.find(milk => milk.id === value);
      console.log('- Selected milk object:', selectedMilk);
    }
    
    // Create updated order details 
    const updatedDetails = {
      ...orderDetails,
      [name]: type === 'checkbox' ? checked : value
    };
    
    // If sweetener type is set to None, reset quantity to 0
    if (name === 'sweetenerType' && value === 'None') {
      updatedDetails.sweetenerQuantity = '0';
    }
    
    // (Removed: notes-keyword VIP auto-detection.) Previously, typing
    // 'vip' / 'staff' / 'organiser' / 'priority' anywhere in the notes
    // auto-checked the VIP box. False-positives included customer name
    // 'Priority' and notes like 'allergic to staff lunches' or
    // 'organiser wants two sugars'. Now that the VIP checkbox is a
    // real, working input — and a recent fix stopped EVERY walk-in
    // from being silently flagged VIP — the auto-detection is more
    // dangerous than useful. The checkbox is the source of truth.
    setOrderDetails(updatedDetails);
  };
  
  // Function to lookup a group by its code
  const lookupGroupCode = () => {
    if (!groupCodeInput) {
      alert('Please enter a group code');
      return;
    }
    
    setIsLookingUp(true);
    
    try {
      // Get saved groups from localStorage
      const savedGroupsData = localStorage.getItem('coffee_group_orders');
      let savedGroups = [];
      
      if (savedGroupsData) {
        savedGroups = JSON.parse(savedGroupsData);
      }
      
      // Find group with matching code
      const foundGroup = savedGroups.find(
        group => group.groupCode === groupCodeInput || group.groupCode.toLowerCase() === groupCodeInput.toLowerCase()
      );
      
      if (foundGroup) {
        setGroupOrder(foundGroup);
        
        // Group orders auto-flag VIP if the group's notes contain a
        // VIP keyword as a STANDALONE WORD (not substring). Tightened
        // from substring match so 'Priority Conference' or 'Affordable
        // Staff Lunches' don't trip it. The operator who created the
        // group typed these notes intentionally so this auto-detection
        // is more reliable than for free-text customer-name notes
        // (which removed the same detection — see handleChange).
        const groupNotesLower = (foundGroup.notes || '').toLowerCase();
        const hasVipKeyword = /\b(vip|staff|organi[sz]er|priority)\b/.test(groupNotesLower);

        if (hasVipKeyword) {
          // Update order details with priority flag
          setOrderDetails(prev => ({
            ...prev,
            priority: true,
            notes: prev.notes + (prev.notes ? ' ' : '') + `Group: ${foundGroup.groupName} (${foundGroup.groupCode})`
          }));
        } else {
          // Just update the notes field
          setOrderDetails(prev => ({
            ...prev,
            notes: prev.notes + (prev.notes ? ' ' : '') + `Group: ${foundGroup.groupName} (${foundGroup.groupCode})`
          }));
        }
      } else {
        alert('No group found with that code');
        setGroupOrder(null);
      }
    } catch (err) {
      console.error('Error looking up group code:', err);
      alert('Failed to lookup group code');
    } finally {
      setIsLookingUp(false);
    }
  };
  
  // Handle group order submission - submits all coffees in the group at once
  const handleSubmitGroup = () => {
    if (!groupOrder) return;
    
    // This will pass the entire group to the parent component for processing
    if (onSubmit) {
      onSubmit(groupOrder, 'group');
    }
    
    // Close the dialog after submission
    handleClose();
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    // Prevent duplicate submissions
    if (isSubmitting) {
      console.log('Walk-in order submission already in progress, ignoring duplicate');
      return;
    }

    // Don't let a new order land on a closed (maintenance/inactive) station —
    // it can't make it or hand it over. The collection dropdown already hides
    // offline stations, but "Same station" would still assign to the current
    // station when the barista is viewing a closed one (how a walk-in ended
    // up on a shut Station 3).
    const _effStationId = orderDetails.collectionStation || currentStation?.id;
    const _effStation = stations.find(s => s.id === _effStationId);
    if (_effStation && (_effStation.status || 'active') !== 'active') {
      alert(
        `${_effStation.name || 'This station'} is offline, so it can't take new orders.\n\n` +
        `Bring it back online (the status pill in the header), or choose an active collection station.`
      );
      return;
    }

    // VIP tap-to-confirm. VIP orders skip the queue, often go free
    // (when pricing is on), and turn red on the barista board — all
    // of which are EXPENSIVE if the box was ticked by accident on a
    // touchscreen. One short confirm is cheap insurance. Skipped if
    // VIP isn't on, and skipped entirely on group orders (those have
    // their own group-VIP path with its own checks).
    if (orderDetails.priority) {
      const customerLabel = (orderDetails.customerName || '').trim() || 'this customer';
      const confirmed = window.confirm(
        `Mark ${customerLabel}'s order as VIP?\n\n` +
        `VIP orders skip the queue and may be free (if event pricing is on). ` +
        `Cancel if the box was ticked by accident.`
      );
      if (!confirmed) {
        // Untick the box so the operator sees they backed out — clearer
        // than silently submitting with priority=false.
        setOrderDetails(prev => ({ ...prev, priority: false }));
        return;
      }
    }

    setIsSubmitting(true);
    
    // Debug logging for milk selection
    console.log('Walk-in order submission - milk selection debug:');
    console.log('- orderDetails.milkType:', orderDetails.milkType);
    console.log('- Available milks:', availableMilks.map(m => `${m.id}: ${m.name}`));
    
    // Resolve the milk object from the dropdown selection.
    //
    // Look-up order: availableMilks (the same list the dropdown
    // renders, already enriched from catalog/DEFAULT_MILK_TYPES in
    // loadStationInventory) → catalog by id/synonym → DEFAULT_MILK_TYPES
    // for offline mode → synthesized fallback.
    const _milkFromCatalog = (id) => {
      if (!Array.isArray(catalogMilks) || catalogMilks.length === 0 || !id) return null;
      const n = id.toString().toLowerCase().trim();
      for (const c of catalogMilks) {
        if ((c.id || '').toLowerCase() === n) return c;
        if ((c.short_name || '').toLowerCase() === n) return c;
        const syns = Array.isArray(c.properties?.synonyms) ? c.properties.synonyms : [];
        if (syns.some(s => (s || '').toLowerCase() === n)) return c;
      }
      return null;
    };
    const _catalogMatch = _milkFromCatalog(orderDetails.milkType);
    const selectedMilk = orderDetails.milkType === 'no_milk'
      ? { id: 'no_milk', name: 'No milk', properties: { dairyFree: true, lactoseFree: true, vegan: true } }
      : (
          availableMilks.find(milk => milk.id === orderDetails.milkType)
          || (_catalogMatch && {
                id: _catalogMatch.id,
                name: _catalogMatch.name,
                category: _catalogMatch.subcategory || 'standard',
                properties: _catalogMatch.properties || {},
              })
          || DEFAULT_MILK_TYPES.find(milk => milk.id === orderDetails.milkType)
          || {
              id: orderDetails.milkType,
              name: orderDetails.milkType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
              category: 'standard',
              properties: {},
            }
        );

    console.log('- Selected milk object:', selectedMilk);
    
    // Check if any VIP/organizer codes appear in the notes
    // We'll look for common VIP indicators like "VIP", "staff", "organizer", "organiser"
    // This list can be expanded or modified as needed
    // Priority is now driven by the explicit VIP checkbox only.
    // (Was OR'd with notes-keyword detection — too many false
    // positives; see the removed handleChange logic above for context.)
    const isPriority = !!orderDetails.priority;
    
    // Include shot information in the coffee type description if not single shot
    const shotsText = orderDetails.shots === '1' ? '' : 
                      orderDetails.shots === '0.5' ? ' (1/2 shot)' :
                      orderDetails.shots === '2' ? ' (double shot)' :
                      orderDetails.shots === '3' ? ' (triple shot)' : '';
    
    // Format sugar field from separate type and quantity
    let sugarText = 'No sugar';
    if (!sugarSelfServe && orderDetails.sweetenerType !== 'None' && parseInt(orderDetails.sweetenerQuantity) > 0) {
      const qty = parseInt(orderDetails.sweetenerQuantity);
      if (qty === 1) {
        sugarText = `1 ${orderDetails.sweetenerType}`;
      } else {
        // Handle plural form
        const sweetenerName = orderDetails.sweetenerType.toLowerCase();
        if (sweetenerName.includes('honey') || sweetenerName.includes('sachet') || sweetenerName.includes('packet')) {
          sugarText = `${qty} ${orderDetails.sweetenerType}`;
        } else {
          sugarText = `${qty} ${orderDetails.sweetenerType}s`;
        }
      }
    }
    
    // Include bean type in coffee type description if it's not the
    // default/house blend AND it actually looks like a bean.
    //
    // Bug guard: InventoryManagement's default 'coffee' category was
    // (incorrectly) seeded with DRINK names ('Espresso', 'Cappuccino',
    // 'Latte') instead of BEAN names. The walk-in dialog populates
    // its beanType dropdown from that inventory list, so when an
    // operator hadn't run Quick Setup (which writes proper bean
    // rows like 'house blend beans' + 'decaf beans'), the bean
    // dropdown surfaced 'Cappuccino' / 'Espresso' as 'beans'. Then
    // this concat produced nonsense order types like 'Cappuccino
    // Latte' and 'Espresso Cappuccino' that the rest of the
    // system couldn't match against menu / pricing / stock rows.
    //
    // Heuristic: only prepend if the beanType looks like a bean
    // (contains 'bean', 'blend', 'roast', 'single origin', or
    // specific origin like 'colombia/ethiopia/etc'). Anything else
    // is silently ignored — operator can fix their inventory.
    const _looksLikeBean = (s) => {
      const x = (s || '').toLowerCase();
      if (!x) return false;
      return /(bean|blend|roast|single\s*origin|decaf|colombian?|ethiopian?|brazilian?|kenyan?|guatemalan?)/.test(x);
    };
    // Tea has no beans and no shots — a stale beanType left over from a
    // previous coffee selection was being prepended, producing cards like
    // "medium decaf English Breakfast Tea" (Steve's live find, #1208).
    const isTea = (orderDetails.coffeeType || '').toLowerCase().includes('tea');
    let coffeeTypeText = orderDetails.coffeeType;
    if (
      !isTea &&
      orderDetails.beanType &&
      _looksLikeBean(orderDetails.beanType) &&
      !orderDetails.beanType.toLowerCase().includes('house') &&
      !orderDetails.beanType.toLowerCase().includes('blend')
    ) {
      coffeeTypeText = `${orderDetails.beanType} ${orderDetails.coffeeType}`;
    }
    if (!isTea) {
      coffeeTypeText += shotsText;
    }

    // For tea drinks, append strength / custom-blend info to the
    // notes so the barista sees it. The backend tea-aware stock
    // decrement reads `is_tea`, `tea_double_cup`, and `tea_strength`
    // directly off the order, not the notes.
    let teaNotes = '';
    if (isTea) {
      const bits = [];
      if (orderDetails.teaStrength && orderDetails.teaStrength !== 'standard') {
        bits.push(`${orderDetails.teaStrength} brew`);
      }
      if (orderDetails.teaDoubleCup) bits.push('double-cup');
      if (orderDetails.teaCustomBlend && orderDetails.teaCustomBlend.trim()) {
        bits.push(`blend: ${orderDetails.teaCustomBlend.trim()}`);
      }
      if (bits.length > 0) teaNotes = ` [Tea: ${bits.join(', ')}]`;
    }
    const mergedNotes = (orderDetails.notes || '') + teaNotes;

    const newOrder = {
      customer_name: orderDetails.customerName, // Backend expects snake_case
      phone_number: orderDetails.phoneNumber || 'Walk-in', // Backend expects snake_case
      coffee_type: coffeeTypeText, // Backend expects snake_case (without size)
      size: orderDetails.size, // Backend expects separate size field
      milk_type: selectedMilk.name, // Backend expects snake_case
      milk_type_id: selectedMilk.id, // Backend expects snake_case
      alternative_milk: selectedMilk.id !== 'no_milk' ? (selectedMilk.category === 'alternative') : false, // Backend expects snake_case
      dairy_free: selectedMilk.properties?.dairyFree || false, // Backend expects snake_case
      sugar: sugarText,
      extra_hot: orderDetails.extraHot, // Backend expects snake_case
      priority: isPriority, // Set priority based on checkbox OR keywords in notes
      notes: mergedNotes,
      shots: parseFloat(orderDetails.shots), // Include shot count for usage calculations
      bean_type: orderDetails.beanType, // Store bean type separately too
      is_walk_in: true, // Backend expects snake_case
      collection_station: orderDetails.collectionStation || null, // Backend expects snake_case
      // Tea-specific flags so the backend can decrement stock
      // correctly (small milk amount, optional 2 cups).
      is_tea: isTea,
      tea_strength: isTea ? (orderDetails.teaStrength || 'standard') : null,
      tea_double_cup: isTea ? !!orderDetails.teaDoubleCup : false,
      tea_custom_blend: isTea ? (orderDetails.teaCustomBlend || '').trim() : '',
    };
    
    console.log('Final order object being submitted:', newOrder);

    // Remember the customer name for the next walk-in (suggested-name
    // chip in the empty field). Skipped if blank.
    const trimmedName = (orderDetails.customerName || '').trim();
    if (trimmedName) {
      try {
        localStorage.setItem('walkin_last_customer_name', trimmedName);
        setLastCustomerName(trimmedName);
      } catch (_) { /* private mode / quota — non-fatal */ }
    }

    // Telemetry — counts walk-in submissions per session. Tiny payload.
    try {
      logEvent('WALKIN_SUBMIT', {
        drink: orderDetails.coffeeType,
        size: orderDetails.size,
        milk: selectedMilk?.id,
        priority: !!isPriority,
        is_tea: isTea,
      });
    } catch (_) { /* logging never breaks submit */ }

    // Wrap onSubmit in try/catch to ensure we reset submission state
    try {
      onSubmit(newOrder);
    } catch (error) {
      console.error('Error in onSubmit:', error);
      setIsSubmitting(false);
    }
    
    // Reset submission state after a delay (in case onSubmit doesn't close dialog immediately)
    setTimeout(() => {
      setIsSubmitting(false);
    }, 2000);
  };

  return (
    <div className="fixed inset-0 bg-gray-800 bg-opacity-50 flex items-center justify-center z-50 p-4">
      {/* Wider (max-w-2xl) + capped at 90vh + flex column so the action
          bar stays visible at the bottom no matter how tall the form
          grows. Form scrolls in the middle. Steve's report: 'I have
          to scroll to hit Add or Cancel' — this stops that. */}
      <div className={`bg-white rounded-lg shadow-lg w-full max-h-[90vh] flex flex-col ${quickMode ? "max-w-5xl" : "max-w-2xl"}`}>
        {/* === STICKY HEADER === */}
        <div className="px-6 pt-5 pb-3 border-b flex justify-between items-center flex-shrink-0">
          <div className="flex items-center gap-4">
            <h3 className="text-lg font-bold">Add Walk-in Order</h3>
            <div className="flex rounded-lg overflow-hidden border border-gray-300 text-sm">
              {[['Quick', true], ['Detailed', false]].map(([label, q]) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => chooseMode(q)}
                  className={`px-3 py-1 font-semibold ${
                    quickMode === q ? 'bg-amber-600 text-white' : 'bg-white text-gray-600'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <button
            className="text-gray-500 hover:text-gray-700"
            onClick={handleClose}
          >
            <XCircle size={20} />
          </button>
        </div>

        {/* === SCROLLABLE BODY === */}
        <div className="overflow-y-auto px-6 py-4 flex-1">
        {quickMode ? (
          /* ---------- QUICK: one wide screen, nothing hidden ----------
             Wrapped in the SAME form id the sticky footer's Add Order
             button targets. Without this the button submits nothing:
             it carries form="walkInForm", that form only exists in the
             Detailed branch, and in Quick mode the click silently did
             nothing at all. Only one branch renders at a time, so the id
             is never duplicated. */
          <form id="walkInForm" onSubmit={handleSubmit} className="space-y-4">
            {/* Name first and large -- it is the only thing a barista MUST
                type, and it is what gets called out. Phone sits beside it
                rather than under, so neither costs a row. */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Customer name *
                </label>
                <input
                  autoFocus
                  type="text"
                  value={orderDetails.customerName}
                  onChange={(e) => setOrderDetails(prev => ({ ...prev, customerName: e.target.value }))}
                  placeholder="e.g. Steve"
                  className="w-full px-4 py-3 text-lg border-2 border-gray-300 rounded-lg
                             focus:border-amber-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Phone (optional)
                </label>
                <input
                  type="tel"
                  value={orderDetails.phoneNumber}
                  onChange={(e) => setOrderDetails(prev => ({ ...prev, phoneNumber: e.target.value }))}
                  placeholder="for a ready text"
                  className="w-full px-4 py-3 text-lg border-2 border-gray-300 rounded-lg
                             focus:border-amber-500 focus:outline-none"
                />
              </div>
            </div>

            {/* DRINK. The number badges are not decoration -- the 1-9
                keyboard shortcuts already exist, and showing them is how
                anyone finds out. */}
            <QuickGroup label="Drink">
              {availableCoffeeTypes.map((d, i) => (
                <QuickTile
                  key={d}
                  active={orderDetails.coffeeType === d}
                  onClick={() => setOrderDetails(prev => ({ ...prev, coffeeType: d }))}
                  emoji={drinkEmoji(d)}
                  label={d}
                  badge={i < 9 ? String(i + 1) : null}
                />
              ))}
            </QuickGroup>

            {/* Milk is meaningless on a tea or a hot chocolate, so it goes
                away rather than sitting there inviting a wrong answer. */}
            {!isTeaDrink && availableMilks.length > 0 && (
              <QuickGroup label="Milk">
                {availableMilks.map(m => (
                  <QuickTile
                    key={m.id}
                    active={orderDetails.milkType === m.id}
                    disabled={m.unavailable}
                    onClick={() => { milkTouchedRef.current = true; setOrderDetails(prev => ({ ...prev, milkType: m.id })); }}
                    emoji={milkEmoji(m.name)}
                    label={m.name}
                  />
                ))}
                <QuickTile
                  active={orderDetails.milkType === 'no_milk'}
                  onClick={() => { milkTouchedRef.current = true; setOrderDetails(prev => ({ ...prev, milkType: 'no_milk' })); }}
                  emoji="🚫"
                  label="No milk"
                />
              </QuickGroup>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <QuickGroup label="Size">
                {availableSizes.map(sz => (
                  <QuickTile
                    key={sz}
                    active={orderDetails.size === sz}
                    onClick={() => setOrderDetails(prev => ({ ...prev, size: sz }))}
                    emoji="🥤"
                    label={sz}
                  />
                ))}
              </QuickGroup>
              {sugarSelfServe ? (
                <QuickGroup label="Sugar">
                  <div className="text-sm text-gray-500 border-2 border-dashed
                                  border-gray-200 rounded-xl px-3 py-2.5">
                    Help-yourself at the counter
                  </div>
                </QuickGroup>
              ) : (
              <QuickGroup label="Sugar">
                {['0', '1', '2', '3'].map(n => (
                  <QuickTile
                    key={n}
                    active={String(orderDetails.sweetenerQuantity) === n}
                    onClick={() => setOrderDetails(prev => ({
                      ...prev,
                      sweetenerQuantity: n,
                      // Picking a number implies sugar; picking none must
                      // not leave a sweetener type behind on the ticket.
                      sweetenerType: n === '0' ? 'None' : (prev.sweetenerType && prev.sweetenerType !== 'None'
                        ? prev.sweetenerType : (availableSweeteners[0] || 'sugar')),
                    }))}
                    emoji={n === '0' ? '🚫' : '🍬'}
                    label={n === '0' ? 'None' : n}
                  />
                ))}
              </QuickGroup>
              )}
            </div>

            {/* The barista-only extras Steve asked to keep: shots, bean,
                extra hot, VIP. One row, because none of them is a
                decision worth a heading. */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <QuickGroup label="Shots">
                {['1', '2'].map(n => (
                  <QuickTile
                    key={n}
                    active={String(orderDetails.shots) === n}
                    onClick={() => setOrderDetails(prev => ({ ...prev, shots: n }))}
                    emoji="☕"
                    label={n === '1' ? 'Single' : 'Double'}
                  />
                ))}
              </QuickGroup>
              {availableBeanTypes.length > 1 && (
                <QuickGroup label="Beans">
                  {availableBeanTypes.map(b => (
                    <QuickTile
                      key={b}
                      active={orderDetails.beanType === b}
                      onClick={() => setOrderDetails(prev => ({ ...prev, beanType: b }))}
                      emoji={b.toLowerCase().includes('decaf') ? '🌙' : '🫘'}
                      label={b}
                    />
                  ))}
                </QuickGroup>
              )}
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => setOrderDetails(prev => ({ ...prev, extraHot: !prev.extraHot }))}
                className={`px-5 py-3 rounded-xl font-semibold border-2 ${
                  orderDetails.extraHot
                    ? 'bg-orange-500 text-white border-orange-500'
                    : 'bg-white text-gray-700 border-gray-300'}`}
              >
                🔥 Extra hot
              </button>
              <button
                type="button"
                onClick={() => setOrderDetails(prev => ({ ...prev, priority: !prev.priority }))}
                className={`px-5 py-3 rounded-xl font-semibold border-2 ${
                  orderDetails.priority
                    ? 'bg-red-600 text-white border-red-600'
                    : 'bg-white text-gray-700 border-gray-300'}`}
              >
                ⭐ VIP / staff priority
              </button>
              <input
                type="text"
                value={orderDetails.notes}
                onChange={(e) => setOrderDetails(prev => ({ ...prev, notes: e.target.value }))}
                placeholder="Notes — e.g. no lid, 1/4 strength, half full"
                className="flex-1 min-w-[14rem] px-4 py-3 border-2 border-gray-300 rounded-xl
                           focus:border-amber-500 focus:outline-none"
              />
            </div>
          </form>
        ) : (
        <>
        {/* Station inventory status message */}
        {targetStation && !loadingInventory && (
          <div className="bg-blue-50 border border-blue-200 rounded p-2 mb-4 text-sm">
            <div className="font-medium text-blue-800 flex items-center">
              <Coffee size={16} className="mr-1 text-amber-600" />
              {orderDetails.collectionStation 
                ? `Showing options available at collection station: ${targetStation.name}`
                : `Creating order for station: ${targetStation.name}`
              }
            </div>
            <div className="text-xs text-blue-600">
              {orderDetails.collectionStation 
                ? 'Coffee, milk, and size options are based on the collection station\'s inventory'
                : 'Only showing milk and coffee options available at this station'
              }
            </div>
            
            {/* Limited inventory warnings */}
            {availableMilks.length < 4 && (
              <div className="mt-1 text-xs text-amber-600 flex items-center">
                <AlertTriangle size={12} className="inline mr-1" />
                Limited milk options at this station ({availableMilks.length} available)
              </div>
            )}
            
            {availableCoffeeTypes.length < 7 && (
              <div className="mt-1 text-xs text-amber-600 flex items-center">
                <AlertTriangle size={12} className="inline mr-1" />
                Limited coffee options at this station ({availableCoffeeTypes.length} available)
              </div>
            )}
            
            {availableSizes.length < 3 && (
              <div className="mt-1 text-xs text-amber-600 flex items-center">
                <AlertTriangle size={12} className="inline mr-1" />
                Limited cup sizes at this station ({availableSizes.length} available)
              </div>
            )}
          </div>
        )}
        
        {/* Loading indicator */}
        {loadingInventory && (
          <div className="bg-gray-50 border border-gray-200 rounded p-4 mb-4 text-center">
            <div className="animate-pulse text-gray-600">
              Loading inventory for {targetStation?.name || 'station'}...
            </div>
          </div>
        )}
        
        {/* Error message */}
        {inventoryError && (
          <div className="bg-red-50 border border-red-200 rounded p-2 mb-4 text-sm">
            <div className="font-medium text-red-800 flex items-center">
              <AlertTriangle size={16} className="mr-1" />
              {inventoryError}
            </div>
            <div className="text-xs text-red-600">
              Using default options instead. Some options might not be available at this station.
            </div>
          </div>
        )}
        {/* Form is now identified by id so the sticky action bar at
            the bottom (outside the form tag, in the dialog's footer)
            can still submit via the button[form="walkInForm"] attr. */}
        <form id="walkInForm" onSubmit={handleSubmit}>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Customer Name*
              </label>
              <input
                type="text"
                name="customerName"
                // autoComplete off: without it the browser builds a saved
                // history of every name typed here and offers it as a
                // dropdown ("walkinsteve", "stever"…) — clutter for the
                // barista and a small privacy leak of past customers'
                // names. The app's own "last customer" chip (below) is the
                // intended suggestion mechanism.
                autoComplete="off"
                value={orderDetails.customerName}
                onChange={handleChange}
                onFocus={(e) => {
                  // Auto-clear the pre-filled "last customer" placeholder
                  // on focus. Operators told us tapping the field to
                  // "edit" the suggested name and accidentally appending
                  // is worse than just clearing it. They can paste it
                  // back via the suggested-name chip below if needed.
                  if (e.target.dataset.prefilled === 'true') {
                    setOrderDetails(prev => ({ ...prev, customerName: '' }));
                    e.target.dataset.prefilled = 'false';
                  }
                }}
                data-prefilled={lastCustomerName && orderDetails.customerName === lastCustomerName ? 'true' : 'false'}
                placeholder={lastCustomerName ? `e.g. ${lastCustomerName}` : ''}
                className="w-full p-2 border rounded"
                required
              />
              {lastCustomerName && !orderDetails.customerName && (
                <button
                  type="button"
                  onClick={() => setOrderDetails(prev => ({ ...prev, customerName: lastCustomerName }))}
                  className="text-xs text-blue-600 hover:underline mt-1"
                  title="Re-use the previous walk-in customer name"
                >
                  Same as last walk-in: {lastCustomerName}
                </button>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Phone Number
              </label>
              <input 
                type="text" 
                name="phoneNumber"
                value={orderDetails.phoneNumber}
                onChange={handleChange}
                className="w-full p-2 border rounded"
                placeholder="Optional for walk-in"
              />
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-4 mb-4">
            {/* Drink picker: category first, then drink within that
                category. Previously a single dropdown crammed all
                drinks (Latte → Earl Grey Tea → Hot Chocolate) into
                one list — once the menu grew past 10 drinks it was
                hard to scan. Now Category narrows what's in Drink. */}
            {(() => {
              // Categorise via catalog subcategory when the drink is
              // in the catalog, fall back to name-based detection
              // otherwise. Adding 'cold_brew' to catalog with
              // subcategory='espresso' automatically lands it in the
              // Coffee bucket; subcategory='other' splits further by
              // name (so Hot Chocolate, Chai, Matcha stay separate).
              const _catalogLookup = (name) => {
                if (!Array.isArray(catalogDrinks) || !name) return null;
                const n = name.toLowerCase().trim();
                return catalogDrinks.find(d =>
                  (d.name || '').toLowerCase() === n ||
                  (d.short_name || '').toLowerCase() === n ||
                  (d.id || '').toLowerCase() === n.replace(/\s+/g, '_')
                );
              };
              const _categorize = (name) => {
                const cat = _catalogLookup(name);
                if (cat?.subcategory === 'espresso') return 'coffee';
                if (cat?.subcategory === 'tea')      return 'tea';
                // 'other' subcategory + name-based fallback: split
                // chai / hot chocolate / matcha into their own
                // buckets for the operator's sanity.
                const n = (name || '').toLowerCase();
                if (n.includes('tea')) return 'tea';
                if (n.includes('hot chocolate')) return 'hot_chocolate';
                if (n.includes('chai')) return 'chai';
                if (n.includes('matcha')) return 'matcha';
                // No catalog match + no name signal — assume coffee.
                return 'coffee';
              };
              // Bucket the available drinks. Only show categories
              // that have at least one drink stocked at this station.
              const buckets = { coffee: [], tea: [], hot_chocolate: [], chai: [], matcha: [] };
              for (const d of availableCoffeeTypes) {
                const cat = _categorize(d);
                if (buckets[cat]) buckets[cat].push(d);
              }
              const categoryLabels = {
                coffee: 'Coffee', tea: 'Tea',
                hot_chocolate: 'Hot Chocolate',
                chai: 'Chai', matcha: 'Matcha', other: 'Other (custom)',
              };
              const availableCategories = Object.entries(buckets)
                .filter(([, drinks]) => drinks.length > 0)
                .map(([cat]) => cat);
              // 'Other' is ALWAYS available — it's the escape hatch.
              availableCategories.push('other');

              const isOther = orderDetails.coffeeType && !availableCoffeeTypes.includes(orderDetails.coffeeType);
              const currentCategory = isOther ? 'other' : _categorize(orderDetails.coffeeType);
              const drinksInCategory = currentCategory === 'other' ? [] : (buckets[currentCategory] || []);

              const handleCategoryChange = (e) => {
                const newCat = e.target.value;
                if (newCat === 'other') {
                  // Leave coffeeType as a placeholder for the text input.
                  setOrderDetails(prev => ({ ...prev, coffeeType: '' }));
                } else {
                  // Snap to the first drink in the new category.
                  const first = (buckets[newCat] || [])[0];
                  if (first) setOrderDetails(prev => ({ ...prev, coffeeType: first }));
                }
              };

              return (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Drink*
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {/* Category picker — narrows the drink list */}
                    <select
                      value={currentCategory}
                      onChange={handleCategoryChange}
                      className="p-2 border rounded text-sm"
                      aria-label="Drink category"
                    >
                      {availableCategories.map(cat => (
                        <option key={cat} value={cat}>{categoryLabels[cat]}</option>
                      ))}
                    </select>
                    {/* Drink picker — either select-from-category or
                        free-text for 'other' */}
                    {currentCategory === 'other' ? (
                      <input
                        type="text"
                        name="coffeeType"
                        value={orderDetails.coffeeType}
                        onChange={handleChange}
                        placeholder="e.g. Babyccino"
                        className="p-2 border rounded text-sm"
                        required
                      />
                    ) : (
                      <select
                        name="coffeeType"
                        value={drinksInCategory.includes(orderDetails.coffeeType) ? orderDetails.coffeeType : (drinksInCategory[0] || '')}
                        onChange={handleChange}
                        className="p-2 border rounded text-sm"
                        required
                      >
                        {drinksInCategory.map(d => (
                          <option key={d} value={d}>{d}</option>
                        ))}
                      </select>
                    )}
                  </div>
                  {availableCoffeeTypes.length < 9 && (
                    <div className="mt-1 text-xs text-amber-600 flex items-center">
                      <AlertTriangle size={12} className="inline mr-1" />
                      Limited drink options at this station
                    </div>
                  )}
                  {coffeeInventoryWarning && (
                    <div className="mt-1 text-xs text-red-600 flex items-center">
                      <AlertTriangle size={12} className="inline mr-1" />
                      Warning: No coffee beans in inventory
                    </div>
                  )}
                  {/* Numeric quick-pick row. High-volume events lose
                      seconds per order when baristas have to dig through
                      a dropdown — keys 1-9 jump straight to the most
                      common drinks. The handler is wired in a useEffect
                      below, this row just shows the hints. */}
                  {availableCoffeeTypes.length > 1 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {availableCoffeeTypes.slice(0, 9).map((d, i) => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => setOrderDetails(prev => ({ ...prev, coffeeType: d }))}
                          className={`text-xs px-2 py-1 rounded border ${
                            orderDetails.coffeeType === d
                              ? 'bg-amber-100 border-amber-400 text-amber-900'
                              : 'bg-white border-gray-300 hover:bg-gray-50'
                          }`}
                          title={`Press ${i + 1} on the keyboard`}
                        >
                          <kbd className="font-mono text-gray-500 mr-1">{i + 1}</kbd>{d}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Size
              </label>
              <select 
                name="size"
                value={availableSizes.includes(orderDetails.size) ? orderDetails.size : availableSizes[0]}
                onChange={handleChange}
                className="w-full p-2 border rounded"
              >
                {availableSizes.map(size => (
                  <option key={size} value={size}>{size}</option>
                ))}
              </select>
              {availableSizes.length < 3 && (
                <div className="mt-1 text-xs text-amber-600 flex items-center">
                  <AlertTriangle size={12} className="inline mr-1" />
                  Limited cup sizes at this station
                </div>
              )}
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Espresso Shots
              </label>
              <select 
                name="shots"
                value={orderDetails.shots}
                onChange={handleChange}
                className="w-full p-2 border rounded"
              >
                <option value="0.5">Half shot (1/2)</option>
                <option value="1">Single shot</option>
                <option value="2">Double shot</option>
                <option value="3">Triple shot</option>
              </select>
              <p className="text-xs text-gray-500 mt-1">
                Affects coffee usage calculations
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Milk Type
              </label>
              <select 
                name="milkType"
                value={(orderDetails.milkType === 'no_milk' || availableMilks.some(milk => milk.id === orderDetails.milkType)) ? orderDetails.milkType : (availableMilks.length > 0 ? availableMilks[0].id : 'no_milk')}
                onChange={handleChange}
                className="w-full p-2 border rounded"
              >
                {/* Group milk options by category */}
                {availableMilks.filter(milk => milk.category === 'standard').length > 0 && (
                  <optgroup label="Standard Milks">
                    {availableMilks
                      .filter(milk => milk.category === 'standard')
                      .map(milk => (
                        <option key={milk.id} value={milk.id}>
                          {milk.name}
                          {milk.properties.lactoseFree ? ' (Lactose-Free)' : ''}
                          {milk.properties.lowFat ? ' (Low-Fat)' : ''}
                        </option>
                      ))
                    }
                  </optgroup>
                )}
                
                {availableMilks.filter(milk => milk.category === 'alternative').length > 0 && (
                  <optgroup label="Alternative Milks">
                    {availableMilks
                      .filter(milk => milk.category === 'alternative')
                      .map(milk => (
                        <option key={milk.id} value={milk.id}>
                          {milk.name}
                          {milk.properties.vegan ? ' (Vegan)' : ''}
                        </option>
                      ))
                    }
                  </optgroup>
                )}
                
                <option value="no_milk">No milk</option>
              </select>
              
              {availableMilks.length < 5 && (
                <div className="mt-1 text-xs text-amber-600 flex items-center">
                  <AlertTriangle size={12} className="inline mr-1" />
                  Limited milk options at this station
                </div>
              )}
            </div>
          </div>
          
          {/* Bean Type Selection — only meaningful when the station has
              2+ beans loaded. Most event stations run a single bean, so
              forcing the operator to confirm the bean for every walk-in
              is pure friction. When only one bean is stocked, the
              backend still gets the bean name (defaulted in state from
              availableBeanTypes[0]); the UI just hides the dropdown. */}
          {(() => {
            const isCoffeeDrink = orderDetails.coffeeType &&
              !orderDetails.coffeeType.includes('Tea') &&
              !orderDetails.coffeeType.includes('Hot Chocolate') &&
              !orderDetails.coffeeType.includes('Chai') &&
              !orderDetails.coffeeType.includes('Matcha');

            // Only render the dropdown when there's a real choice to make.
            if (isCoffeeDrink && availableBeanTypes.length > 1) {
              return (
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Bean Type
                    </label>
                    <select
                      name="beanType"
                      value={orderDetails.beanType}
                      onChange={handleChange}
                      className="w-full p-2 border rounded"
                    >
                      {availableBeanTypes.map(bean => (
                        <option key={bean} value={bean}>
                          {bean}
                          {bean.toLowerCase().includes('decaf') ? ' (Decaf)' : ''}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-gray-500 mt-1">
                      Multiple grinders available
                    </p>
                  </div>
                  <div></div>
                </div>
              );
            }
            return null;
          })()}
          
          {sugarSelfServe && (
            <div className="mb-4 p-2 bg-amber-50 border border-amber-200 rounded text-sm text-amber-800">
              Sugar is self-serve at the counter - baristas don't add it, so
              there's nothing to pick here.
            </div>
          )}
          <div className={`grid grid-cols-2 gap-4 mb-4 ${sugarSelfServe ? 'hidden' : ''}`}>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Sweetener Type
              </label>
              <select 
                name="sweetenerType"
                value={availableSweeteners.includes(orderDetails.sweetenerType) ? orderDetails.sweetenerType : (availableSweeteners.length > 0 ? availableSweeteners[0] : 'None')}
                onChange={handleChange}
                className="w-full p-2 border rounded"
              >
                {availableSweeteners.map(sweetener => (
                  <option key={sweetener} value={sweetener}>{sweetener}</option>
                ))}
              </select>
              {availableSweeteners.length < 3 && (
                <div className="mt-1 text-xs text-amber-600 flex items-center">
                  <AlertTriangle size={12} className="inline mr-1" />
                  Limited sweetener options at this station
                </div>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Sweetener Quantity
              </label>
              <select 
                name="sweetenerQuantity"
                value={orderDetails.sweetenerQuantity}
                onChange={handleChange}
                className="w-full p-2 border rounded"
                disabled={orderDetails.sweetenerType === 'None'}
              >
                <option value="0">0</option>
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="3">3</option>
                <option value="4">4</option>
                <option value="5">5</option>
                <option value="6">6</option>
              </select>
              {orderDetails.sweetenerType === 'None' && (
                <p className="text-xs text-gray-500 mt-1">
                  Select a sweetener type to set quantity
                </p>
              )}
            </div>
          </div>
          
          {isTeaDrink && (
            <div className="mb-4 p-3 border border-emerald-200 bg-emerald-50 rounded">
              <h4 className="text-sm font-semibold text-emerald-900 mb-2">Tea options</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Strength
                  </label>
                  <select
                    name="teaStrength"
                    value={orderDetails.teaStrength || 'standard'}
                    onChange={handleChange}
                    className="w-full p-2 border rounded"
                  >
                    <option value="weak">Weak (short brew)</option>
                    <option value="standard">Standard</option>
                    <option value="strong">Strong (long brew)</option>
                  </select>
                </div>
                <div className="flex items-center pt-6">
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      name="teaDoubleCup"
                      checked={!!orderDetails.teaDoubleCup}
                      onChange={handleChange}
                      className="mr-2"
                    />
                    <span className="text-sm font-medium text-gray-700">
                      Double-cup (recommended — tea is hot)
                    </span>
                  </label>
                </div>
              </div>
              <div className="mt-3">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Custom blend (optional)
                </label>
                <input
                  type="text"
                  name="teaCustomBlend"
                  value={orderDetails.teaCustomBlend || ''}
                  onChange={handleChange}
                  className="w-full p-2 border rounded"
                  placeholder='e.g. "Customer brought own teabag" or "House Special"'
                />
                <p className="text-xs text-gray-500 mt-1">
                  Note: tea-with-milk only uses a splash (~30 ml); stock is
                  decremented at the lower rate.
                </p>
              </div>
            </div>
          )}

          <div className="mb-4 flex space-x-4">
            <label className="flex items-center">
              <input
                type="checkbox"
                name="extraHot"
                checked={orderDetails.extraHot}
                onChange={handleChange}
                className="mr-2"
              />
              <span className="text-sm font-medium text-gray-700">Extra hot</span>
            </label>

            {/* VIP checkbox — when ticked, gets a loud red bg + border
                so the operator can't miss that this order will be
                charged free / treated as priority. Operators have
                accidentally ticked this and not noticed until the
                order appeared in the VIP queue. */}
            <label
              className={`flex items-center px-2 py-1 rounded transition-colors cursor-pointer ${
                orderDetails.priority
                  ? 'bg-red-100 border-2 border-red-500 ring-2 ring-red-200'
                  : 'border-2 border-transparent hover:bg-red-50'
              }`}
            >
              <input
                type="checkbox"
                name="priority"
                checked={orderDetails.priority}
                onChange={handleChange}
                className="mr-2 h-4 w-4 accent-red-600"
              />
              <span className={`text-sm font-semibold ${
                orderDetails.priority ? 'text-red-800' : 'text-red-600'
              }`}>
                VIP / Staff Priority {orderDetails.priority && '⚠ ON'}
              </span>
            </label>
          </div>
          
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Collection Station
            </label>
            <select
              name="collectionStation"
              value={orderDetails.collectionStation || ''}
              onChange={handleChange}
              className="w-full p-2 border rounded"
            >
              <option value="">Same station (Order & collect here)</option>
              {stations
                // Don't offer offline (maintenance/inactive) stations — a
                // closed station can't make or hand over the order. This is
                // why a walk-in could be assigned to a shut station.
                .filter(station => (station.status || 'active') === 'active')
                .map(station => (
                  <option key={station.id} value={station.id}>
                    Collect at {station.name || `Station ${station.id}`}
                  </option>
                ))}
            </select>
            <p className="text-xs text-gray-500 mt-1">
              Choose a different station if the customer wants to collect their order elsewhere.
            </p>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Special Instructions
            </label>
            <textarea 
              name="notes"
              value={orderDetails.notes}
              onChange={handleChange}
              className="w-full p-2 border rounded"
              rows="2"
              placeholder="Special instructions (no foam, extra hot, etc.)"
            ></textarea>
            <p className="text-xs text-gray-500 mt-1">
              For VIP / staff comp, tick the VIP checkbox above —
              the notes-keyword auto-detection was removed.
            </p>
          </div>
          
        </form>

        {/* Group Order Lookup — moved from the top of the dialog to
            the bottom as a collapsed disclosure. Rare path; doesn't
            need to dominate the dialog header. Operators who do need
            it click 'Look up a group code' and the input expands. */}
        <div className="mt-4 border-t pt-3">
          <button
            type="button"
            onClick={() => setGroupLookupOpen(o => !o)}
            className="w-full text-left text-sm text-gray-600 hover:text-amber-700 flex items-center justify-between"
          >
            <span className="flex items-center">
              <Coffee size={14} className="mr-2" />
              Look up a group code instead
            </span>
            <span className="text-gray-400">{groupLookupOpen ? '−' : '+'}</span>
          </button>
          {groupLookupOpen && (
            <div className="mt-3 p-3 bg-blue-50 rounded border border-blue-200">
              <div className="flex space-x-2">
                <input
                  type="text"
                  placeholder="Enter group code (e.g. ASM-1234)"
                  className="flex-1 p-2 border rounded"
                  value={groupCodeInput}
                  onChange={(e) => setGroupCodeInput(e.target.value)}
                />
                <button
                  type="button"
                  className="bg-blue-600 text-white px-3 py-2 rounded flex items-center"
                  onClick={lookupGroupCode}
                  disabled={isLookingUp}
                >
                  {isLookingUp ? 'Looking up...' : <><Search size={16} className="mr-1" /> Lookup</>}
                </button>
              </div>
              {groupOrder && (
                <div className="mt-3 bg-white p-3 rounded-lg border border-blue-200">
                  <div className="flex justify-between items-start">
                    <div>
                      <h5 className="font-semibold">{groupOrder.groupName}</h5>
                      <div className="text-sm text-gray-600">Code: {groupOrder.groupCode}</div>
                      {groupOrder.notes && (
                        <div className="text-sm mt-1">
                          {groupOrder.notes.toLowerCase().includes('vip') ||
                           groupOrder.notes.toLowerCase().includes('staff') ||
                           groupOrder.notes.toLowerCase().includes('priority') ? (
                            <div className="flex items-center">
                              <Star size={14} className="text-red-500 mr-1" />
                              <span className="font-medium text-red-600">{groupOrder.notes}</span>
                            </div>
                          ) : (
                            <span className="italic">{groupOrder.notes}</span>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center">
                      <Users size={18} className="text-blue-500 mr-1" />
                      <div className="text-xl font-bold text-amber-600">
                        {groupOrder.orders.length} orders
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="w-full mt-2 bg-amber-600 text-white py-2 rounded-md flex items-center justify-center"
                    onClick={handleSubmitGroup}
                  >
                    <Coffee size={18} className="mr-2" />
                    Submit Entire Group ({groupOrder.orders.length} coffees)
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
        </>
        )}

        </div>{/* === end SCROLLABLE BODY === */}

        {/* === STICKY FOOTER === Always-visible action bar. Buttons use
            form="walkInForm" so the submit still hits the form's onSubmit
            handler even though they live outside the <form> tag. */}
        <div className="px-6 py-3 border-t flex justify-end space-x-2 flex-shrink-0 bg-white rounded-b-lg">
          <button
            type="button"
            className="px-4 py-2 bg-gray-300 rounded hover:bg-gray-400"
            onClick={handleClose}
          >
            Cancel
          </button>
          <button
            type="submit"
            form="walkInForm"
            disabled={isSubmitting}
            className={`px-4 py-2 rounded text-white ${
              isSubmitting
                ? 'bg-gray-400 cursor-not-allowed'
                : 'bg-amber-600 hover:bg-amber-700'
            }`}
          >
            {isSubmitting ? 'Adding Order...' : 'Add Order'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default WalkInOrderDialog;
