/**
 * Inventory Integration Service
 * Bridges between the Organizer's inventory management and the Barista's stock system
 */
class InventoryIntegrationService {
  constructor() {
    this.categoryMapping = {
      milk: 'milk',
      coffee: 'coffee', 
      cups: 'cups',
      syrups: 'syrups',
      sweeteners: 'sweeteners',  // Keep sweeteners in their own category
      drinks: 'drinks',  // Non-coffee drinks
      extras: 'other'
    };
    this.syncTimeoutId = null;
  }

  /**
   * Sync inventory from organizer to barista stock system
   * Takes the event_inventory and updates the stock system for all stations
   */
  syncInventoryToStations() {
    try {
      // Load the event inventory created by organizers
      const eventInventory = this.getEventInventory();
      if (!eventInventory) {
        console.log('No event inventory found');
        return;
      }

      // Load station configurations
      const stationConfigs = this.getStationConfigs();
      
      // Get available stations
      const stations = this.getStations();
      
      stations.forEach(station => {
        this.syncInventoryToStation(station.id, eventInventory, stationConfigs);
      });

      console.log('Inventory sync to stations completed');
    } catch (error) {
      console.error('Error syncing inventory to stations:', error);
    }
  }

  /**
   * Sync inventory for a specific station
   */
  syncInventoryToStation(stationId, eventInventory, stationConfigs) {
    try {
      const stationConfig = stationConfigs[stationId] || {};
      const stockData = {};

      // Load station inventory quantities
      const stationInventoryQuantities = this.getStationInventoryQuantities();

      // Process each category
      Object.keys(eventInventory).forEach(inventoryCategory => {
        const stockCategory = this.categoryMapping[inventoryCategory] || inventoryCategory;
        
        if (!stockData[stockCategory]) {
          stockData[stockCategory] = [];
        }

        // Process each item in the category
        eventInventory[inventoryCategory]?.forEach(item => {
          // Check if this item is enabled for this station
          const isAvailableAtStation = stationConfig[inventoryCategory]?.[item.id] || false;
          
          if (item.enabled && isAvailableAtStation) {
            // Convert inventory item to stock item format, including quantities
            const stockItem = this.convertInventoryItemToStock(item, stockCategory, stationId, stationInventoryQuantities);
            stockData[stockCategory].push(stockItem);
          }
        });
      });

      // Save the stock data for this station
      this.saveStationStock(stationId, stockData);
      
      console.log(`Synced inventory to station ${stationId}:`, stockData);
    } catch (error) {
      console.error(`Error syncing inventory to station ${stationId}:`, error);
    }
  }

  /**
   * Convert an inventory item to stock item format
   */
  convertInventoryItemToStock(inventoryItem, stockCategory, stationId, stationInventoryQuantities) {
    // Determine default values based on category
    const defaults = this.getStockDefaults(stockCategory, inventoryItem.name);
    
    // Get the actual quantity set for this item at this station
    const stationQuantity = stationInventoryQuantities[stationId]?.[inventoryItem.category]?.[inventoryItem.id]?.quantity || 0;
    
    // Use the station quantity if set, otherwise use defaults
    const actualAmount = stationQuantity > 0 ? stationQuantity : defaults.amount;
    const actualCapacity = Math.max(actualAmount, defaults.capacity); // Capacity should be at least the current amount
    
    return {
      id: inventoryItem.id,
      name: inventoryItem.name,
      amount: actualAmount,
      capacity: actualCapacity,
      unit: inventoryItem.unit || defaults.unit,
      status: actualAmount <= defaults.criticalThreshold ? 'critical' : 
              actualAmount <= defaults.lowThreshold ? 'low' : 'good',
      lowThreshold: Math.max(1, actualCapacity * 0.25), // 25% of capacity
      criticalThreshold: Math.max(1, actualCapacity * 0.1), // 10% of capacity
      description: inventoryItem.description,
      category: inventoryItem.category,
      enabled: true
    };
  }

