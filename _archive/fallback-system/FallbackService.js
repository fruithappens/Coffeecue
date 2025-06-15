/**
 * FallbackService
 * 
 * Provides centralized management of fallback/offline mode and mock data.
 * Extracts the complex fallback logic from other services for better maintainability.
 */

import config from '../config/config';

class FallbackService {
  constructor() {
    this.enabled = localStorage.getItem(config.fallback.modeKey) === 'true';
    this.debug = config.api.debug;
    this.dataAvailable = localStorage.getItem(config.fallback.dataKey) === 'true';
    
    // Initialize fallback data if needed and configured to auto-enable
    if ((this.enabled || config.fallback.enabled) && !this.dataAvailable) {
      this.initializeFallbackData();
    }
    
    this.log('FallbackService initialized, mode:', this.enabled ? 'enabled' : 'disabled');
  }
  
  /**
   * Check if fallback mode is enabled
   * @returns {boolean} - True if fallback mode is enabled
   */
  isEnabled() {
    // Always check localStorage directly to catch changes from other tabs
    return localStorage.getItem(config.fallback.modeKey) === 'true' || 
           config.fallback.enabled === true;
  }
  
  /**
   * Enable fallback mode
   * @param {boolean} persist - Whether to persist the change to localStorage
   */
  enable(persist = true) {
    this.enabled = true;
    
    if (persist) {
      localStorage.setItem(config.fallback.modeKey, 'true');
    }
    
    // Ensure fallback data is available
    if (!this.dataAvailable) {
      this.initializeFallbackData();
    }
    
    this.log('Fallback mode enabled');
    
    // Dispatch event for components to react
    window.dispatchEvent(new CustomEvent('fallback-mode-enabled'));
  }
  
  /**
   * Disable fallback mode
   * @param {boolean} persist - Whether to persist the change to localStorage
   */
  disable(persist = true) {
    this.enabled = false;
    
    if (persist) {
      localStorage.setItem(config.fallback.modeKey, 'false');
    }
    
    this.log('Fallback mode disabled');
    
    // Dispatch event for components to react
    window.dispatchEvent(new CustomEvent('fallback-mode-disabled'));
  }
  
  /**
   * Initialize fallback data if not already available
   */
  initializeFallbackData() {
    try {
      this.log('Initializing fallback data');
      
      // Basic sample data for core endpoints
      const samplePendingOrders = [
        {
          id: 'sample_1',
          orderNumber: 'SP001',
          customerName: 'John Smith',
          coffeeType: 'Large Flat White',
          milkType: 'Regular milk',
          sugar: 'No sugar',
          phoneNumber: '+61412345678',
          createdAt: new Date(Date.now() - 1000 * 60 * 5), // 5 minutes ago
          waitTime: 5,
          promisedTime: 15,
          priority: false,
          status: 'pending',
          stationId: 1
        },
        {
          id: 'sample_2',
          orderNumber: 'SP002',
          customerName: 'Jane Doe',
          coffeeType: 'Medium Cappuccino',
          milkType: 'Almond milk',
          sugar: '1 sugar',
          phoneNumber: '+61412345679',
          createdAt: new Date(Date.now() - 1000 * 60 * 3), // 3 minutes ago
          waitTime: 3,
          promisedTime: 15,
          priority: true,
          status: 'pending',
          stationId: 1
        }
      ];
      
      const sampleInProgressOrders = [
        {
          id: 'sample_4',
          orderNumber: 'SI001',
          customerName: 'Michael Brown',
          coffeeType: 'Large Long Black',
          milkType: 'No milk',
          sugar: 'No sugar',
          phoneNumber: '+61412345681',
          createdAt: new Date(Date.now() - 1000 * 60 * 10), // 10 minutes ago
          waitTime: 10,
          promisedTime: 15,
          priority: false,
          status: 'in-progress',
          stationId: 1
        }
      ];
      
      const sampleCompletedOrders = [
        {
          id: 'sample_6',
          orderNumber: 'SC001',
          customerName: 'David Lee',
          coffeeType: 'Medium Cappuccino',
          milkType: 'Regular milk',
          sugar: 'No sugar',
          phoneNumber: '+61412345683',
          createdAt: new Date(Date.now() - 1000 * 60 * 20), // 20 minutes ago
          completedAt: new Date(Date.now() - 1000 * 60 * 5), // 5 minutes ago
          waitTime: 15,
          promisedTime: 15,
          priority: false,
          status: 'completed',
          stationId: 1
        }
      ];
      
      // Store the sample data
      localStorage.setItem('fallback_pending_orders', JSON.stringify(samplePendingOrders));
      localStorage.setItem('fallback_in_progress_orders', JSON.stringify(sampleInProgressOrders));
      localStorage.setItem('fallback_completed_orders', JSON.stringify(sampleCompletedOrders));
      
      // Mark fallback data as available
      localStorage.setItem(config.fallback.dataKey, 'true');
      this.dataAvailable = true;
      
      this.log('Fallback data initialized successfully');
    } catch (error) {
      this.log('Error initializing fallback data:', error);
    }
  }
  
