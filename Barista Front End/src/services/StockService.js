// services/StockService.js
import ApiService from './ApiService';
import InventoryIntegrationService from './InventoryIntegrationService';

/**
 * Service for inventory management
 * Extends ApiService to inherit authentication and API functionality
 * Added localStorage support for station-specific stock management
 */
class StockService {
  constructor() {
    // Get ApiService singleton instance instead of extending
    this.apiService = new ApiService();
    this.baseUrl = 'http://localhost:5001/api';
    this.debugMode = true;
    this.enableFallback = false; // Disabled by default
    
    // Track current station
    this.stationId = null;
    this.stationName = null;
    this.initialized = false;
    this.listeners = [];
    
    // Map to standardize milk type IDs
    this.milkTypeMap = {
      // Standard ID format mapping
      'full_cream': 'milk_regular',
      'skim': 'milk_skim',
      'reduced_fat': 'milk_reduced_fat',
      'lactose_free': 'milk_lactose_free',
      'soy': 'milk_soy',
      'oat': 'milk_oat',
      'almond': 'milk_almond',
      'coconut': 'milk_coconut',
      'macadamia': 'milk_macadamia',
      'rice': 'milk_rice', 
      'hemp': 'milk_hemp',
      'cashew': 'milk_cashew',
      'pea': 'milk_pea',
      
      // Reverse mapping (with prefix)
      'milk_regular': 'full_cream',
      'milk_skim': 'skim',
      'milk_reduced_fat': 'reduced_fat',
      'milk_lactose_free': 'lactose_free',
      'milk_soy': 'soy',
      'milk_oat': 'oat',
      'milk_almond': 'almond',
      'milk_coconut': 'coconut',
      'milk_macadamia': 'macadamia',
      'milk_rice': 'rice',
      'milk_hemp': 'hemp',
      'milk_cashew': 'cashew',
      'milk_pea': 'pea'
    };
    
    // Default stock templates for new stations
    this.defaultStockItems = {
      milk: [
        { id: 'milk_regular', name: 'Regular Milk', amount: 20, capacity: 20, unit: 'L', status: 'good', lowThreshold: 5, criticalThreshold: 2 },
        { id: 'milk_skim', name: 'Skim Milk', amount: 10, capacity: 10, unit: 'L', status: 'good', lowThreshold: 3, criticalThreshold: 1 },
        { id: 'milk_almond', name: 'Almond Milk', amount: 5, capacity: 5, unit: 'L', status: 'good', lowThreshold: 2, criticalThreshold: 1 },
        { id: 'milk_soy', name: 'Soy Milk', amount: 5, capacity: 5, unit: 'L', status: 'good', lowThreshold: 2, criticalThreshold: 1 }
      ],
      coffee: [
        { id: 'coffee_house', name: 'House Blend', amount: 5, capacity: 5, unit: 'kg', status: 'good', lowThreshold: 1.5, criticalThreshold: 0.5 },
        { id: 'coffee_dark', name: 'Dark Roast', amount: 3, capacity: 3, unit: 'kg', status: 'good', lowThreshold: 1, criticalThreshold: 0.3 },
        { id: 'coffee_decaf', name: 'Decaf Blend', amount: 2, capacity: 2, unit: 'kg', status: 'good', lowThreshold: 0.5, criticalThreshold: 0.2 }
      ],
      cups: [
        { id: 'cups_small', name: 'Small Cups', amount: 200, capacity: 200, unit: 'pcs', status: 'good', lowThreshold: 50, criticalThreshold: 20 },
        { id: 'cups_medium', name: 'Medium Cups', amount: 200, capacity: 200, unit: 'pcs', status: 'good', lowThreshold: 50, criticalThreshold: 20 },
        { id: 'cups_large', name: 'Large Cups', amount: 100, capacity: 100, unit: 'pcs', status: 'good', lowThreshold: 30, criticalThreshold: 10 }
      ],
      syrups: [
        { id: 'syrup_vanilla', name: 'Vanilla Syrup', amount: 2, capacity: 2, unit: 'L', status: 'good', lowThreshold: 0.5, criticalThreshold: 0.2 },
        { id: 'syrup_caramel', name: 'Caramel Syrup', amount: 2, capacity: 2, unit: 'L', status: 'good', lowThreshold: 0.5, criticalThreshold: 0.2 },
        { id: 'syrup_hazelnut', name: 'Hazelnut Syrup', amount: 1, capacity: 1, unit: 'L', status: 'good', lowThreshold: 0.3, criticalThreshold: 0.1 }
      ],
      sweeteners: [
        { id: 'sugar_white', name: 'White Sugar', amount: 5, capacity: 5, unit: 'kg', status: 'good', lowThreshold: 1, criticalThreshold: 0.5 },
        { id: 'sugar_brown', name: 'Brown Sugar', amount: 3, capacity: 3, unit: 'kg', status: 'good', lowThreshold: 0.8, criticalThreshold: 0.3 },
        { id: 'sweetener_packets', name: 'Sweetener Packets', amount: 500, capacity: 500, unit: 'pcs', status: 'good', lowThreshold: 100, criticalThreshold: 50 },
        { id: 'honey', name: 'Honey', amount: 2, capacity: 2, unit: 'L', status: 'good', lowThreshold: 0.5, criticalThreshold: 0.2 }
      ],
      drinks: [
        { id: 'hot_chocolate_powder', name: 'Hot Chocolate Powder', amount: 3, capacity: 3, unit: 'kg', status: 'good', lowThreshold: 0.8, criticalThreshold: 0.3 },
        { id: 'chai_latte_mix', name: 'Chai Latte Mix', amount: 2, capacity: 2, unit: 'kg', status: 'good', lowThreshold: 0.5, criticalThreshold: 0.2 },
        { id: 'matcha_powder', name: 'Matcha Powder', amount: 1, capacity: 1, unit: 'kg', status: 'good', lowThreshold: 0.3, criticalThreshold: 0.1 }
      ],
      other: [
        { id: 'napkins', name: 'Napkins', amount: 1000, capacity: 1000, unit: 'pcs', status: 'good', lowThreshold: 200, criticalThreshold: 100 }
      ]
    };
  }
  
