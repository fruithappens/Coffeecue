// services/MockDataService.js
import { v4 as uuidv4 } from 'uuid';

/**
 * Mock Data Service for demo/test mode
 * 
 * This service simulates backend API responses with realistic dummy data
 * that follows the same structure as the real API responses.
 */
class MockDataService {
  constructor() {
    this.storage = localStorage;
    this.storagePrefix = 'coffee_cue_demo_';
    this.latency = 300; // Simulated network latency in ms
    this.debugMode = true;
    
    // Initialize demo data if not present
    this._initializeData();
  }

  /**
   * Set simulated network latency
   * @param {number} ms - Latency in milliseconds
   */
  setLatency(ms) {
    this.latency = ms;
  }

  /**
   * Enable/disable debug mode
   * @param {boolean} enabled - Whether debug mode is enabled
   */
  setDebugMode(enabled) {
    this.debugMode = enabled;
  }

  /**
   * Resets all demo data to initial values
   */
  resetDemoData() {
    this._clearStorage();
    this._initializeData();
    if (this.debugMode) {
      console.log('Demo data has been reset to initial values');
    }
  }

  /**
   * Simulate GET request with provided sample data
   * @param {string} endpoint - API endpoint 
   * @returns {Promise<any>} - Simulated API response
   */
  async get(endpoint) {
    if (this.debugMode) {
      console.log(`[MockDataService] GET ${endpoint}`);
    }
    
    // Simulate network latency
    await this._simulateLatency();

    // Parse endpoint and get appropriate data
    const normalizedEndpoint = endpoint.startsWith('/') ? endpoint.substring(1) : endpoint;
    const parts = normalizedEndpoint.split('/');
    
    // Handle different endpoints
    if (parts[0] === 'inventory') {
      return this._handleInventoryGet(parts);
    } else if (parts[0] === 'orders') {
      return this._handleOrdersGet(parts);
    } else if (parts[0] === 'settings') {
      return this._handleSettingsGet(parts);
    } else if (parts[0] === 'chat') {
      return this._handleChatGet(parts);
    } else if (parts[0] === 'schedule') {
      return this._handleScheduleGet(parts);
    }
    
    // Return empty data for unknown endpoints
    return [];
  }

  /**
   * Simulate POST request with provided sample data
   * @param {string} endpoint - API endpoint 
   * @param {object} data - Data to be "posted"
   * @returns {Promise<any>} - Simulated API response
   */
  async post(endpoint, data) {
    if (this.debugMode) {
      console.log(`[MockDataService] POST ${endpoint}`, data);
    }
    
    // Simulate network latency
    await this._simulateLatency();

    // Parse endpoint and handle data
    const normalizedEndpoint = endpoint.startsWith('/') ? endpoint.substring(1) : endpoint;
    const parts = normalizedEndpoint.split('/');
    
    // Handle different endpoints
    if (parts[0] === 'inventory') {
      return this._handleInventoryPost(parts, data);
    } else if (parts[0] === 'orders') {
      return this._handleOrdersPost(parts, data);
    } else if (parts[0] === 'settings') {
      return this._handleSettingsPost(parts, data);
    } else if (parts[0] === 'chat') {
      return this._handleChatPost(parts, data);
    } else if (parts[0] === 'schedule') {
      return this._handleSchedulePost(parts, data);
    }
    
    // Generic success response for unknown endpoints
    return { success: true, id: uuidv4() };
  }

  /**
   * Simulate PUT request
   * @param {string} endpoint - API endpoint 
   * @param {object} data - Data to be "put"
   * @returns {Promise<any>} - Simulated API response
   */
  async put(endpoint, data) {
    if (this.debugMode) {
      console.log(`[MockDataService] PUT ${endpoint}`, data);
    }
    
    // Simulate network latency
    await this._simulateLatency();

    // Parse endpoint and handle data
    const normalizedEndpoint = endpoint.startsWith('/') ? endpoint.substring(1) : endpoint;
    const parts = normalizedEndpoint.split('/');
    
    // Handle different endpoints
    if (parts[0] === 'inventory') {
      return this._handleInventoryPut(parts, data);
    } else if (parts[0] === 'orders') {
      return this._handleOrdersPut(parts, data);
    } else if (parts[0] === 'settings') {
      return this._handleSettingsPut(parts, data);
    }
    
    // Generic success response for unknown endpoints
    return { success: true };
  }

