/**
 * DemoModeService
 * 
 * A simplified replacement for the complex fallback system.
 * Provides a simple toggle for demo mode with sample data.
 */

class DemoModeService {
  constructor() {
    // Check if demo mode is enabled
    this.enabled = localStorage.getItem('demo_mode_enabled') === 'true';
    this.debug = true;
    
    this.log(`DemoModeService initialized, demo mode ${this.enabled ? 'enabled' : 'disabled'}`);
    
    // Initialize sample data if in demo mode
    if (this.enabled && !localStorage.getItem('demo_data_initialized')) {
      this.initializeSampleData();
    }
  }
  
  /**
   * Check if demo mode is enabled
   * @returns {boolean} - True if demo mode is enabled
   */
  isEnabled() {
    return localStorage.getItem('demo_mode_enabled') === 'true';
  }
  
  /**
   * Enable demo mode
   */
  enable() {
    localStorage.setItem('demo_mode_enabled', 'true');
    this.enabled = true;
    
    // Initialize sample data if not already done
    if (!localStorage.getItem('demo_data_initialized')) {
      this.initializeSampleData();
    }
    
    this.log('Demo mode enabled');
    
    // Dispatch event for components to react
    window.dispatchEvent(new CustomEvent('demo-mode-enabled'));
  }
  
  /**
   * Disable demo mode
   */
  disable() {
    localStorage.setItem('demo_mode_enabled', 'false');
    this.enabled = false;
    
    this.log('Demo mode disabled');
    
    // Dispatch event for components to react
    window.dispatchEvent(new CustomEvent('demo-mode-disabled'));
  }
  
  /**
   * Toggle demo mode
   * @returns {boolean} - New state of demo mode
   */
  toggle() {
    if (this.isEnabled()) {
      this.disable();
      return false;
    } else {
      this.enable();
      return true;
    }
  }
  
  /**
   * Initialize sample data for demo mode
   */
  initializeSampleData() {
    try {
      this.log('Initializing sample data for demo mode');
      
      // Sample pending orders
      const pendingOrders = [
        {
          id: 'demo_1',
          orderNumber: 'D001',
          customerName: 'John Demo',
          coffeeType: 'Large Flat White',
          milkType: 'Regular milk',
          sugar: 'No sugar',
          createdAt: new Date(Date.now() - 5 * 60000),
          status: 'pending',
          stationId: 1
        },
        {
          id: 'demo_2',
          orderNumber: 'D002',
          customerName: 'Jane Demo',
          coffeeType: 'Medium Cappuccino',
          milkType: 'Almond milk',
          sugar: '1 sugar',
          createdAt: new Date(Date.now() - 3 * 60000),
          status: 'pending',
          priority: true,
          stationId: 1
        }
      ];
      
      // Sample in-progress orders
      const inProgressOrders = [
        {
          id: 'demo_3',
          orderNumber: 'D003',
          customerName: 'Bob Demo',
          coffeeType: 'Large Long Black',
          milkType: 'No milk',
          sugar: 'No sugar',
          createdAt: new Date(Date.now() - 10 * 60000),
          startedAt: new Date(Date.now() - 2 * 60000),
          status: 'in-progress',
          stationId: 1
        }
      ];
      
      // Sample completed orders
      const completedOrders = [
        {
          id: 'demo_4',
          orderNumber: 'D004',
          customerName: 'Alice Demo',
          coffeeType: 'Medium Latte',
          milkType: 'Regular milk',
          sugar: 'No sugar',
          createdAt: new Date(Date.now() - 20 * 60000),
          completedAt: new Date(Date.now() - 5 * 60000),
          status: 'completed',
          stationId: 1
        }
      ];
      
      // Sample previous orders (picked up)
      const previousOrders = [
        {
          id: 'demo_5',
          orderNumber: 'D005',
          customerName: 'Charlie Demo',
          coffeeType: 'Small Espresso',
          milkType: 'No milk',
          sugar: 'No sugar',
          createdAt: new Date(Date.now() - 45 * 60000),
          completedAt: new Date(Date.now() - 30 * 60000),
          pickedUpAt: new Date(Date.now() - 25 * 60000),
          status: 'picked_up',
          stationId: 1
        },
        {
          id: 'demo_6',
          orderNumber: 'D006',
          customerName: 'Diana Demo',
          coffeeType: 'Medium Mocha',
          milkType: 'Regular milk',
          sugar: '2 sugars',
          createdAt: new Date(Date.now() - 60 * 60000),
          completedAt: new Date(Date.now() - 40 * 60000),
          pickedUpAt: new Date(Date.now() - 35 * 60000),
          status: 'picked_up',
          stationId: 1
        }
      ];
      
      // Store sample data
      localStorage.setItem('demo_pending_orders', JSON.stringify(pendingOrders));
      localStorage.setItem('demo_in_progress_orders', JSON.stringify(inProgressOrders));
      localStorage.setItem('demo_completed_orders', JSON.stringify(completedOrders));
      localStorage.setItem('demo_previous_orders', JSON.stringify(previousOrders));
      
      // Also store as fallback data for consistency
      localStorage.setItem('fallback_pending_orders', JSON.stringify(pendingOrders));
      localStorage.setItem('fallback_in_progress_orders', JSON.stringify(inProgressOrders));
      localStorage.setItem('fallback_completed_orders', JSON.stringify(completedOrders));
      localStorage.setItem('fallback_previous_orders', JSON.stringify(previousOrders));
      
      // Mark as initialized
      localStorage.setItem('demo_data_initialized', 'true');
      
      this.log('Sample data initialized successfully');
    } catch (error) {
      this.log('Error initializing sample data:', error);
    }
  }
  