  /**
   * Initialize service for a specific station
   * @param {number|string} stationId - Station ID
   * @param {string} stationName - Station name
   */
  initialize(stationId, stationName) {
    console.log(`Initializing StockService for station: ${stationId} (${stationName})`);
    
    // Normalize station ID to ensure consistent storage keys
    this.stationId = typeof stationId === 'string' ? parseInt(stationId, 10) : stationId;
    this.stationName = stationName;
    this.initialized = true;
    
    // Load initial stock data for this station
    this._loadLocalStockData();
  }
  
  /**
   * Helper method to normalize milk type IDs between different formats
   * @param {string} milkId - The milk ID to normalize
   * @returns {string[]} - Array of possible normalized IDs
   * @private
   */
  _normalizeMilkId(milkId) {
    const results = new Set();
    if (!milkId) return Array.from(results);
    
    // Add original ID
    results.add(milkId);
    
    // Add mapped ID if available
    if (this.milkTypeMap[milkId]) {
      results.add(this.milkTypeMap[milkId]);
    }
    
    // Add version with prefix if not present
    if (!milkId.startsWith('milk_')) {
      results.add(`milk_${milkId}`);
    }
    
    // Add version without prefix if present
    if (milkId.startsWith('milk_')) {
      results.add(milkId.substring(5));
    }
    
    return Array.from(results);
  }
  
  /**
   * Get the localStorage key for station-specific stock data
   * @returns {string} - The localStorage key
   * @private
   */
  _getStationStockKey() {
    return `coffee_stock_station_${this.stationId}`;
  }
  