  /**
   * Simulate PATCH request
   * @param {string} endpoint - API endpoint 
   * @param {object} data - Data to be "patched"
   * @returns {Promise<any>} - Simulated API response
   */
  async patch(endpoint, data) {
    if (this.debugMode) {
      console.log(`[MockDataService] PATCH ${endpoint}`, data);
    }
    
    // Simulate network latency
    await this._simulateLatency();

    // Parse endpoint and handle data
    const normalizedEndpoint = endpoint.startsWith('/') ? endpoint.substring(1) : endpoint;
    const parts = normalizedEndpoint.split('/');
    
    if (parts.length >= 3 && parts[0] === 'inventory' && parts[2] === 'quantity') {
      // Handle inventory quantity update
      const itemId = parseInt(parts[1]);
      return this._updateInventoryQuantity(itemId, data.amount, data.reason);
    }
    
    // Generic success response for unknown endpoints
    return { success: true };
  }

  /**
   * Simulate DELETE request
   * @param {string} endpoint - API endpoint 
   * @returns {Promise<any>} - Simulated API response
   */
  async delete(endpoint) {
    if (this.debugMode) {
      console.log(`[MockDataService] DELETE ${endpoint}`);
    }
    
    // Simulate network latency
    await this._simulateLatency();

    // Parse endpoint and handle data
    const normalizedEndpoint = endpoint.startsWith('/') ? endpoint.substring(1) : endpoint;
    const parts = normalizedEndpoint.split('/');
    
    if (parts.length >= 2 && parts[0] === 'inventory') {
      // Handle inventory item deletion
      const itemId = parseInt(parts[1]);
      return this._deleteInventoryItem(itemId);
    }
    
    // Generic success response for unknown endpoints
    return { success: true };
  }

  // Private methods
  
