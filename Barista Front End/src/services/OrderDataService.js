// services/OrderDataService.refactored.js
import ApiService from './ApiService';
import { DEFAULT_MILK_TYPES } from '../utils/milkConfig';

/**
 * Refactored OrderDataService that uses APIs with localStorage as fallback only
 */
class OrderDataService {
  constructor() {
    // Get the singleton ApiService instance
    this.apiService = new ApiService();
    this.debugMode = true;
    
    // Cache configuration
    this.cacheTimeout = 60000; // 1 minute cache
    this.cache = new Map();
    
    // WebSocket event subscriptions
    this.setupWebSocketHandlers();
    
    console.log('OrderDataService (refactored) initialized');
  }

  /**
   * Set authentication token
   * @param {string} token - JWT token
   */
  setToken(token) {
    // Pass token to ApiService
    this.apiService.setToken(token);
    
    // Update WebSocket authentication
    this.apiService.updateSocketAuth(token);
    
    // Clear cache when token changes
    this.cache.clear();
    
    if (this.debugMode) {
      console.log('OrderDataService: Token updated');
    }
  }

  /**
   * Setup WebSocket event handlers for real-time updates
   */
  setupWebSocketHandlers() {
    // Subscribe to order events via window events (already dispatched by ApiService)
    window.addEventListener('order_created', (event) => {
      console.log('New order created:', event.detail);
      this.invalidateCache('orders');
      // Re-emit for components that might be listening
      window.dispatchEvent(new CustomEvent('orderCreated', { detail: event.detail }));
    });

    window.addEventListener('order_updated', (event) => {
      console.log('Order updated:', event.detail);
      this.invalidateCache('orders');
      window.dispatchEvent(new CustomEvent('orderUpdated', { detail: event.detail }));
    });

    window.addEventListener('order_completed', (event) => {
      console.log('Order completed:', event.detail);
      this.invalidateCache('orders');
      window.dispatchEvent(new CustomEvent('orderCompleted', { detail: event.detail }));
    });
  }

  /**
   * Get orders from API with caching
   * @param {number} stationId - Station ID to filter orders
   * @returns {Promise<object>} Orders grouped by status
   */
  async getOrders(stationId = null) {
    const cacheKey = `orders_${stationId || 'all'}`;
    
    // Check cache first
    const cached = this.getFromCache(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      // Build query params
      const params = new URLSearchParams();
      if (stationId) {
        params.append('station_id', stationId);
      }

      // Fetch from API
      const response = await this.apiService.get(`/orders?${params.toString()}`);
      
      if (response.status === 'success') {
        const orders = response.data || [];
        
        // Group orders by status
        const groupedOrders = {
          pendingOrders: orders.filter(o => o.status === 'pending'),
          inProgressOrders: orders.filter(o => o.status === 'in_progress'),
          completedOrders: orders.filter(o => o.status === 'completed' || o.status === 'picked_up')
        };

        // Cache the result
        this.setCache(cacheKey, groupedOrders);
        
        // Update localStorage as backup (but don't rely on it)
        this.updateLocalStorageBackup(stationId, groupedOrders);
        
        return groupedOrders;
      }
    } catch (error) {
      console.error('Error fetching orders from API:', error);
      
      // Fallback to localStorage only if API fails
      return this.getOrdersFromLocalStorage(stationId);
    }

    // Default empty structure
    return {
      pendingOrders: [],
      inProgressOrders: [],
      completedOrders: []
    };
  }

  /**
   * Create a new order
   * @param {object} orderData - Order details
   * @returns {Promise<object>} Created order
   */
  async createOrder(orderData) {
    try {
      const response = await this.apiService.post('/orders', orderData);
      
      if (response.status === 'success') {
        // Invalidate cache
        this.invalidateCache('orders');
        
        // Emit WebSocket event for other clients
        this.apiService.sendMessage('order_created', response.data);
        
        return response.data;
      }
      
      throw new Error(response.message || 'Failed to create order');
    } catch (error) {
      console.error('Error creating order:', error);
      
      // Fallback: Create locally and queue for sync
      return this.createOrderLocally(orderData);
    }
  }