  /**
   * Load stock data for the current station from localStorage
   * If no data exists, initialize with default values
   * @returns {Object} - The loaded stock data
   * @private
   */
  _loadLocalStockData() {
    if (!this.initialized) {
      console.warn('StockService not initialized for a station, cannot load local stock data');
      return null;
    }
    
    try {
      console.log(`🔍 Loading stock data for station ${this.stationId} (${this.stationName})`);
      
      // FIXED: First check local storage for depleted stock levels (current reality)
      const stockKey = this._getStationStockKey();
      const savedStock = localStorage.getItem(stockKey);
      console.log(`💾 Local storage stock key: ${stockKey}, data:`, savedStock ? 'exists' : 'not found');
      
      let stationStock = null;
      
      if (savedStock) {
        // If local data exists, use it (this contains actual depleted levels)
        stationStock = JSON.parse(savedStock);
        console.log(`✅ Using existing local stock data for station ${this.stationId} (preserves depletion)`);
      } else {
        console.log(`🔄 No local stock found, trying integration service for station ${this.stationId}`);
        
        // Only if no local data exists, try to get stock data from the inventory integration service
        stationStock = InventoryIntegrationService.getStationStock(this.stationId);
        console.log(`📦 Integration service stock for station ${this.stationId}:`, stationStock);
        
        if (!stationStock) {
          console.log(`🔄 No integration stock found, trying manual sync for station ${this.stationId}`);
          
          // Try to sync from organiser inventory
          const syncResult = InventoryIntegrationService.forceSyncStation(this.stationId);
          
          if (syncResult) {
            // Try to get the synced data
            stationStock = InventoryIntegrationService.getStationStock(this.stationId);
            console.log(`📦 Post-sync stock for station ${this.stationId}:`, stationStock);
          }
          
          if (!stationStock) {
            // Last resort: use defaults
            stationStock = { ...this.defaultStockItems };
            console.log(`⚠️ Using default stock items for station ${this.stationId} - no organiser data found`);
          }
        }
        
        // Save the new data to local storage for persistence
        if (stationStock) {
          console.log(`💾 Saving initial stock data to localStorage for station ${this.stationId}`);
          this._saveLocalStockData(stationStock);
        }
      }
      
      console.log(`📊 Final stock data for station ${this.stationId}:`, stationStock);
      
      // Notify listeners
      this._notifyListeners(stationStock);
      
      return stationStock;
    } catch (error) {
      console.error(`❌ Error loading stock data for station ${this.stationId}:`, error);
      const fallbackStock = { ...this.defaultStockItems };
      console.log(`🔧 Using fallback stock for station ${this.stationId}:`, fallbackStock);
      return fallbackStock;
    }
  }
  
  /**
   * Save stock data for the current station to localStorage
   * @param {Object} stockData - The stock data to save
   * @returns {boolean} - Success status
   * @private
   */
  _saveLocalStockData(stockData) {
    if (!this.initialized) {
      console.warn('StockService not initialized for a station, cannot save local stock data');
      return false;
    }
    
    try {
      // Save the station-specific stock data
      const stockKey = this._getStationStockKey();
      localStorage.setItem(stockKey, JSON.stringify(stockData));
      
      // Notify listeners
      this._notifyListeners(stockData);
      
      console.log(`Saved stock data for station ${this.stationId}`);
      return true;
    } catch (error) {
      console.error('Error saving local stock data:', error);
      return false;
    }
  }
  
  /**
   * Add a listener for stock data updates
   * @param {Function} listener - Callback function
   * @returns {Function} - Function to remove the listener
   */
  addListener(listener) {
    if (typeof listener === 'function' && !this.listeners.includes(listener)) {
      this.listeners.push(listener);
    }
    
    // Return function to remove this listener
    return () => {
      this.removeListener(listener);
    };
  }
  
  /**
   * Remove a listener
   * @param {Function} listener - Listener to remove
   */
  removeListener(listener) {
    const index = this.listeners.indexOf(listener);
    if (index !== -1) {
      this.listeners.splice(index, 1);
    }
  }
  
  /**
   * Notify all listeners of stock data updates
   * @param {Object} stockData - Updated stock data
   * @private
   */
  _notifyListeners(stockData) {
    this.listeners.forEach(listener => {
      try {
        listener(stockData);
      } catch (error) {
        console.error('Error notifying stock listener:', error);
      }
    });
  }
  
  /**
   * Get all stock items for the current station
   * @returns {Object} - All stock items by category
   */
  getLocalStock() {
    console.log('StockService.getLocalStock() called');
    console.log('Current station ID:', this.stationId);
    console.log('Initialized:', this.initialized);
    
    const stockData = this._loadLocalStockData();
    console.log('Loaded stock data:', stockData);
    
    return stockData;
  }
  
  /**
   * Get stock items for a specific category from local storage
   * @param {string} category - The stock category to retrieve
   * @returns {Array} - Stock items for the category
   */
  getLocalCategoryStock(category) {
    const allStock = this._loadLocalStockData();
    return allStock[category] || [];
  }
  