  /**
   * Get sensible defaults for different types of stock items
   */
  getStockDefaults(category, itemName) {
    const nameUpper = itemName.toUpperCase();
    
    switch (category) {
      case 'milk':
        if (nameUpper.includes('REGULAR') || nameUpper.includes('WHOLE')) {
          return { amount: 20, capacity: 20, unit: 'L', lowThreshold: 5, criticalThreshold: 2 };
        } else {
          return { amount: 5, capacity: 5, unit: 'L', lowThreshold: 2, criticalThreshold: 1 };
        }
        
      case 'coffee':
        if (nameUpper.includes('HOUSE') || nameUpper.includes('MAIN')) {
          return { amount: 5, capacity: 5, unit: 'kg', lowThreshold: 1.5, criticalThreshold: 0.5 };
        } else {
          return { amount: 3, capacity: 3, unit: 'kg', lowThreshold: 1, criticalThreshold: 0.3 };
        }
        
      case 'cups':
        if (nameUpper.includes('SMALL')) {
          return { amount: 200, capacity: 200, unit: 'pcs', lowThreshold: 50, criticalThreshold: 20 };
        } else if (nameUpper.includes('LARGE')) {
          return { amount: 100, capacity: 100, unit: 'pcs', lowThreshold: 30, criticalThreshold: 10 };
        } else {
          return { amount: 150, capacity: 150, unit: 'pcs', lowThreshold: 40, criticalThreshold: 15 };
        }
        
      case 'syrups':
        return { amount: 2, capacity: 2, unit: 'L', lowThreshold: 0.5, criticalThreshold: 0.2 };
        
      case 'sweeteners':
        if (nameUpper.includes('SUGAR')) {
          return { amount: 5, capacity: 5, unit: 'kg', lowThreshold: 1, criticalThreshold: 0.5 };
        } else if (nameUpper.includes('HONEY') || nameUpper.includes('AGAVE') || nameUpper.includes('MAPLE')) {
          return { amount: 2, capacity: 2, unit: 'L', lowThreshold: 0.5, criticalThreshold: 0.2 };
        } else if (nameUpper.includes('PACKET') || nameUpper.includes('STEVIA') || nameUpper.includes('ARTIFICIAL')) {
          return { amount: 500, capacity: 500, unit: 'pcs', lowThreshold: 100, criticalThreshold: 50 };
        } else {
          return { amount: 1, capacity: 1, unit: 'kg', lowThreshold: 0.3, criticalThreshold: 0.1 };
        }
        
      case 'drinks': // non-coffee drinks
        // Most drinks are prepared per serving
        return { amount: 50, capacity: 50, unit: 'servings', lowThreshold: 10, criticalThreshold: 5 };
        
      case 'other': // extras
        if (nameUpper.includes('POWDER')) {
          return { amount: 2, capacity: 2, unit: 'kg', lowThreshold: 0.5, criticalThreshold: 0.2 };
        } else if (nameUpper.includes('PACKET') || nameUpper.includes('PCS')) {
          return { amount: 100, capacity: 100, unit: 'pcs', lowThreshold: 20, criticalThreshold: 10 };
        } else {
          return { amount: 1, capacity: 1, unit: 'kg', lowThreshold: 0.3, criticalThreshold: 0.1 };
        }
        
      default:
        return { amount: 1, capacity: 1, unit: 'unit', lowThreshold: 0.3, criticalThreshold: 0.1 };
    }
  }

  /**
   * Get event inventory from localStorage
   */
  getEventInventory() {
    try {
      const inventory = localStorage.getItem('event_inventory');
      return inventory ? JSON.parse(inventory) : null;
    } catch (error) {
      console.error('Error loading event inventory:', error);
      return null;
    }
  }

  /**
   * Get station configurations from localStorage
   */
  getStationConfigs() {
    try {
      const configs = localStorage.getItem('station_inventory_configs');
      return configs ? JSON.parse(configs) : {};
    } catch (error) {
      console.error('Error loading station configs:', error);
      return {};
    }
  }

  /**
   * Get station inventory quantities
   */
  getStationInventoryQuantities() {
    try {
      const quantities = localStorage.getItem('station_inventory_quantities');
      return quantities ? JSON.parse(quantities) : {};
    } catch (error) {
      console.error('Error loading station inventory quantities:', error);
      return {};
    }
  }