  /**
   * Get mock data for a specific endpoint
   * @param {string} endpoint - API endpoint
   * @param {Object} options - Request options
   * @returns {Promise<any>} - Mock data for the endpoint
   */
  async getMockData(endpoint, options = {}) {
    this.log(`Getting mock data for ${endpoint}`);
    
    // Normalize endpoint for matching
    const normalizedEndpoint = endpoint.toLowerCase();
    
    // Handle different endpoints
    if (normalizedEndpoint.includes('orders/pending')) {
      return this.getMockPendingOrders();
    } else if (normalizedEndpoint.includes('orders/in-progress')) {
      return this.getMockInProgressOrders();
    } else if (normalizedEndpoint.includes('orders/completed')) {
      return this.getMockCompletedOrders();
    } else if (
      // Handle various order actions with a success response
      normalizedEndpoint.includes('/start') ||
      normalizedEndpoint.includes('/complete') ||
      normalizedEndpoint.includes('/pickup') ||
      normalizedEndpoint.includes('orders/batch')
    ) {
      return { success: true, message: "Operation successful in offline mode" };
    } else if (normalizedEndpoint.includes('wait-time')) {
      // Handle wait time updates
      let waitTime = 15;
      if (options.method === 'POST' && options.body) {
        try {
          const body = JSON.parse(options.body);
          waitTime = body.waitTime || 15;
        } catch (e) {
          this.log('Error parsing request body:', e);
        }
      }
      return { 
        success: true, 
        message: "Wait time updated successfully in offline mode",
        waitTime: waitTime
      };
    }
    
    // Default response for unhandled endpoints
    return { 
      success: true, 
      message: "Fallback data for " + endpoint,
      timestamp: new Date().toISOString()
    };
  }
  
  /**
   * Get mock pending orders
   * @returns {Promise<Array>} - Mock pending orders
   */
  async getMockPendingOrders() {
    try {
      const data = localStorage.getItem('fallback_pending_orders');
      if (data) {
        return JSON.parse(data);
      }
    } catch (error) {
      this.log('Error getting mock pending orders:', error);
    }
    
    return [];
  }
  
  /**
   * Get mock in-progress orders
   * @returns {Promise<Array>} - Mock in-progress orders
   */
  async getMockInProgressOrders() {
    try {
      const data = localStorage.getItem('fallback_in_progress_orders');
      if (data) {
        return JSON.parse(data);
      }
    } catch (error) {
      this.log('Error getting mock in-progress orders:', error);
    }
    
    return [];
  }
  
  /**
   * Get mock completed orders
   * @returns {Promise<Array>} - Mock completed orders
   */
  async getMockCompletedOrders() {
    try {
      const data = localStorage.getItem('fallback_completed_orders');
      if (data) {
        return JSON.parse(data);
      }
    } catch (error) {
      this.log('Error getting mock completed orders:', error);
    }
    
    return [];
  }
  
  /**
   * Log messages to console if debug mode is enabled
   * @param  {...any} args - Arguments to log
   */
  log(...args) {
    if (this.debug) {
      console.log('[FallbackService]', ...args);
    }
  }
}

// Export as singleton
export default new FallbackService();