  /**
   * Update a stock item's amount in local storage
   * @param {string} category - The category the item belongs to
   * @param {string} itemId - The ID of the item to update
   * @param {number} newAmount - The new amount
   * @returns {boolean} - Success status
   */
  updateLocalStockAmount(category, itemId, newAmount) {
    try {
      // Get current stock data
      const stockData = this._loadLocalStockData();
      
      // Find the category and item
      if (!stockData[category]) {
        console.error(`Category ${category} not found`);
        return false;
      }
      
      // Find item index
      const itemIndex = stockData[category].findIndex(item => item.id === itemId);
      if (itemIndex === -1) {
        console.error(`Item ${itemId} not found in ${category}`);
        return false;
      }
      
      // Parse and validate the new amount
      let parsedAmount;
      if (typeof newAmount === 'string') {
        parsedAmount = parseFloat(newAmount);
        if (isNaN(parsedAmount)) {
          console.error('Invalid amount value:', newAmount);
          return false;
        }
      } else {
        parsedAmount = newAmount;
      }
      
      // Update amount (ensure it's within valid range)
      parsedAmount = Math.max(0, Math.min(parsedAmount, stockData[category][itemIndex].capacity));
      stockData[category][itemIndex].amount = parsedAmount;
      
      // Update status based on thresholds
      if (parsedAmount <= stockData[category][itemIndex].criticalThreshold) {
        stockData[category][itemIndex].status = 'danger';
      } else if (parsedAmount <= stockData[category][itemIndex].lowThreshold) {
        stockData[category][itemIndex].status = 'warning';
      } else {
        stockData[category][itemIndex].status = 'good';
      }
      
      // Save updated data
      this._saveLocalStockData(stockData);
      
      return true;
    } catch (error) {
      console.error('Error updating local stock amount:', error);
      return false;
    }
  }
  
  /**
   * Get available milk types for the current station
   * @returns {Array} - Array of milk items that are available (amount > 0) at this station
   */
  getAvailableMilkTypes() {
    if (!this.initialized) {
      console.warn('StockService not initialized for a station, cannot get available milk types');
      return [];
    }
    
    try {
      // Get current stock data
      const stockData = this._loadLocalStockData();
      
      // Get milk items with amount > 0
      if (!stockData.milk || !Array.isArray(stockData.milk)) {
        console.warn(`StockService: Station ${this.stationId} has no milk inventory!`);
        return [];
      }
      
      // Log all milk items for debugging
      console.log(`StockService: Station ${this.stationId} has ${stockData.milk.length} total milk items:`,
        stockData.milk.map(m => `${m.name} (${m.id}): ${m.amount} ${m.unit}`));
      
      // Return ONLY the milk items with amount > 0
      const availableMilkItems = stockData.milk.filter(item => 
        typeof item.amount === 'number' && item.amount > 0
      );
      
      // Log zero quantity milk items for debugging
      const zeroMilkItems = stockData.milk.filter(item => 
        typeof item.amount !== 'number' || item.amount <= 0
      );
      
      if (zeroMilkItems.length > 0) {
        console.log(`StockService: Station ${this.stationId} has ${zeroMilkItems.length} milk types with zero quantity:`, 
          zeroMilkItems.map(m => `${m.name} (${m.id}): ${m.amount} ${m.unit}`));
      }
      
      // Log available milk items for debugging
      console.log(`StockService: Station ${this.stationId} has ${availableMilkItems.length} milk types AVAILABLE:`, 
        availableMilkItems.map(m => `${m.name} (${m.id}): ${m.amount} ${m.unit}`));
      
      return availableMilkItems;
    } catch (error) {
      console.error('Error getting available milk types:', error);
      return [];
    }
  }
  
  /**
   * Get available coffee types for the current station
   * @returns {Array} - Array of coffee items that are available (amount > 0) at this station
   */
  getAvailableCoffeeTypes() {
    if (!this.initialized) {
      console.warn('StockService not initialized for a station, cannot get available coffee types');
      return [];
    }
    
    try {
      // Get current stock data
      const stockData = this._loadLocalStockData();
      
      // Get coffee items with amount > 0
      if (!stockData.coffee || !Array.isArray(stockData.coffee)) {
        console.warn(`StockService: Station ${this.stationId} has no coffee inventory!`);
        return [];
      }
      
      // Log all coffee items for debugging
      console.log(`StockService: Station ${this.stationId} has ${stockData.coffee.length} total coffee items:`,
        stockData.coffee.map(c => `${c.name} (${c.id}): ${c.amount} ${c.unit}`));
      
      // Return ONLY the coffee items with amount > 0
      const availableCoffeeItems = stockData.coffee.filter(item => 
        typeof item.amount === 'number' && item.amount > 0
      );
      
      // Log zero quantity coffee items for debugging
      const zeroCoffeeItems = stockData.coffee.filter(item => 
        typeof item.amount !== 'number' || item.amount <= 0
      );
      
      if (zeroCoffeeItems.length > 0) {
        console.log(`StockService: Station ${this.stationId} has ${zeroCoffeeItems.length} coffee types with zero quantity:`, 
          zeroCoffeeItems.map(c => `${c.name} (${c.id}): ${c.amount} ${c.unit}`));
      }
      
      // Log available coffee items for debugging
      console.log(`StockService: Station ${this.stationId} has ${availableCoffeeItems.length} coffee types AVAILABLE:`, 
        availableCoffeeItems.map(c => `${c.name} (${c.id}): ${c.amount} ${c.unit}`));
      
      return availableCoffeeItems;
    } catch (error) {
      console.error('Error getting available coffee types:', error);
      return [];
    }
  }