  /**
   * Initialize demo data in storage
   * @private
   */
  _initializeData() {
    // Check if data already exists
    if (this.storage.getItem(`${this.storagePrefix}initialized`)) {
      return;
    }
    
    // Initialize inventory data
    const inventoryItems = {
      milk: [
        { id: 1, name: 'Full Cream', amount: 4, unit: 'L', capacity: 5, status: 'good', category: 'milk', lastUpdated: new Date().toISOString() },
        { id: 2, name: 'Skim', amount: 1.5, unit: 'L', capacity: 5, status: 'warning', category: 'milk', lastUpdated: new Date().toISOString() },
        { id: 3, name: 'Soy', amount: 0.5, unit: 'L', capacity: 5, status: 'danger', category: 'milk', lastUpdated: new Date().toISOString() },
        { id: 4, name: 'Almond', amount: 2, unit: 'L', capacity: 5, status: 'good', category: 'milk', lastUpdated: new Date().toISOString() },
        { id: 5, name: 'Oat', amount: 3, unit: 'L', capacity: 5, status: 'good', category: 'milk', lastUpdated: new Date().toISOString() }
      ],
      coffee: [
        { id: 6, name: 'House Blend', amount: 1.2, unit: 'kg', capacity: 2, status: 'warning', category: 'coffee', lastUpdated: new Date().toISOString() },
        { id: 7, name: 'Single Origin', amount: 0.8, unit: 'kg', capacity: 2, status: 'warning', category: 'coffee', lastUpdated: new Date().toISOString() }
      ],
      cups: [
        { id: 8, name: 'Small', amount: 45, unit: '', capacity: 50, status: 'good', category: 'cups', lastUpdated: new Date().toISOString() },
        { id: 9, name: 'Regular', amount: 37, unit: '', capacity: 100, status: 'good', category: 'cups', lastUpdated: new Date().toISOString() },
        { id: 10, name: 'Large', amount: 12, unit: '', capacity: 50, status: 'warning', category: 'cups', lastUpdated: new Date().toISOString() }
      ]
    };
    
    // Initialize orders data with station IDs
    const ordersData = {
      pending: [
        { id: 'order_1', orderNumber: '45284', customerName: 'Emma Davis', coffeeType: 'Large Latte', milkType: 'Soy milk', sugar: '1 sugar', priority: false, createdAt: new Date(Date.now() - 8 * 60000).toISOString(), waitTime: 8, promisedTime: 15, batchGroup: 'latte-soy', stationId: 1 },
        { id: 'order_2', orderNumber: '45285', customerName: 'Thomas Brown', coffeeType: 'Large Latte', milkType: 'Soy milk', sugar: '0 sugar', priority: false, createdAt: new Date(Date.now() - 9 * 60000).toISOString(), waitTime: 9, promisedTime: 15, batchGroup: 'latte-soy', stationId: 1 },
        { id: 'order_3', orderNumber: '45282', customerName: 'Sarah Williams', coffeeType: 'Regular Flat White', milkType: 'Full cream', sugar: '2 sugars', priority: false, createdAt: new Date(Date.now() - 5 * 60000).toISOString(), waitTime: 5, promisedTime: 15, stationId: 1 },
        { id: 'order_4', orderNumber: '45289', customerName: 'Dr. Mark Wilson', coffeeType: 'Double Espresso', milkType: 'No milk', sugar: 'No sugar', priority: true, createdAt: new Date(Date.now() - 2 * 60000).toISOString(), waitTime: 2, promisedTime: 10, stationId: 1 },
        // Orders for station 2
        { id: 'order_5', orderNumber: '45290', customerName: 'Alex Johnson', coffeeType: 'Mocha', milkType: 'Full cream', sugar: '1 sugar', priority: false, createdAt: new Date(Date.now() - 7 * 60000).toISOString(), waitTime: 7, promisedTime: 15, stationId: 2 },
        { id: 'order_6', orderNumber: '45291', customerName: 'Jessica Lee', coffeeType: 'Americano', milkType: 'No milk', sugar: 'No sugar', priority: false, createdAt: new Date(Date.now() - 6 * 60000).toISOString(), waitTime: 6, promisedTime: 15, stationId: 2 }
      ],
      inProgress: [
        { id: 'order_in_progress_1', orderNumber: '45281', customerName: 'Michael Johnson', phoneNumber: '+61 423 555 789', coffeeType: 'Large Cappuccino', milkType: 'Oat milk', sugar: '1 sugar', extraHot: true, priority: true, createdAt: new Date(Date.now() - 3 * 60000).toISOString(), startedAt: new Date().toISOString(), waitTime: 3, promisedTime: 15, stationId: 1 },
        // Orders for station 2
        { id: 'order_in_progress_2', orderNumber: '45283', customerName: 'Emily Carter', phoneNumber: '+61 423 777 888', coffeeType: 'Flat White', milkType: 'Almond milk', sugar: 'No sugar', priority: false, createdAt: new Date(Date.now() - 4 * 60000).toISOString(), startedAt: new Date().toISOString(), waitTime: 4, promisedTime: 15, stationId: 2 }
      ],
      completed: [
        { id: 'order_completed_1', orderNumber: '45266', customerName: 'Emma Johnson', phoneNumber: '+61 423 456 789', coffeeType: 'Large Flat White', milkType: 'Almond milk', completedAt: new Date(Date.now() - 10 * 60000).toISOString(), stationId: 1 },
        { id: 'order_completed_2', orderNumber: '45270', customerName: 'James Cooper', phoneNumber: '+61 432 987 654', coffeeType: 'Regular Cappuccino', milkType: 'Full cream milk', completedAt: new Date(Date.now() - 5 * 60000).toISOString(), stationId: 1 },
        // Orders for station 2
        { id: 'order_completed_3', orderNumber: '45275', customerName: 'David Smith', phoneNumber: '+61 432 111 222', coffeeType: 'Long Black', milkType: 'No milk', completedAt: new Date(Date.now() - 8 * 60000).toISOString(), stationId: 2 },
        { id: 'order_completed_4', orderNumber: '45276', customerName: 'Sophia Wang', phoneNumber: '+61 432 333 444', coffeeType: 'Chai Latte', milkType: 'Oat milk', completedAt: new Date(Date.now() - 6 * 60000).toISOString(), stationId: 2 }
      ]
    };
    
    // Initialize settings data
    const settingsData = {
      system: {
        displayMode: 'landscape',
        soundEnabled: true,
        autoPrintLabels: false,
        stationName: 'Station #3 - Main Hall',
        baristaName: 'Alex Johnson',
        waitTimeWarning: 10,
        displayTimeout: 5,
        autoSendSmsOnComplete: true,
        remindAfterDelay: true,
        reminderDelay: 30,
        showNameOnDisplay: true
      },
      notification: {
        orderReadyTemplate: 'Your coffee is ready for pickup at {station}.',
        reminderTemplate: 'Your coffee has been waiting for {minutes} minutes. Please collect it soon.',
        delayTemplate: 'We\'re running a bit behind. Your coffee will be ready in about {minutes} more minutes.'
      }
    };
    
    // Initialize chat messages
    const chatMessages = [
      { id: 1, sender: 'System', content: 'Welcome to the barista interface', createdAt: new Date(Date.now() - 120 * 60000).toISOString(), isUrgent: false },
      { id: 2, sender: 'Station Manager', content: 'Remember to check milk levels frequently today', createdAt: new Date(Date.now() - 60 * 60000).toISOString(), isUrgent: false },
      { id: 3, sender: 'Support', content: 'New batches of specialty beans have arrived', createdAt: new Date(Date.now() - 15 * 60000).toISOString(), isUrgent: false }
    ];
    
    // Initialize schedule data - each item is marked as demo data
    const scheduleData = {
      today: [
        { id: 1, start: '08:00', end: '10:30', barista: 'Alex Johnson', status: 'active', isDemoData: true },
        { id: 2, start: '10:30', end: '13:00', barista: 'Sarah Williams', status: 'upcoming', isDemoData: true },
        { id: 3, start: '13:00', end: '15:30', barista: 'Michael Chen', status: 'upcoming', isDemoData: true },
        { id: 4, start: '15:30', end: '18:00', barista: 'Alex Johnson', status: 'upcoming', isDemoData: true }
      ],
      breaks: [
        { id: 1, start: '10:00', end: '10:15', barista: 'Alex Johnson', status: 'completed', isDemoData: true },
        { id: 2, start: '12:30', end: '12:45', barista: 'Sarah Williams', status: 'upcoming', isDemoData: true },
        { id: 3, start: '15:00', end: '15:15', barista: 'Michael Chen', status: 'upcoming', isDemoData: true },
        { id: 4, start: '17:00', end: '17:15', barista: 'Alex Johnson', status: 'upcoming', isDemoData: true }
      ],
      rushPeriods: [
        { id: 1, start: '10:30', end: '11:00', reason: 'Morning Tea Break', isDemoData: true },
        { id: 2, start: '12:30', end: '13:30', reason: 'Lunch Break', isDemoData: true },
        { id: 3, start: '15:30', end: '16:00', reason: 'Afternoon Tea Break', isDemoData: true }
      ]
    };
    
    // Save to storage
    this.storage.setItem(`${this.storagePrefix}inventory`, JSON.stringify(inventoryItems));
    this.storage.setItem(`${this.storagePrefix}orders`, JSON.stringify(ordersData));
    this.storage.setItem(`${this.storagePrefix}settings`, JSON.stringify(settingsData));
    this.storage.setItem(`${this.storagePrefix}chat`, JSON.stringify(chatMessages));
    this.storage.setItem(`${this.storagePrefix}schedule`, JSON.stringify(scheduleData));
    
    // Track inventory history
    this.storage.setItem(`${this.storagePrefix}inventory_history`, JSON.stringify([]));
    
    // Mark as initialized
    this.storage.setItem(`${this.storagePrefix}initialized`, 'true');
    
    if (this.debugMode) {
      console.log('Demo data initialized');
    }
  }

