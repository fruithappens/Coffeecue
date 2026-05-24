// components/dialogs/WalkInOrderDialog.js
import React, { useState, useEffect } from 'react';
import { XCircle, Search, Coffee, Users, Star, AlertTriangle } from 'lucide-react';
// DEFAULT_MILK_TYPES is the legacy hardcoded list; useCatalog('milk')
// is the canonical source. The legacy import is kept as a fallback
// for the brief moment before the catalog finishes loading on first
// mount, and for offline/demo mode where /api/catalog isn't reachable.
import { DEFAULT_MILK_TYPES } from '../../utils/milkConfig';
import useCatalog from '../../hooks/useCatalog';
import SettingsService from '../../services/SettingsService';
import StockService from '../../services/StockService';
import useStations from '../../hooks/useStations';

const WalkInOrderDialog = ({ onSubmit, onClose }) => {
  const { getCurrentStation, stations } = useStations();
  const currentStation = getCurrentStation();
  
  const [availableMilks, setAvailableMilks] = useState([]);
  const [availableCoffeeTypes, setAvailableCoffeeTypes] = useState([]);
  const [availableSizes, setAvailableSizes] = useState([]);
  const [availableSweeteners, setAvailableSweeteners] = useState([]);
  const [availableBeanTypes, setAvailableBeanTypes] = useState([]);
  const [stationInventory, setStationInventory] = useState(null);
  const [loadingInventory, setLoadingInventory] = useState(true);
  const [inventoryError, setInventoryError] = useState(null);
  const [coffeeInventoryWarning, setCoffeeInventoryWarning] = useState(false);

  // Catalog: canonical milk list with synonyms baked into properties.
  // Source of truth for milk display names, ids, and matching. Falls
  // back to DEFAULT_MILK_TYPES if the catalog endpoint is unreachable
  // (offline / demo mode), which keeps the dialog working even without
  // a backend.
  const { items: catalogMilks } = useCatalog('milk');

  // Walk-in defaults loaded from /api/walkin-defaults. Operator
  // configures these once per event in Quick Setup → Walk-in defaults.
  // Replaces hardcoded 'Flat White' / 'Small (8oz)' / milk priority
  // regex that used to live in this file. Null until loaded; the
  // form-validity useEffect waits for both this AND the inventory.
  const [walkinDefaults, setWalkinDefaults] = useState(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { default: ApiServiceClass } = await import('../../services/ApiService');
        const api = new ApiServiceClass();
        const resp = await api.get('/walkin-defaults');
        if (!cancelled && resp) {
          setWalkinDefaults(resp);
        }
      } catch (e) {
        // Backend unreachable or settings missing — fall back to the
        // shape used by the rest of this file. Doesn't block the dialog.
        console.warn('walkin-defaults load failed, using built-in defaults:', e?.message);
        if (!cancelled) {
          setWalkinDefaults({
            default_coffee_type: 'Flat White',
            default_size: 'Small (8oz)',
            default_shots: '1',
            default_milk_preference_order: [
              'whole milk', 'full cream', 'regular', 'standard',
              'dairy', 'milk', 'skim', 'low fat',
            ],
            default_sweetener_qty: 0,
          });
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);
  
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
        
        console.log(`🔄 Loading inventory directly from barista stock for station ${targetStation.id}...`);
        
        try {
          // Load from localStorage stock data (this is what baristas actually see)
          const stockKey = `coffee_stock_station_${targetStation.id}`;
          const stockData = localStorage.getItem(stockKey);
          
          if (stockData) {
            const stock = JSON.parse(stockData);
            console.log(`✅ Found stock data for station ${targetStation.id}:`, Object.keys(stock));

            // Copy all categories from stock to inventory. DON'T strip
            // drink-named 'coffee' rows here — other code paths use
            // `inventory.coffee.length > 0` as a proxy for 'espresso
            // drinks available' and stripping would falsely hide
            // Latte/Cappuccino etc. from the menu. The bean-name
            // heuristic is applied later, only when populating
            // availableBeanTypes — that's the right place.
            Object.keys(stock).forEach(category => {
              if (Array.isArray(stock[category])) {
                inventory[category] = stock[category].filter(item => item.amount > 0);
                console.log(`  - ${category}: ${inventory[category].length} items with stock`);
              }
            });

            console.log(`✅ Loaded inventory from barista stock for station ${targetStation.id}:`, inventory);
          } else {
            console.warn(`⚠️ No stock data found for station ${targetStation.id}, trying API fallback...`);

            // Fallback to API if no stock data. We use ApiService
            // rather than raw fetch so:
            //   - the base URL comes from the same place every other
            //     call does (no more hardcoded localhost that 404s on
            //     Railway when offline-mode kicks in)
            //   - auth header + refresh-on-401 inherit automatically
            //   - if the token is wrong, the user gets the same
            //     re-login flow they would anywhere else.
            const { default: ApiServiceClass } = await import('../../services/ApiService');
            const apiService = new ApiServiceClass();
            let data = null;
            try {
              data = await apiService.get(`/inventory?station_id=${targetStation.id}`);
              console.log(`✅ API fallback inventory for station ${targetStation.id}:`, data);
            } catch (apiErr) {
              console.warn(`API fallback failed for station ${targetStation.id}:`, apiErr);
            }

            if (data) {
              if (data.items) {
                data.items.forEach(item => {
                  const itemData = {
                    id: item.name.toLowerCase().replace(/\s+/g, '_'),
                    name: item.name,
                    amount: parseFloat(item.amount) || 0,
                    unit: item.unit || 'units',
                    status: item.status
                  };
                  
                  if (item.category === 'milk' && itemData.amount > 0) {
                    inventory.milk.push(itemData);
                  } else if (item.category === 'coffee' && itemData.amount > 0) {
                    inventory.coffee.push(itemData);
                  } else if (item.category === 'cups' && itemData.amount > 0) {
                    inventory.cups.push(itemData);
                  } else if (item.category === 'sweeteners' && itemData.amount > 0) {
                    inventory.sweeteners.push(itemData);
                  } else if (item.category === 'other' && itemData.amount > 0) {
                    inventory.other.push(itemData);
                  }
                });
              }
            }
          }
        } catch (error) {
          console.error('❌ Error loading inventory:', error);
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
            
            setAvailableMilks(filteredMilkTypes);
            
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
                  
                  // Add corresponding drink types based on inventory
                  if (itemNameLower.includes('hot chocolate') || itemNameLower.includes('chocolate powder')) {
                    drinkTypes.add('Hot Chocolate');
                  }
                  if (itemNameLower.includes('chai')) {
                    drinkTypes.add('Chai Latte');
                  }
                  if (itemNameLower.includes('matcha')) {
                    drinkTypes.add('Matcha Latte');
                  }
                  if (itemNameLower.includes('tea')) {
                    // Parse tea types if specified
                    if (itemNameLower.includes('english breakfast')) {
                      drinkTypes.add('English Breakfast Tea');
                    } else if (itemNameLower.includes('earl grey')) {
                      drinkTypes.add('Earl Grey Tea');
                    } else if (itemNameLower.includes('green')) {
                      drinkTypes.add('Green Tea');
                    } else if (itemNameLower.includes('peppermint')) {
                      drinkTypes.add('Peppermint Tea');
                    } else if (itemNameLower.includes('chamomile')) {
                      drinkTypes.add('Chamomile Tea');
                    } else {
                      drinkTypes.add('Tea');
                    }
                  }
                }
              });
            }
          });
          
          // Load the correct menu configuration
          const coffeeMenu = localStorage.getItem('coffeeMenu');
          const stationMenuAssignments = localStorage.getItem('stationMenuAssignments');
          let menuItems = {};
          let stationAssignments = {};
          
          if (coffeeMenu) {
            try {
              menuItems = JSON.parse(coffeeMenu);
              console.log('Loaded coffee menu configuration:', Object.keys(menuItems));
            } catch (e) {
              console.error('Error parsing coffee menu:', e);
            }
          }
          
          if (stationMenuAssignments) {
            try {
              stationAssignments = JSON.parse(stationMenuAssignments);
              console.log('Loaded station menu assignments:', stationAssignments);
            } catch (e) {
              console.error('Error parsing station assignments:', e);
            }
          }
          
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
          if (hasCoffeeBeansForFallback) {
            ['Espresso', 'Long Black', 'Flat White', 'Cappuccino', 'Latte', 'Mocha']
              .forEach(d => drinkTypes.add(d));
          } else if (drinkTypes.size === 0) {
            console.warn('No drink types found in menu, inventory, or fallback — offering empty defaults');
            ['Espresso', 'Long Black', 'Flat White', 'Cappuccino', 'Latte', 'Mocha']
              .forEach(d => drinkTypes.add(d));
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
          
          setAvailableBeanTypes(beanTypes);
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
            // Get cups with amount > 0 directly from inventory and use actual names
            const availableCups = inventory.cups.filter(cup => cup.amount > 0);
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
        
        // Load and apply station default selections if available
        try {
          const stationDefaults = localStorage.getItem('stationDefaults');
          if (stationDefaults) {
            const defaults = JSON.parse(stationDefaults);
            const stationDefault = defaults[targetStation.id];
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
          
          // Load station inventory configuration to check what's actually enabled
          const stationInventoryConfig = localStorage.getItem('stationInventoryConfig');
          let stationConfig = {};
          if (stationInventoryConfig) {
            try {
              const allStationConfigs = JSON.parse(stationInventoryConfig);
              stationConfig = allStationConfigs[targetStation.id] || {};
              console.log(`Station ${targetStation.id} inventory config:`, stationConfig);
            } catch (e) {
              console.error('Error parsing station inventory config:', e);
            }
          }
          
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
            
            // Add the enabled sweetener names
            availableSweetenerItems.forEach(sweetener => {
              sweetenerTypes.push(sweetener.name);
            });
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
    if (orderDetails.sweetenerQuantity === '0' && walkinDefaults.default_sweetener_qty != null
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

    if (availableMilks.length > 0 && !availableMilks.some(milk => milk.id === orderDetails.milkType)) {
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
    if (orderDetails.sweetenerType !== 'None' && parseInt(orderDetails.sweetenerQuantity) > 0) {
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
    let coffeeTypeText = orderDetails.coffeeType;
    if (
      orderDetails.beanType &&
      _looksLikeBean(orderDetails.beanType) &&
      !orderDetails.beanType.toLowerCase().includes('house') &&
      !orderDetails.beanType.toLowerCase().includes('blend')
    ) {
      coffeeTypeText = `${orderDetails.beanType} ${orderDetails.coffeeType}`;
    }
    coffeeTypeText += shotsText;

    // For tea drinks, append strength / custom-blend info to the
    // notes so the barista sees it. The backend tea-aware stock
    // decrement reads `is_tea`, `tea_double_cup`, and `tea_strength`
    // directly off the order, not the notes.
    const isTea = (orderDetails.coffeeType || '').toLowerCase().includes('tea');
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
      <div className="bg-white rounded-lg shadow-lg max-w-2xl w-full max-h-[90vh] flex flex-col">
        {/* === STICKY HEADER === */}
        <div className="px-6 pt-5 pb-3 border-b flex justify-between items-center flex-shrink-0">
          <h3 className="text-lg font-bold">Add Walk-in Order</h3>
          <button
            className="text-gray-500 hover:text-gray-700"
            onClick={handleClose}
          >
            <XCircle size={20} />
          </button>
        </div>

        {/* === SCROLLABLE BODY === */}
        <div className="overflow-y-auto px-6 py-4 flex-1">
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
                value={orderDetails.customerName}
                onChange={handleChange}
                className="w-full p-2 border rounded"
                required
              />
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
              // Categorise from name. Tea / Hot Chocolate / Chai /
              // Matcha by substring; everything else is "coffee"
              // (i.e. espresso drink). 'other' is for the free-text
              // escape hatch — never derived from inventory.
              const _categorize = (name) => {
                const n = (name || '').toLowerCase();
                if (n.includes('tea')) return 'tea';
                if (n.includes('hot chocolate')) return 'hot_chocolate';
                if (n.includes('chai')) return 'chai';
                if (n.includes('matcha')) return 'matcha';
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
                value={availableMilks.some(milk => milk.id === orderDetails.milkType) ? orderDetails.milkType : (availableMilks.length > 0 ? availableMilks[0].id : 'no_milk')}
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
          
          <div className="grid grid-cols-2 gap-4 mb-4">
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