  /**
   * Get available cup sizes for the current station
   * @returns {Object} - Object with size keys (small, regular, large) and boolean values
   */
  getAvailableCupSizes() {
    if (!this.initialized) {
      console.warn('StockService not initialized for a station, cannot get available cup sizes');
      return { small: true, regular: true, large: true };
    }
    
    try {
      // Get current stock data
      const stockData = this._loadLocalStockData();
      
      // Default to all sizes unavailable
      const result = { small: false, regular: false, large: false };
      
      // Get cup items with amount > 0
      if (!stockData.cups || !Array.isArray(stockData.cups)) {
        console.warn(`StockService: Station ${this.stationId} has no cups inventory!`);
        // Default to regular cup size available if no cups inventory
        return { small: false, regular: true, large: false };
      }
      
      // Log all cup items for debugging
      console.log(`StockService: Station ${this.stationId} has ${stockData.cups.length} total cup items:`,
        stockData.cups.map(c => `${c.name} (${c.id}): ${c.amount} ${c.unit}`));
      
      // Get ONLY the cup items with amount > 0
      const availableCups = stockData.cups.filter(item => 
        typeof item.amount === 'number' && item.amount > 0
      );
      
      // Log zero quantity cup items for debugging
      const zeroCups = stockData.cups.filter(item => 
        typeof item.amount !== 'number' || item.amount <= 0
      );
      
      if (zeroCups.length > 0) {
        console.log(`StockService: Station ${this.stationId} has ${zeroCups.length} cup types with zero quantity:`, 
          zeroCups.map(c => `${c.name} (${c.id}): ${c.amount} ${c.unit}`));
      }
      
      // Check which cup sizes are available
      availableCups.forEach(item => {
        // Match by ID
        if (item.id === 'cups_small') result.small = true;
        if (item.id === 'cups_medium') result.regular = true;
        if (item.id === 'cups_large') result.large = true;
        
        // Also match by name for robustness
        const nameLower = item.name.toLowerCase();
        if (nameLower.includes('small')) result.small = true;
        if (nameLower.includes('medium') || nameLower.includes('regular')) result.regular = true;
        if (nameLower.includes('large')) result.large = true;
      });
      
      // Ensure at least one size is available
      const anyAvailable = result.small || result.regular || result.large;
      if (!anyAvailable) {
        console.warn('No cup sizes available, defaulting to Regular');
        result.regular = true; // Default to regular if nothing available
      }
      
      console.log(`StockService: Station ${this.stationId} has these cup sizes available:`, 
        Object.entries(result)
          .filter(([_, available]) => available)
          .map(([size]) => size)
          .join(', '));
      
      return result;
    } catch (error) {
      console.error('Error getting available cup sizes:', error);
      // Default to regular cup size available on error
      return { small: false, regular: true, large: false };
    }
  }
  
  /**
   * Add a new stock item to local storage
   * @param {string} category - The category to add the item to
   * @param {Object} itemData - The item data
   * @returns {boolean} - Success status
   */
  addLocalStockItem(category, itemData) {
    try {
      // Get current stock data
      const stockData = this._loadLocalStockData();
      
      // Create or ensure category exists
      if (!stockData[category]) {
        stockData[category] = [];
      }
      
      // Generate ID if not provided
      if (!itemData.id) {
        itemData.id = `${category}_${Date.now()}`;
      }
      
      // Add default values if not provided
      const newItem = {
        capacity: itemData.amount || 0,
        status: 'good',
        lowThreshold: itemData.capacity ? itemData.capacity * 0.25 : 0,
        criticalThreshold: itemData.capacity ? itemData.capacity * 0.1 : 0,
        ...itemData
      };
      
      // Add item to category
      stockData[category].push(newItem);
      
      // Save updated data
      this._saveLocalStockData(stockData);
      
      return true;
    } catch (error) {
      console.error('Error adding local stock item:', error);
      return false;
    }
  }
  