  /**
   * Clear all demo data from storage
   * @private
   */
  _clearStorage() {
    Object.keys(this.storage).forEach(key => {
      if (key.startsWith(this.storagePrefix)) {
        this.storage.removeItem(key);
      }
    });
  }

  /**
   * Simulate network latency
   * @private
   * @returns {Promise<void>}
   */
  _simulateLatency() {
    return new Promise(resolve => setTimeout(resolve, this.latency));
  }

  /**
   * Calculate stock status based on amount and capacity
   * @private
   * @param {number} amount - Current amount
   * @param {number} capacity - Maximum capacity
   * @returns {string} - Status (good, warning, danger)
   */
  _calculateStockStatus(amount, capacity) {
    const percentage = (amount / capacity) * 100;
    if (percentage <= 10) return 'danger';
    if (percentage <= 25) return 'warning';
    return 'good';
  }

  /**
   * Handle GET requests for inventory endpoints
   * @private
   * @param {string[]} parts - URL parts
   * @returns {any} - Response data
   */
  _handleInventoryGet(parts) {
    const inventoryData = JSON.parse(this.storage.getItem(`${this.storagePrefix}inventory`));
    
    // Get a specific inventory item
    if (parts.length >= 2 && parts[1] !== 'history') {
      const itemId = parseInt(parts[1]);
      let foundItem = null;
      
      // Search all categories for the item
      for (const category in inventoryData) {
        const item = inventoryData[category].find(i => i.id === itemId);
        if (item) {
          foundItem = { ...item };
          break;
        }
      }
      
      if (foundItem) {
        return foundItem;
      }
      
      // Item not found
      throw new Error('Item not found');
    }
    
    // Get inventory history
    if (parts.length >= 2 && parts[1] === 'history') {
      const history = JSON.parse(this.storage.getItem(`${this.storagePrefix}inventory_history`) || '[]');
      return history;
    }
    
    // Get all inventory items or filter by category
    const categoryParam = new URLSearchParams(parts[1] || '').get('category');
    
    if (categoryParam && inventoryData[categoryParam]) {
      return inventoryData[categoryParam];
    }
    
    // Return all items flattened
    return Object.values(inventoryData).flat();
  }