  /**
   * Get sample data for a specific endpoint
   * @param {string} endpoint - The API endpoint
   * @returns {Array|Object} - Sample data for the endpoint
   */
  getSampleData(endpoint) {
    // Normalize the endpoint to match our stored data
    const normalizedEndpoint = endpoint.toLowerCase();
    
    if (normalizedEndpoint.includes('orders/pending')) {
      return JSON.parse(localStorage.getItem('demo_pending_orders') || '[]');
    } else if (normalizedEndpoint.includes('orders/in-progress')) {
      return JSON.parse(localStorage.getItem('demo_in_progress_orders') || '[]');
    } else if (normalizedEndpoint.includes('orders/completed')) {
      return JSON.parse(localStorage.getItem('demo_completed_orders') || '[]');
    } else if (normalizedEndpoint.includes('orders/previous') || normalizedEndpoint.includes('orders/picked-up')) {
      return JSON.parse(localStorage.getItem('demo_previous_orders') || '[]');
    } else if (normalizedEndpoint.includes('/start') || 
               normalizedEndpoint.includes('/complete') || 
               normalizedEndpoint.includes('/pickup')) {
      // Return success for order actions
      return { success: true, message: 'Operation completed in demo mode' };
    } else if (normalizedEndpoint.includes('wait-time')) {
      // Return success for wait time updates
      return { success: true, message: 'Wait time updated in demo mode', waitTime: 15 };
    }
    
    // Default success response for other endpoints
    return { success: true, message: 'Demo mode response' };
  }
  
  /**
   * Add a new order in demo mode
   * @param {Object} orderDetails - Order details
   * @returns {Object} - Result with order ID
   */
  addOrder(orderDetails) {
    try {
      // Create a new order with demo ID
      const newOrder = {
        ...orderDetails,
        id: `demo_${Date.now()}`,
        orderNumber: `D${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`,
        createdAt: new Date(),
        status: 'pending'
      };
      
      // Add to pending orders
      const pendingOrders = JSON.parse(localStorage.getItem('demo_pending_orders') || '[]');
      pendingOrders.push(newOrder);
      localStorage.setItem('demo_pending_orders', JSON.stringify(pendingOrders));
      
      return { 
        success: true, 
        message: 'Order added in demo mode',
        id: newOrder.id,
        orderNumber: newOrder.orderNumber
      };
    } catch (error) {
      this.log('Error adding demo order:', error);
      return { success: false, message: 'Error adding demo order' };
    }
  }
  