  /**
   * Delete a stock item from local storage
   * @param {string} category - The category containing the item
   * @param {string} itemId - The ID of the item to delete
   * @returns {boolean} - Success status
   */
  deleteLocalStockItem(category, itemId) {
    try {
      // Get current stock data
      const stockData = this._loadLocalStockData();
      
      // Find the category and item
      if (!stockData[category]) {
        console.error(`Category ${category} not found`);
        return false;
      }
      
      // Remove item
      stockData[category] = stockData[category].filter(item => item.id !== itemId);
      
      // Save updated data
      this._saveLocalStockData(stockData);
      
      return true;
    } catch (error) {
      console.error('Error deleting local stock item:', error);
      return false;
    }
  }
  
  /**
   * Reset stock data for the current station to defaults
   * @returns {boolean} - Success status
   */
  resetStationStock() {
    try {
      this._saveLocalStockData({ ...this.defaultStockItems });
      return true;
    } catch (error) {
      console.error('Error resetting station stock data:', error);
      return false;
    }
  }

  /**
   * Deplete stock based on completed order
   * @param {Object} order - The completed order
   * @returns {boolean} - Success status
   */
  depleteStockForOrder(order) {
    if (!this.initialized) {
      console.warn('StockService not initialized, cannot deplete stock');
      return false;
    }

    try {
      console.log(`🔥 DEPLETING STOCK for order: ${order.customerName} - ${order.coffeeType} at station ${this.stationId}`);
      
      const stockData = this._loadLocalStockData();
      if (!stockData) {
        console.warn('No stock data available for depletion');
        return false;
      }

      let stockUpdated = false;

      // Deplete coffee based on shots (default 1 shot = 0.01kg coffee)
      const shots = order.shots || 1;
      const coffeeUsage = shots * 0.01; // 10g per shot
      
      if (stockData.coffee && stockData.coffee.length > 0) {
        // Use the first available coffee (house blend)
        const coffeeItem = stockData.coffee[0];
        if (coffeeItem.amount >= coffeeUsage) {
          coffeeItem.amount = Math.max(0, coffeeItem.amount - coffeeUsage);
          stockUpdated = true;
          console.log(`Depleted ${coffeeUsage}kg coffee (${shots} shots). Remaining: ${coffeeItem.amount}kg`);
        }
      }

      // Deplete milk if order contains milk
      if (order.milkType && order.milkType !== 'No milk' && order.milkTypeId !== 'no_milk') {
        const milkUsage = this._getMilkUsageForSize(order.coffeeType);
        
        if (stockData.milk && stockData.milk.length > 0) {
          // Find the specific milk type or use the first available
          let milkItem = stockData.milk.find(item => 
            item.id === order.milkTypeId || 
            item.name.toLowerCase().includes(order.milkType.toLowerCase())
          );
          
          if (!milkItem) {
            // Fallback to first milk item
            milkItem = stockData.milk[0];
          }
          
          if (milkItem && milkItem.amount >= milkUsage) {
            milkItem.amount = Math.max(0, milkItem.amount - milkUsage);
            stockUpdated = true;
            console.log(`Depleted ${milkUsage}L ${milkItem.name}. Remaining: ${milkItem.amount}L`);
          }
        }
      }

      // Deplete cups based on size
      const cupUsage = 1; // One cup per order
      const cupSize = this._getCupSizeFromOrder(order.coffeeType);
      
      if (stockData.cups && stockData.cups.length > 0) {
        let cupItem = stockData.cups.find(item => 
          item.name.toLowerCase().includes(cupSize.toLowerCase())
        );
        
        if (!cupItem) {
          // Fallback to first cup item
          cupItem = stockData.cups[0];
        }
        
        if (cupItem && cupItem.amount >= cupUsage) {
          cupItem.amount = Math.max(0, cupItem.amount - cupUsage);
          stockUpdated = true;
          console.log(`Depleted ${cupUsage} ${cupItem.name}. Remaining: ${cupItem.amount} cups`);
        }
      }

      // Save updated stock if any changes were made
      if (stockUpdated) {
        console.log(`💾 Saving depleted stock data to localStorage for station ${this.stationId}`);
        this._saveLocalStockData(stockData);
        console.log('✅ Stock depletion completed successfully and saved to localStorage');
        return true;
      } else {
        console.log('❌ No stock items were depleted (insufficient stock or items not found)');
        return false;
      }
      
    } catch (error) {
      console.error('Error depleting stock for order:', error);
      return false;
    }
  }