  /**
   * Handle POST requests for inventory endpoints
   * @private
   * @param {string[]} parts - URL parts
   * @param {object} data - Request data
   * @returns {any} - Response data
   */
  _handleInventoryPost(parts, data) {
    // Add new inventory item
    if (parts.length === 1) {
      const inventoryData = JSON.parse(this.storage.getItem(`${this.storagePrefix}inventory`));
      
      // Generate a new ID (max ID + 1)
      const allItems = Object.values(inventoryData).flat();
      const maxId = allItems.reduce((max, item) => Math.max(max, item.id), 0);
      const newId = maxId + 1;
      
      // Create new item with defaults
      const newItem = {
        id: newId,
        name: data.name,
        category: data.category,
        amount: data.amount || 0,
        unit: data.unit || '',
        capacity: data.capacity,
        status: this._calculateStockStatus(data.amount || 0, data.capacity),
        lastUpdated: new Date().toISOString(),
        notes: data.notes || ''
      };
      
      // Add to appropriate category
      if (!inventoryData[data.category]) {
        inventoryData[data.category] = [];
      }
      
      inventoryData[data.category].push(newItem);
      
      // Save updated inventory
      this.storage.setItem(`${this.storagePrefix}inventory`, JSON.stringify(inventoryData));
      
      return {
        success: true,
        item: newItem
      };
    }
    
    // Report low stock
    if (parts.length === 2 && parts[1] === 'report-low-stock') {
      return {
        success: true,
        alert_id: uuidv4(),
        message: `Low stock report submitted for item ID: ${data.itemId}`
      };
    }
    
    // Request restock
    if (parts.length === 2 && parts[1] === 'restock-request') {
      return {
        success: true,
        restock_id: uuidv4(),
        message: `Restock request submitted for ${data.items.length} items`
      };
    }
    
    return { success: true };
  }

  /**
   * Handle PUT requests for inventory endpoints
   * @private
   * @param {string[]} parts - URL parts
   * @param {object} data - Request data
   * @returns {any} - Response data
   */
  _handleInventoryPut(parts, data) {
    // Update inventory item
    if (parts.length === 2) {
      const itemId = parseInt(parts[1]);
      const inventoryData = JSON.parse(this.storage.getItem(`${this.storagePrefix}inventory`));
      
      // Find and update the item
      let updated = false;
      
      for (const category in inventoryData) {
        const itemIndex = inventoryData[category].findIndex(i => i.id === itemId);
        
        if (itemIndex !== -1) {
          // Update properties
          Object.keys(data).forEach(key => {
            if (key !== 'id' && key !== 'category') { // Don't change id or category
              inventoryData[category][itemIndex][key] = data[key];
            }
          });
          
          // Update last updated timestamp
          inventoryData[category][itemIndex].lastUpdated = new Date().toISOString();
          
          // Recalculate status
          inventoryData[category][itemIndex].status = this._calculateStockStatus(
            inventoryData[category][itemIndex].amount,
            inventoryData[category][itemIndex].capacity
          );
          
          updated = true;
          break;
        }
      }
      
      if (updated) {
        // Save updated inventory
        this.storage.setItem(`${this.storagePrefix}inventory`, JSON.stringify(inventoryData));
        
        return {
          success: true,
          item_id: itemId
        };
      }
      
      // Item not found
      throw new Error('Item not found');
    }
    
    return { success: true };
  }

  /**
   * Update inventory item quantity
   * @private
   * @param {number} itemId - Item ID
   * @param {number} newAmount - New amount
   * @param {string} reason - Reason for change
   * @returns {object} - Result
   */
  _updateInventoryQuantity(itemId, newAmount, reason) {
    const inventoryData = JSON.parse(this.storage.getItem(`${this.storagePrefix}inventory`));
    const history = JSON.parse(this.storage.getItem(`${this.storagePrefix}inventory_history`) || '[]');
    
    // Find the item
    let updated = false;
    let previousAmount = 0;
    
    for (const category in inventoryData) {
      const itemIndex = inventoryData[category].findIndex(i => i.id === itemId);
      
      if (itemIndex !== -1) {
        // Store previous amount
        previousAmount = inventoryData[category][itemIndex].amount;
        
        // Update amount
        inventoryData[category][itemIndex].amount = newAmount;
        
        // Update last updated timestamp
        inventoryData[category][itemIndex].lastUpdated = new Date().toISOString();
        
        // Recalculate status
        inventoryData[category][itemIndex].status = this._calculateStockStatus(
          newAmount,
          inventoryData[category][itemIndex].capacity
        );
        
        updated = true;
        break;
      }
    }
    
    if (updated) {
      // Save updated inventory
      this.storage.setItem(`${this.storagePrefix}inventory`, JSON.stringify(inventoryData));
      
      // Add to history
      const timestamp = new Date().toISOString();
      history.push({
        id: history.length + 1,
        itemId: itemId,
        previousAmount: previousAmount,
        newAmount: newAmount,
        changeAmount: newAmount - previousAmount,
        reason: reason || 'manual_adjustment',
        timestamp: timestamp,
        createdBy: 'demo_user'
      });
      
      // Save history (keep last 100 entries)
      this.storage.setItem(
        `${this.storagePrefix}inventory_history`, 
        JSON.stringify(history.slice(-100))
      );
      
      return {
        success: true,
        item_id: itemId,
        amount: newAmount,
        updated_at: timestamp
      };
    }
    
    // Item not found
    throw new Error('Item not found');
  }