  /**
   * Update order status
   * @param {string} orderId - Order ID
   * @param {string} status - New status
   * @param {object} additionalData - Additional data to update
   * @returns {Promise<object>} Updated order
   */
  async updateOrderStatus(orderId, status, additionalData = {}) {
    try {
      const response = await this.apiService.put(`/orders/${orderId}/status`, {
        status,
        ...additionalData
      });
      
      if (response.status === 'success') {
        // Invalidate cache
        this.invalidateCache('orders');
        
        // Try to emit WebSocket event (optional)
        try {
          this.apiService.sendMessage('order_updated', {
            order_id: orderId,
            status,
            ...additionalData
          });
        } catch (error) {
          console.log('WebSocket message send failed (non-critical):', error);
        }
        
        return response.data;
      }
      
      throw new Error(response.message || 'Failed to update order');
    } catch (error) {
      console.error('Error updating order:', error);
      
      // Fallback: Update locally and queue for sync
      return this.updateOrderLocally(orderId, { status, ...additionalData });
    }
  }

  /**
   * Claim an order for a barista
   * @param {string} orderId - Order ID
   * @param {number} baristaId - Barista ID
   * @param {number} stationId - Station ID
   * @returns {Promise<object>} Updated order
   */
  async claimOrder(orderId, baristaId, stationId) {
    try {
      const result = await this.updateOrderStatus(orderId, 'in_progress', {
        barista_id: baristaId,
        station_id: stationId,
        started_at: new Date().toISOString()
      });
      return { success: true, data: result };
    } catch (error) {
      console.error('Error claiming order:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Complete an order
   * @param {string} orderId - Order ID
   * @returns {Promise<object>} Completed order
   */
  async completeOrder(orderId) {
    try {
      const result = await this.updateOrderStatus(orderId, 'completed', {
        completed_at: new Date().toISOString()
      });
      return { success: true, data: result };
    } catch (error) {
      console.error('Error completing order:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get walk-in order settings
   * @returns {Promise<object>} Walk-in settings
   */
  async getWalkInSettings() {
    try {
      const response = await this.apiService.get('/settings/walkin');
      
      if (response.status === 'success') {
        return response.data;
      }
    } catch (error) {
      console.error('Error fetching walk-in settings:', error);
    }

    // Default settings
    return {
      milkTypes: DEFAULT_MILK_TYPES,
      coffeeTypes: ['Flat White', 'Cappuccino', 'Latte', 'Long Black', 'Short Black'],
      sizes: ['Small', 'Regular', 'Large']
    };
  }

  /**
   * Create walk-in order
   * @param {object} orderData - Walk-in order details
   * @returns {Promise<object>} Created order
   */
  async createWalkInOrder(orderData) {
    return this.createOrder({
      ...orderData,
      source: 'walkin',
      priority: true
    });
  }

  // Cache management methods
  
  /**
   * Get data from cache
   * @param {string} key - Cache key
   * @returns {any} Cached data or null
   */
  getFromCache(key) {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      if (this.debugMode) {
        console.log(`Cache hit for ${key}`);
      }
      return cached.data;
    }
    return null;
  }

  /**
   * Set data in cache
   * @param {string} key - Cache key
   * @param {any} data - Data to cache
   */
  setCache(key, data) {
    this.cache.set(key, {
      data,
      timestamp: Date.now()
    });
  }

  /**
   * Invalidate cache entries
   * @param {string} prefix - Cache key prefix to invalidate
   */
  invalidateCache(prefix) {
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }

  // Fallback methods for offline support

  /**
   * Update localStorage backup
   * @param {number} stationId - Station ID
   * @param {object} orders - Orders data
   */
  updateLocalStorageBackup(stationId, orders) {
    try {
      const key = `orders_backup_${stationId || 'all'}`;
      localStorage.setItem(key, JSON.stringify({
        data: orders,
        timestamp: Date.now()
      }));
    } catch (error) {
      console.error('Error updating localStorage backup:', error);
    }
  }

  /**
   * Get orders from localStorage (fallback)
   * @param {number} stationId - Station ID
   * @returns {object} Orders from localStorage
   */
  getOrdersFromLocalStorage(stationId) {
    try {
      const key = `orders_backup_${stationId || 'all'}`;
      const stored = localStorage.getItem(key);
      
      if (stored) {
        const { data } = JSON.parse(stored);
        console.warn('Using localStorage fallback for orders');
        return data;
      }
    } catch (error) {
      console.error('Error reading from localStorage:', error);
    }

    return {
      pendingOrders: [],
      inProgressOrders: [],
      completedOrders: []
    };
  }

  /**
   * Create order locally (offline fallback)
   * @param {object} orderData - Order data
   * @returns {object} Created order
   */
  createOrderLocally(orderData) {
    const order = {
      ...orderData,
      id: `local_${Date.now()}`,
      orderNumber: `L${Date.now().toString().slice(-6)}`,
      createdAt: new Date().toISOString(),
      status: 'pending',
      syncPending: true
    };

    // Queue for sync
    this.queueForSync('create', order);
    
    return order;
  }

  /**
   * Update order locally (offline fallback)
   * @param {string} orderId - Order ID
   * @param {object} updates - Updates to apply
   * @returns {object} Updated order
   */
  updateOrderLocally(orderId, updates) {
    // Queue for sync
    this.queueForSync('update', { orderId, updates });
    
    return { id: orderId, ...updates };
  }

  /**
   * Queue operation for sync when online
   * @param {string} operation - Operation type
   * @param {object} data - Operation data
   */
  queueForSync(operation, data) {
    try {
      const queue = JSON.parse(localStorage.getItem('sync_queue') || '[]');
      queue.push({
        operation,
        data,
        timestamp: Date.now()
      });
      localStorage.setItem('sync_queue', JSON.stringify(queue));
    } catch (error) {
      console.error('Error queuing for sync:', error);
    }
  }

  /**
   * Process sync queue when connection is restored
   */
  async processSyncQueue() {
    try {
      const queue = JSON.parse(localStorage.getItem('sync_queue') || '[]');
      
      for (const item of queue) {
        try {
          if (item.operation === 'create') {
            await this.createOrder(item.data);
          } else if (item.operation === 'update') {
            await this.updateOrderStatus(
              item.data.orderId,
              item.data.updates.status,
              item.data.updates
            );
          }
        } catch (error) {
          console.error('Error processing sync item:', error);
        }
      }
      
      // Clear queue after processing
      localStorage.removeItem('sync_queue');
    } catch (error) {
      console.error('Error processing sync queue:', error);
    }
  }

  // Legacy method compatibility - methods expected by useOrders hook

  /**
   * Check API connection
   * @returns {Promise<boolean>} Connection status
   */
  async checkConnection() {
    try {
      const response = await this.apiService.get('/health');
      return response.status === 'success';
    } catch (error) {
      return false;
    }
  }

  /**
   * Get pending orders
   * @returns {Promise<Array>} Pending orders
   */
  async getPendingOrders() {
    const orders = await this.getOrders();
    return orders.pendingOrders || [];
  }

  /**
   * Get in-progress orders
   * @returns {Promise<Array>} In-progress orders
   */
  async getInProgressOrders() {
    const orders = await this.getOrders();
    return orders.inProgressOrders || [];
  }

  /**
   * Get completed orders
   * @returns {Promise<Array>} Completed orders
   */
  async getCompletedOrders() {
    const orders = await this.getOrders();
    return orders.completedOrders || [];
  }

  /**
   * Update wait time
   * @param {object} waitTimeData - Wait time data
   * @returns {Promise<object>} Result
   */
  async updateWaitTime(waitTimeData) {
    try {
      const response = await this.apiService.put('/settings/wait-time', waitTimeData);
      return { success: response.status === 'success' };
    } catch (error) {
      console.error('Error updating wait time:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Start an order (move to in-progress)
   * @param {object} order - Order to start
   * @param {number} stationId - Station ID
   * @returns {Promise<object>} Result
   */
  async startOrder(order, stationId) {
    try {
      const result = await this.claimOrder(order.id || order.order_id, null, stationId);
      // claimOrder now returns { success, data } format, so just pass it through
      return result;
    } catch (error) {
      console.error('Error starting order:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Mark order as picked up
   * @param {string} orderId - Order ID
   * @returns {Promise<object>} Result
   */
  async markOrderPickedUp(orderId) {
    try {
      const result = await this.updateOrderStatus(orderId, 'picked_up');
      return { success: true, data: result };
    } catch (error) {
      console.error('Error marking order as picked up:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Process batch of orders
   * @param {Array<string>} orderIds - Order IDs
   * @returns {Promise<object>} Result
   */
  async processBatch(orderIds) {
    try {
      const response = await this.apiService.post('/orders/batch/process', { order_ids: orderIds });
      return { success: response.status === 'success', data: response.data };
    } catch (error) {
      console.error('Error processing batch:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Process batch selection
   * @param {Array<string>} orderIds - Selected order IDs
   * @returns {Promise<object>} Result
   */
  async processBatchSelection(orderIds) {
    return this.processBatch(orderIds);
  }

  /**
   * Add walk-in order
   * @param {object} orderData - Walk-in order data
   * @returns {Promise<object>} Result
   */
  async addWalkInOrder(orderData) {
    try {
      const result = await this.createWalkInOrder(orderData);
      return { success: true, data: result };
    } catch (error) {
      console.error('Error adding walk-in order:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send message to customer
   * @param {string} orderId - Order ID
   * @param {string} message - Message to send
   * @returns {Promise<object>} Result
   */
  async sendMessageToCustomer(orderId, message) {
    try {
      const response = await this.apiService.post(`/orders/${orderId}/message`, { message });
      
      // Check both response.success and response.status for compatibility
      const isSuccess = response.success === true || response.status === 'success';
      
      if (isSuccess) {
        return { success: true, data: response };
      } else {
        const errorMessage = response.message || response.error || 'Unknown error';
        return { success: false, message: errorMessage };
      }
    } catch (error) {
      console.error('Error sending message:', error);
      return { success: false, message: error.message };
    }
  }

  /**
   * Delay an order
   * @param {string} orderId - Order ID
   * @param {number} minutes - Minutes to delay
   * @returns {Promise<object>} Result
   */
  async delayOrder(orderId, minutes) {
    try {
      const response = await this.apiService.post(`/orders/${orderId}/delay`, { minutes });
      return { success: response.status === 'success', data: response.data };
    } catch (error) {
      console.error('Error delaying order:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get yesterday's orders
   * @param {number} stationId - Station ID
   * @returns {Promise<object>} Result
   */
  async getYesterdayOrders(stationId) {
    try {
      const params = new URLSearchParams({ 
        station_id: stationId,
        date: 'yesterday' 
      });
      const response = await this.apiService.get(`/orders?${params.toString()}`);
      return { 
        success: response.status === 'success', 
        data: response.data || [] 
      };
    } catch (error) {
      console.error('Error getting yesterday orders:', error);
      return { success: false, data: [] };
    }
  }

  /**
   * Get this week's orders
   * @param {number} stationId - Station ID
   * @returns {Promise<object>} Result
   */
  async getThisWeekOrders(stationId) {
    try {
      const params = new URLSearchParams({ 
        station_id: stationId,
        date: 'week' 
      });
      const response = await this.apiService.get(`/orders?${params.toString()}`);
      return { 
        success: response.status === 'success', 
        orders: response.data || [],
        data: response.data || [] 
      };
    } catch (error) {
      console.error('Error getting week orders:', error);
      return { success: false, orders: [], data: [] };
    }
  }

  /**
   * Search orders
   * @param {string} searchTerm - Search term
   * @param {number} stationId - Station ID
   * @returns {Promise<object>} Result
   */
  async searchOrders(searchTerm, stationId) {
    try {
      const params = new URLSearchParams({ 
        q: searchTerm,
        station_id: stationId 
      });
      const response = await this.apiService.get(`/orders/search?${params.toString()}`);
      return { 
        success: response.status === 'success', 
        orders: response.data || [],
        data: response.data || [] 
      };
    } catch (error) {
      console.error('Error searching orders:', error);
      return { success: false, orders: [], data: [] };
    }
  }

  /**
   * Get order history
   * @param {object} filters - Filter options
   * @returns {Promise<object>} Result
   */
  async getOrderHistory(filters) {
    try {
      const params = new URLSearchParams(filters);
      const response = await this.apiService.get(`/orders/history?${params.toString()}`);
      return { 
        success: response.status === 'success', 
        data: response.data || [] 
      };
    } catch (error) {
      console.error('Error getting order history:', error);
      return { success: false, data: [] };
    }
  }
}

// Create and export singleton instance
const orderDataService = new OrderDataService();
export default orderDataService;