  /**
   * Get milk usage based on coffee size
   * @param {string} coffeeType - The coffee type (includes size)
   * @returns {number} - Milk usage in liters
   * @private
   */
  _getMilkUsageForSize(coffeeType) {
    const type = coffeeType.toLowerCase();
    
    if (type.includes('large')) {
      return 0.25; // 250ml for large
    } else if (type.includes('small')) {
      return 0.15; // 150ml for small
    } else {
      return 0.20; // 200ml for regular/medium
    }
  }

  /**
   * Get cup size from coffee type
   * @param {string} coffeeType - The coffee type (includes size)
   * @returns {string} - Cup size
   * @private
   */
  _getCupSizeFromOrder(coffeeType) {
    const type = coffeeType.toLowerCase();
    
    if (type.includes('large')) {
      return 'large';
    } else if (type.includes('small')) {
      return 'small';
    } else {
      return 'medium'; // Default to medium for regular
    }
  }
  
  /**
   * Set JWT token for authenticated requests
   * @param {string} token - JWT token
   */
  setToken(token) {
    // Call parent method
    super.setToken(token);
    
    if (this.debugMode) {
      console.log(token ? 'Token set successfully in StockService' : 'Token cleared in StockService');
    }
  }

  /**
   * Get all inventory items, optionally filtered by category
   * @param {string} category - Optional category filter
   * @param {number} stationId - Optional station ID filter
   * @returns {Promise<Array>} - List of inventory items
   */
  async getInventoryItems(category = null, stationId = null) {
    try {
      let endpoint = '/inventory';
      
      // Add query parameters if provided
      const params = [];
      
      if (category) {
        params.push(`category=${encodeURIComponent(category)}`);
      }
      
      if (stationId) {
        params.push(`station_id=${encodeURIComponent(stationId)}`);
      }
      
      if (params.length > 0) {
        endpoint += '?' + params.join('&');
      }
      
      if (this.debugMode) {
        console.log(`Fetching inventory items from: ${endpoint}`);
      }
      
      const response = await this.get(endpoint);
      
      if (response && response.success && Array.isArray(response.items)) {
        if (this.debugMode) {
          console.log(`Received ${response.items.length} inventory items`);
        }
        return response.items;
      }
      
      // Log what we got if it's not the expected format
      if (this.debugMode && response) {
        console.warn('Unexpected API response format:', response);
      }
      
      if (Array.isArray(response)) {
        // Handle case where API returns just an array
        return response;
      }
      
      return [];
    } catch (error) {
      console.error('Failed to fetch inventory items:', error);
      if (this.enableFallback) {
        console.log('Using fallback inventory data');
        return this._getFallbackInventory(category);
      }
      // Return empty array instead of throwing to prevent UI crash
      return [];
    }
  }

  /**
   * Get a specific inventory item
   * @param {number} itemId - Item ID
   * @returns {Promise<Object>} - Item details including history
   */
  async getInventoryItem(itemId) {
    try {
      const response = await this.get(`/inventory/${itemId}`);
      
      if (response && response.success) {
        return response;
      }
      
      throw new Error(response?.error || 'Failed to fetch inventory item');
    } catch (error) {
      console.error(`Failed to fetch inventory item ${itemId}:`, error);
      throw error;
    }
  }

  /**
   * Get low stock items
   * @param {number} stationId - Optional station ID filter
   * @returns {Promise<Array>} - List of items below threshold
   */
  async getLowStockItems(stationId = null) {
    try {
      let endpoint = '/inventory/low-stock';
      
      if (stationId) {
        endpoint += `?station_id=${encodeURIComponent(stationId)}`;
      }
      
      if (this.debugMode) {
        console.log(`Fetching low stock items from: ${endpoint}`);
      }
      
      const response = await this.get(endpoint);
      
      if (response && response.success && Array.isArray(response.items)) {
        if (this.debugMode) {
          console.log(`Received ${response.items.length} low stock items`);
        }
        return response.items;
      }
      
      // Handle different response formats
      if (this.debugMode && response) {
        console.warn('Unexpected API response format for low stock items:', response);
      }
      
      if (Array.isArray(response)) {
        // Handle case where API returns just an array
        return response;
      }
      
      return [];
    } catch (error) {
      console.error('Failed to fetch low stock items:', error);
      // Do not fall back to mock data
      return [];
    }
  }