  /**
   * Get available stations (mock implementation)
   */
  getStations() {
    // TODO: Replace with actual station loading logic
    // For now, return a basic default
    return [
      { id: 1, name: 'Station 1' },
      { id: 2, name: 'Station 2' },
      { id: 3, name: 'Station 3' }
    ];
  }

  /**
   * Save stock data for a specific station
   */
  saveStationStock(stationId, stockData) {
    try {
      // Use the same key pattern as StockService
      const stockKey = `coffee_stock_station_${stationId}`;
      localStorage.setItem(stockKey, JSON.stringify(stockData));
      
      // Also trigger a refresh event so useStock hooks pick up the changes
      window.dispatchEvent(new CustomEvent('stock:updated', { 
        detail: { stationId, stockData } 
      }));
      
      console.log(`Saved stock data for station ${stationId} to key: ${stockKey}`);
    } catch (error) {
      console.error(`Error saving stock data for station ${stationId}:`, error);
    }
  }

  /**
   * Load stock data for a specific station
   */
  getStationStock(stationId) {
    try {
      // Use the same key pattern as StockService
      const stockKey = `coffee_stock_station_${stationId}`;
      const stockData = localStorage.getItem(stockKey);
      return stockData ? JSON.parse(stockData) : null;
    } catch (error) {
      console.error(`Error loading stock data for station ${stationId}:`, error);
      return null;
    }
  }

  /**
   * Throttled sync to prevent excessive calls
   */
  throttledSyncInventoryToStations() {
    // Clear any existing timeout
    if (this.syncTimeoutId) {
      clearTimeout(this.syncTimeoutId);
    }
    
    // Set new timeout to sync after 500ms of no new calls
    this.syncTimeoutId = setTimeout(() => {
      console.log('Throttled sync: Syncing inventory to stations...');
      this.syncInventoryToStations();
      this.syncTimeoutId = null;
    }, 500);
  }

  /**
   * Update the StockService to use organizer-defined inventory
   */
  initializeStockServiceIntegration() {
    // Listen for inventory changes and sync them (throttled)
    window.addEventListener('inventory:updated', () => {
      console.log('Inventory updated, scheduling throttled sync...');
      this.throttledSyncInventoryToStations();
    });

    // Listen for station config changes and sync them (throttled)
    window.addEventListener('stationConfig:updated', () => {
      console.log('Station configuration updated, scheduling throttled sync...');
      this.throttledSyncInventoryToStations();
    });

    // Initial sync (immediate)
    console.log('Initial inventory sync...');
    this.syncInventoryToStations();
  }

  /**
   * Get available inventory items for a specific station
   */
  getAvailableItemsForStation(stationId) {
    const eventInventory = this.getEventInventory();
    const stationConfigs = this.getStationConfigs();
    const stationConfig = stationConfigs[stationId] || {};
    
    const availableItems = {};
    
    if (eventInventory) {
      Object.keys(eventInventory).forEach(category => {
        availableItems[category] = eventInventory[category]?.filter(item => {
          return item.enabled && (stationConfig[category]?.[item.id] || false);
        }) || [];
      });
    }
    
    return availableItems;
  }

