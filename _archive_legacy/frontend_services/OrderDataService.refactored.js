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
   * Setup WebSocket event handlers for real-time updates
   */
  setupWebSocketHandlers() {
    // Subscribe to order events
    this.apiService.on('order_created', (data) => {
      console.log('New order created:', data);
      this.invalidateCache('orders');
      // Emit event for UI update
      window.dispatchEvent(new CustomEvent('orderCreated', { detail: data }));
    });

    this.apiService.on('order_updated', (data) => {
      console.log('Order updated:', data);
      this.invalidateCache('orders');
      window.dispatchEvent(new CustomEvent('orderUpdated', { detail: data }));
    });

    this.apiService.on('order_completed', (data) => {
      console.log('Order completed:', data);
      this.invalidateCache('orders');
      window.dispatchEvent(new CustomEvent('orderCompleted', { detail: data }));
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
          completedOrders: orders.filter(o => o.status === 'completed')
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
        
        // Emit WebSocket event
        this.apiService.sendMessage('order_updated', {
          order_id: orderId,
          status,
          ...additionalData
        });
        
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
    return this.updateOrderStatus(orderId, 'in_progress', {
      barista_id: baristaId,
      station_id: stationId,
      started_at: new Date().toISOString()
    });
  }

  /**
   * Complete an order
   * @param {string} orderId - Order ID
   * @returns {Promise<object>} Completed order
   */
  async completeOrder(orderId) {
    return this.updateOrderStatus(orderId, 'completed', {
      completed_at: new Date().toISOString()
    });
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
}

export default OrderDataService;