  /**
   * Get inventory categories
   * @returns {Promise<Array>} - List of categories
   */
  async getCategories() {
    try {
      const response = await this.get('/inventory/categories');
      
      if (response && response.success && Array.isArray(response.categories)) {
        return response.categories;
      }
      
      // Default categories if API doesn't provide them
      return ['milk', 'coffee', 'cups', 'syrups', 'sweeteners', 'drinks', 'other'];
    } catch (error) {
      console.error('Failed to fetch inventory categories:', error);
      // Default categories
      return ['milk', 'coffee', 'cups', 'syrups', 'sweeteners', 'drinks', 'other'];
    }
  }

  /**
   * Update item quantity
   * @param {number} itemId - Item ID
   * @param {number} newAmount - New quantity
   * @param {string} reason - Reason for adjustment
   * @param {string} notes - Optional notes
   * @returns {Promise<Object>} - Updated item
   */
  async updateItemQuantity(itemId, newAmount, reason = 'manual_adjustment', notes = '') {
    try {
      // Match the backend API expectation: the backend uses 'new_amount' and 'change_reason'
      const response = await this.post(`/inventory/${itemId}/adjust`, {
        new_amount: newAmount,
        change_reason: reason,
        notes
      });
      
      if (response && response.success) {
        return response.item;
      }
      
      throw new Error(response?.error || 'Failed to update item quantity');
    } catch (error) {
      console.error(`Failed to update quantity for item ${itemId}:`, error);
      throw error;
    }
  }

  /**
   * Add new inventory item
   * @param {Object} itemData - Item data
   * @returns {Promise<Object>} - Created item
   */
  async addInventoryItem(itemData) {
    try {
      const response = await this.post('/inventory', itemData);
      
      if (response && response.success) {
        return response.item;
      }
      
      throw new Error(response?.error || 'Failed to create inventory item');
    } catch (error) {
      console.error('Failed to create inventory item:', error);
      throw error;
    }
  }

  /**
   * Update item properties
   * @param {number} itemId - Item ID
   * @param {Object} properties - Properties to update
   * @returns {Promise<Object>} - Updated item
   */
  async updateItemProperties(itemId, properties) {
    try {
      const response = await this.put(`/inventory/${itemId}`, properties);
      
      if (response && response.success) {
        return response.item;
      }
      
      throw new Error(response?.error || 'Failed to update item properties');
    } catch (error) {
      console.error(`Failed to update properties for item ${itemId}:`, error);
      throw error;
    }
  }

  /**
   * Delete inventory item
   * @param {number} itemId - Item ID
   * @returns {Promise<boolean>} - Success status
   */
  async deleteInventoryItem(itemId) {
    try {
      const response = await this.delete(`/inventory/${itemId}`);
      
      if (response && response.success) {
        return true;
      }
      
      throw new Error(response?.error || 'Failed to delete inventory item');
    } catch (error) {
      console.error(`Failed to delete item ${itemId}:`, error);
      throw error;
    }
  }

  /**
   * Report low stock item
   * @param {number} itemId - Item ID
   * @param {string} urgency - Urgency level
   * @param {string} notes - Optional notes
   * @returns {Promise<boolean>} - Success status
   */
  async reportLowStock(itemId, urgency = 'normal', notes = '') {
    try {
      const response = await this.post(`/inventory/${itemId}/report-low`, {
        urgency,
        notes
      });
      
      if (response && response.success) {
        return true;
      }
      
      throw new Error(response?.error || 'Failed to report low stock');
    } catch (error) {
      console.error(`Failed to report low stock for item ${itemId}:`, error);
      throw error;
    }
  }

  /**
   * Request restock
   * @param {Array} items - Items to restock
   * @returns {Promise<Object>} - Response with success status
   */
  async requestRestock(items) {
    try {
      const response = await this.post('/inventory/restock-request', {
        items
      });
      
      if (response) {
        return {
          success: response.success || false,
          message: response.message || '',
          requestId: response.requestId
        };
      }
      
      throw new Error('Failed to request restock');
    } catch (error) {
      console.error('Failed to request restock:', error);
      throw error;
    }
  }
}

// Export singleton instance
export default new StockService();