  /**
   * Start an order in demo mode
   * @param {string} orderId - Order ID
   * @returns {Object} - Operation result
   */
  startOrder(orderId) {
    try {
      // Find order in pending
      const pendingOrders = JSON.parse(localStorage.getItem('demo_pending_orders') || '[]');
      const orderIndex = pendingOrders.findIndex(o => o.id === orderId);
      
      if (orderIndex === -1) {
        return { success: false, message: 'Order not found' };
      }
      
      // Remove from pending
      const order = pendingOrders.splice(orderIndex, 1)[0];
      localStorage.setItem('demo_pending_orders', JSON.stringify(pendingOrders));
      
      // Add to in-progress
      const inProgressOrders = JSON.parse(localStorage.getItem('demo_in_progress_orders') || '[]');
      inProgressOrders.push({
        ...order,
        status: 'in-progress',
        startedAt: new Date()
      });
      localStorage.setItem('demo_in_progress_orders', JSON.stringify(inProgressOrders));
      
      return { success: true, message: 'Order started in demo mode' };
    } catch (error) {
      this.log('Error starting demo order:', error);
      return { success: false, message: 'Error starting demo order' };
    }
  }
  
  /**
   * Complete an order in demo mode
   * @param {string} orderId - Order ID
   * @returns {Object} - Operation result
   */
  completeOrder(orderId) {
    try {
      // Find order in in-progress
      const inProgressOrders = JSON.parse(localStorage.getItem('demo_in_progress_orders') || '[]');
      const orderIndex = inProgressOrders.findIndex(o => o.id === orderId);
      
      if (orderIndex === -1) {
        return { success: false, message: 'Order not found' };
      }
      
      // Remove from in-progress
      const order = inProgressOrders.splice(orderIndex, 1)[0];
      localStorage.setItem('demo_in_progress_orders', JSON.stringify(inProgressOrders));
      
      // Add to completed
      const completedOrders = JSON.parse(localStorage.getItem('demo_completed_orders') || '[]');
      completedOrders.push({
        ...order,
        status: 'completed',
        completedAt: new Date()
      });
      localStorage.setItem('demo_completed_orders', JSON.stringify(completedOrders));
      
      return { success: true, message: 'Order completed in demo mode' };
    } catch (error) {
      this.log('Error completing demo order:', error);
      return { success: false, message: 'Error completing demo order' };
    }
  }
  
  /**
   * Mark order as picked up in demo mode
   * @param {string} orderId - Order ID
   * @returns {Object} - Operation result
   */
  pickupOrder(orderId) {
    try {
      // Find order in completed
      const completedOrders = JSON.parse(localStorage.getItem('demo_completed_orders') || '[]');
      const orderIndex = completedOrders.findIndex(o => o.id === orderId);
      
      if (orderIndex === -1) {
        return { success: false, message: 'Order not found' };
      }
      
      // Update the order in place
      completedOrders[orderIndex] = {
        ...completedOrders[orderIndex],
        pickedUpAt: new Date(),
        status: 'picked-up'
      };
      
      localStorage.setItem('demo_completed_orders', JSON.stringify(completedOrders));
      
      return { success: true, message: 'Order picked up in demo mode' };
    } catch (error) {
      this.log('Error marking demo order as picked up:', error);
      return { success: false, message: 'Error marking order as picked up' };
    }
  }
  
  /**
   * Reset all demo data to initial state
   */
  resetData() {
    try {
      // Remove all demo data
      localStorage.removeItem('demo_pending_orders');
      localStorage.removeItem('demo_in_progress_orders');
      localStorage.removeItem('demo_completed_orders');
      localStorage.removeItem('demo_data_initialized');
      
      // Initialize fresh data
      this.initializeSampleData();
      
      this.log('Demo data reset successfully');
      
      // Dispatch event for components to refresh
      window.dispatchEvent(new CustomEvent('demo-data-reset'));
      
      return { success: true, message: 'Demo data reset successfully' };
    } catch (error) {
      this.log('Error resetting demo data:', error);
      return { success: false, message: 'Error resetting demo data' };
    }
  }
  
  /**
   * Log messages if debug mode is enabled
   * @param  {...any} args - Message parts
   */
  log(...args) {
    if (this.debug) {
      console.log('[DemoModeService]', ...args);
    }
  }
}

// Export as singleton
export default new DemoModeService();