  /**
   * Delete inventory item
   * @private
   * @param {number} itemId - Item ID
   * @returns {object} - Result
   */
  _deleteInventoryItem(itemId) {
    const inventoryData = JSON.parse(this.storage.getItem(`${this.storagePrefix}inventory`));
    
    // Find and remove the item
    let deleted = false;
    
    for (const category in inventoryData) {
      const itemIndex = inventoryData[category].findIndex(i => i.id === itemId);
      
      if (itemIndex !== -1) {
        // Remove item
        inventoryData[category].splice(itemIndex, 1);
        deleted = true;
        break;
      }
    }
    
    if (deleted) {
      // Save updated inventory
      this.storage.setItem(`${this.storagePrefix}inventory`, JSON.stringify(inventoryData));
      
      return {
        success: true,
        item_id: itemId
      };
    }
    
    // Item not found
    throw new Error('Item not found');
  }
  
  /**
   * Handle GET requests for orders endpoints
   * @private
   * @param {string[]} parts - URL parts
   * @returns {any} - Response data
   */
  _handleOrdersGet(parts) {
    const ordersData = JSON.parse(this.storage.getItem(`${this.storagePrefix}orders`));
    
    // Extract stationId from query parameters if present
    let stationId = null;
    if (parts.length > 1) {
      const queryString = parts[1].split('?')[1];
      if (queryString) {
        const params = new URLSearchParams(queryString);
        stationId = params.get('stationId');
        if (stationId) {
          console.log(`[MockDataService] Filtering orders by station ID: ${stationId}`);
        }
      }
    }
    
    // Helper function to filter orders by station
    const filterByStation = (orders) => {
      if (!stationId) return orders;
      
      return orders.filter(order => {
        // Check all possible station ID fields
        return (
          order.stationId === stationId ||
          order.station_id === stationId ||
          order.assignedStation === stationId ||
          order.assigned_station === stationId ||
          order.assigned_to_station === stationId ||
          order.station === stationId ||
          order.barista_station === stationId ||
          // Also try to compare as integers
          order.stationId === parseInt(stationId) ||
          order.station_id === parseInt(stationId)
        );
      });
    };
    
    // Get pending orders
    if (parts.length >= 2 && parts[1].startsWith('pending')) {
      return filterByStation(ordersData.pending);
    }
    
    // Get in-progress orders
    if (parts.length >= 2 && parts[1].startsWith('in-progress')) {
      return filterByStation(ordersData.inProgress);
    }
    
    // Get completed orders
    if (parts.length >= 2 && parts[1].startsWith('completed')) {
      return filterByStation(ordersData.completed);
    }
    
    // Get all orders
    return filterByStation([...ordersData.pending, ...ordersData.inProgress, ...ordersData.completed]);
  }
  