  /**
   * Update inventory when changes are made in the organizer
   */
  notifyInventoryUpdated() {
    // Just dispatch the event - the event listener will handle the sync
    // Don't call syncInventoryToStations() here to avoid infinite loop
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('inventory:updated'));
    }, 100);
  }

  /**
   * Update station configurations when changes are made
   */
  notifyStationConfigUpdated() {
    // Don't auto-sync - it's overwriting the configs we just saved!
    // Just dispatch the event for other components that might be listening
    window.dispatchEvent(new CustomEvent('stationConfig:updated'));
    console.log('Station config updated event dispatched (sync disabled to prevent config loss)');
  }

  /**
   * Force sync of all station inventories (useful for manual refresh)
   */
  forceSyncAllStations() {
    console.log('Force syncing all station inventories...');
    this.syncInventoryToStations();
  }

  /**
   * Force sync for a specific station
   */
  forceSyncStation(stationId) {
    console.log(`🔄 Force syncing station ${stationId}...`);
    
    // FIXED: Check if we already have depleted stock data - preserve it!
    const currentStockKey = `coffee_stock_station_${stationId}`;
    const existingStock = localStorage.getItem(currentStockKey);
    
    if (existingStock) {
      console.log(`✅ Station ${stationId} already has stock data (possibly depleted), preserving existing levels`);
      try {
        const parsed = JSON.parse(existingStock);
        // Check if any items are depleted (amount < capacity)
        let hasDepleted = false;
        Object.values(parsed).forEach(category => {
          if (Array.isArray(category)) {
            category.forEach(item => {
              if (item.amount < item.capacity) {
                hasDepleted = true;
              }
            });
          }
        });
        
        if (hasDepleted) {
          console.log(`📉 Station ${stationId} has depleted stock, keeping existing data to preserve order completion effects`);
          return true; // Return true to indicate "sync successful" without overwriting
        }
      } catch (error) {
        console.error('Error checking existing stock for depletion:', error);
        // If we can't parse it, continue with sync
      }
    }
    
    // Debug: Check what data we have
    const eventInventory = this.getEventInventory();
    const stationConfigs = this.getStationConfigs();
    const stationQuantities = this.getStationInventoryQuantities();
    
    console.log('📦 Event Inventory:', eventInventory);
    console.log('⚙️ Station Configs:', stationConfigs);
    console.log('🔢 Station Quantities:', stationQuantities);
    console.log(`🎯 Station ${stationId} Config:`, stationConfigs[stationId]);
    console.log(`🎯 Station ${stationId} Quantities:`, stationQuantities[stationId]);
    
    if (!eventInventory || Object.keys(eventInventory).length === 0) {
      console.warn('❌ No event inventory found! You need to set up inventory in Organiser → Event Setup → Inventory Management');
      return false;
    }
    
    if (!stationConfigs[stationId]) {
      console.warn(`❌ No station configuration found for station ${stationId}! You need to configure items in Organiser → Stations → Station Inventory`);
      return false;
    }
    
    // Clear only old format keys, preserve current depleted stock
    const oldKeys = [
      `stock_data_${stationId}`,
      `stock_data_station_${stationId}`
      // REMOVED: `coffee_stock_station_${stationId}` - preserve current depleted data
    ];
    
    oldKeys.forEach(key => {
      if (localStorage.getItem(key)) {
        console.log(`🧹 Clearing old stock data (${key}) for station ${stationId}`);
        localStorage.removeItem(key);
      }
    });
    
    console.log(`💾 Creating fresh stock data for station ${stationId} (no existing depleted data found)`);
    this.syncInventoryToStation(stationId, eventInventory, stationConfigs);
    return true;
  }

  /**
   * Clear all stock data and resync from organiser
   */
  clearAllStockAndResync() {
    console.log('🧹 Clearing all stock data and resyncing...');
    
    // Clear all variants of station stock data keys
    for (let i = 1; i <= 10; i++) {
      // Old formats
      const oldKey1 = `stock_data_${i}`;
      const oldKey2 = `stock_data_station_${i}`;
      // Current StockService format
      const currentKey = `coffee_stock_station_${i}`;
      
      if (localStorage.getItem(oldKey1)) {
        console.log(`Clearing old stock data (v1) for station ${i}`);
        localStorage.removeItem(oldKey1);
      }
      if (localStorage.getItem(oldKey2)) {
        console.log(`Clearing old stock data (v2) for station ${i}`);
        localStorage.removeItem(oldKey2);
      }
      if (localStorage.getItem(currentKey)) {
        console.log(`Clearing current stock data for station ${i}`);
        localStorage.removeItem(currentKey);
      }
    }
    
    // Resync all configured stations
    this.syncInventoryToStations();
    
    // Notify that data was cleared
    window.dispatchEvent(new CustomEvent('stock:cleared'));
    
    console.log('✅ All stock data cleared and resynced');
  }
}

// Create singleton instance
const inventoryIntegrationService = new InventoryIntegrationService();

export default inventoryIntegrationService;