  /**
   * Handle POST requests for orders endpoints
   * @private
   * @param {string[]} parts - URL parts
   * @param {object} data - Request data
   * @returns {any} - Response data
   */
  _handleOrdersPost(parts, data) {
    const ordersData = JSON.parse(this.storage.getItem(`${this.storagePrefix}orders`));
    
    // Start an order (move from pending to in-progress)
    if (parts.length === 3 && parts[2] === 'start') {
      const orderId = parts[1];
      const orderIndex = ordersData.pending.findIndex(o => o.id === orderId || o.orderNumber === orderId);
      
      if (orderIndex !== -1) {
        const order = ordersData.pending[orderIndex];
        
        // Add in-progress properties
        order.startedAt = new Date().toISOString();
        
        // Remove from pending, add to in-progress
        ordersData.pending.splice(orderIndex, 1);
        ordersData.inProgress.push(order);
        
        // Save updated orders
        this.storage.setItem(`${this.storagePrefix}orders`, JSON.stringify(ordersData));
        
        return { success: true };
      }
      
      return { success: false, message: 'Order not found' };
    }
    
    // Complete an order (move from in-progress to completed)
    if (parts.length === 3 && parts[2] === 'complete') {
      const orderId = parts[1];
      const orderIndex = ordersData.inProgress.findIndex(o => o.id === orderId || o.orderNumber === orderId);
      
      if (orderIndex !== -1) {
        const order = ordersData.inProgress[orderIndex];
        
        // Add completed properties
        order.completedAt = new Date().toISOString();
        
        // Remove from in-progress, add to completed
        ordersData.inProgress.splice(orderIndex, 1);
        ordersData.completed.push(order);
        
        // Save updated orders
        this.storage.setItem(`${this.storagePrefix}orders`, JSON.stringify(ordersData));
        
        return { success: true };
      }
      
      return { success: false, message: 'Order not found' };
    }
    
    // Mark order as picked up
    if (parts.length === 3 && parts[2] === 'pickup') {
      const orderId = parts[1];
      const orderIndex = ordersData.completed.findIndex(o => o.id === orderId || o.orderNumber === orderId);
      
      if (orderIndex !== -1) {
        // Add pickedUp properties
        ordersData.completed[orderIndex].pickedUpAt = new Date().toISOString();
        
        // Save updated orders
        this.storage.setItem(`${this.storagePrefix}orders`, JSON.stringify(ordersData));
        
        return { success: true };
      }
      
      return { success: false, message: 'Order not found' };
    }
    
    // Process a batch of orders
    if (parts.length === 2 && parts[1] === 'batch') {
      const orderIds = data.order_ids;
      const action = data.action || 'start';
      
      if (!orderIds || !Array.isArray(orderIds)) {
        return { success: false, message: 'No order IDs provided' };
      }
      
      let processed = 0;
      
      if (action === 'start') {
        // Move matching orders from pending to in-progress
        const updatedPending = [];
        const newInProgress = [...ordersData.inProgress];
        
        ordersData.pending.forEach(order => {
          const orderId = order.id || order.orderNumber;
          
          if (orderIds.includes(orderId)) {
            // Add in-progress properties
            order.startedAt = new Date().toISOString();
            newInProgress.push(order);
            processed++;
          } else {
            updatedPending.push(order);
          }
        });
        
        // Update orders
        ordersData.pending = updatedPending;
        ordersData.inProgress = newInProgress;
      } else if (action === 'complete') {
        // Move matching orders from in-progress to completed
        const updatedInProgress = [];
        const newCompleted = [...ordersData.completed];
        
        ordersData.inProgress.forEach(order => {
          const orderId = order.id || order.orderNumber;
          
          if (orderIds.includes(orderId)) {
            // Add completed properties
            order.completedAt = new Date().toISOString();
            newCompleted.push(order);
            processed++;
          } else {
            updatedInProgress.push(order);
          }
        });
        
        // Update orders
        ordersData.inProgress = updatedInProgress;
        ordersData.completed = newCompleted;
      }
      
      // Save updated orders
      this.storage.setItem(`${this.storagePrefix}orders`, JSON.stringify(ordersData));
      
      return {
        success: true,
        processed: processed,
        total: orderIds.length
      };
    }
    
    // Add walk-in order
    if (parts.length === 2 && parts[1] === 'walk-in') {
      // Generate order ID and number
      const orderNumber = `45${290 + ordersData.pending.length}`;
      const orderId = `order_${ordersData.pending.length + 1}`;
      
      // Create new order
      const newOrder = {
        id: orderId,
        orderNumber: orderNumber,
        customerName: data.customerName,
        coffeeType: data.coffeeType,
        milkType: data.milkType,
        sugar: data.sugar,
        priority: data.priority || false,
        createdAt: new Date().toISOString(),
        waitTime: 0,
        promisedTime: 15
      };
      
      // Add to pending orders
      ordersData.pending.push(newOrder);
      
      // Save updated orders
      this.storage.setItem(`${this.storagePrefix}orders`, JSON.stringify(ordersData));
      
      return {
        success: true,
        id: orderNumber,
        message: `Walk-in order added for ${data.customerName}`
      };
    }
    
    // Send message to customer
    if (parts.length === 3 && parts[2] === 'message') {
      return {
        success: true,
        message: 'Message sent to customer'
      };
    }
    
    return { success: true };
  }

  /**
   * Handle GET requests for settings endpoints
   * @private
   * @param {string[]} parts - URL parts
   * @returns {any} - Response data
   */
  _handleSettingsGet(parts) {
    const settingsData = JSON.parse(this.storage.getItem(`${this.storagePrefix}settings`));
    
    // Get system settings
    if (parts.length === 2 && parts[1] === 'system') {
      return settingsData.system;
    }
    
    // Get notification settings
    if (parts.length === 2 && parts[1] === 'notification') {
      return settingsData.notification;
    }
    
    // Get all settings
    return settingsData;
  }

  /**
   * Handle POST requests for settings endpoints
   * @private
   * @param {string[]} parts - URL parts
   * @param {object} data - Request data
   * @returns {any} - Response data
   */
  _handleSettingsPost(parts, data) {
    const settingsData = JSON.parse(this.storage.getItem(`${this.storagePrefix}settings`));
    
    // Update wait time
    if (parts.length === 2 && parts[1] === 'wait-time') {
      return {
        success: true,
        waitTime: data.waitTime
      };
    }
    
    // Update system settings
    if (parts.length === 2 && parts[1] === 'system') {
      settingsData.system = { ...settingsData.system, ...data };
      this.storage.setItem(`${this.storagePrefix}settings`, JSON.stringify(settingsData));
      
      return {
        success: true,
        settings: settingsData.system
      };
    }
    
    // Update notification settings
    if (parts.length === 2 && parts[1] === 'notification') {
      settingsData.notification = { ...settingsData.notification, ...data };
      this.storage.setItem(`${this.storagePrefix}settings`, JSON.stringify(settingsData));
      
      return {
        success: true,
        settings: settingsData.notification
      };
    }
    
    return { success: true };
  }

  /**
   * Handle GET requests for chat endpoints
   * @private
   * @param {string[]} parts - URL parts
   * @returns {any} - Response data
   */
  _handleChatGet(parts) {
    // Get chat messages
    if (parts.length === 2 && parts[1] === 'messages') {
      const chatMessages = JSON.parse(this.storage.getItem(`${this.storagePrefix}chat`));
      return chatMessages;
    }
    
    return [];
  }

  /**
   * Handle POST requests for chat endpoints
   * @private
   * @param {string[]} parts - URL parts
   * @param {object} data - Request data
   * @returns {any} - Response data
   */
  _handleChatPost(parts, data) {
    // Send chat message
    if (parts.length === 2 && parts[1] === 'messages') {
      const chatMessages = JSON.parse(this.storage.getItem(`${this.storagePrefix}chat`));
      
      // Create new message
      const newMessage = {
        id: chatMessages.length + 1,
        sender: data.sender || 'User',
        content: data.content,
        createdAt: new Date().toISOString(),
        isUrgent: data.isUrgent || false
      };
      
      // Add to messages
      chatMessages.push(newMessage);
      
      // Save updated messages
      this.storage.setItem(`${this.storagePrefix}chat`, JSON.stringify(chatMessages));
      
      return {
        success: true,
        message: newMessage
      };
    }
    
    return { success: true };
  }

  /**
   * Handle GET requests for schedule endpoints
   * @private
   * @param {string[]} parts - URL parts
   * @returns {any} - Response data
   */
  _handleScheduleGet(parts) {
    const scheduleData = JSON.parse(this.storage.getItem(`${this.storagePrefix}schedule`));
    
    // Get list of hidden demo items to filter out
    const hiddenDemoItems = JSON.parse(localStorage.getItem('coffee_cue_hidden_demo_items') || '[]');
    
    // Function to filter out hidden demo items
    const filterHiddenDemoItems = (items) => {
      return items.filter(item => {
        // Keep all real items (not demo data)
        if (!item.isDemoData) return true;
        
        // For demo data items, only keep them if they haven't been manually hidden
        return !hiddenDemoItems.includes(item.id);
      });
    };
    
    // Get today's schedule
    if (parts.length === 2 && parts[1] === 'today') {
      return filterHiddenDemoItems(scheduleData.today);
    }
    
    // Get breaks
    if (parts.length === 2 && parts[1] === 'breaks') {
      return filterHiddenDemoItems(scheduleData.breaks);
    }
    
    // Get rush periods
    if (parts.length === 2 && parts[1] === 'rush-periods') {
      return filterHiddenDemoItems(scheduleData.rushPeriods);
    }
    
    // Get all schedule data with hidden demo items filtered out
    return {
      today: filterHiddenDemoItems(scheduleData.today),
      breaks: filterHiddenDemoItems(scheduleData.breaks),
      rushPeriods: filterHiddenDemoItems(scheduleData.rushPeriods)
    };
  }

  /**
   * Handle POST requests for schedule endpoints
   * @private
   * @param {string[]} parts - URL parts
   * @param {object} data - Request data
   * @returns {any} - Response data
   */
  _handleSchedulePost(parts, data) {
    const scheduleData = JSON.parse(this.storage.getItem(`${this.storagePrefix}schedule`));
    
    // Add shift
    if (parts.length === 2 && parts[1] === 'shifts') {
      // Generate ID
      const newId = Math.max(0, ...scheduleData.today.map(s => s.id)) + 1;
      
      // Create new shift
      const newShift = {
        id: newId,
        start: data.start,
        end: data.end,
        barista: data.barista,
        status: 'upcoming'
      };
      
      // Add to shifts
      scheduleData.today.push(newShift);
      
      // Save updated schedule
      this.storage.setItem(`${this.storagePrefix}schedule`, JSON.stringify(scheduleData));
      
      return {
        success: true,
        shift: newShift
      };
    }
    
    // Add break
    if (parts.length === 2 && parts[1] === 'breaks') {
      // Generate ID
      const newId = Math.max(0, ...scheduleData.breaks.map(b => b.id)) + 1;
      
      // Create new break
      const newBreak = {
        id: newId,
        start: data.start,
        end: data.end,
        barista: data.barista,
        status: 'upcoming'
      };
      
      // Add to breaks
      scheduleData.breaks.push(newBreak);
      
      // Save updated schedule
      this.storage.setItem(`${this.storagePrefix}schedule`, JSON.stringify(scheduleData));
      
      return {
        success: true,
        break: newBreak
      };
    }
    
    return { success: true };
  }
}

export default new MockDataService();