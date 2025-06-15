/**
 * FallbackService
 *
 * Manages fallback mode for offline/demo operation.
 * Provides consistent fallback mode activation/deactivation
 * and state management across the application.
 */

class FallbackService {
  constructor() {
    this.debug = process.env.NODE_ENV === 'development';
    
    // Initialize fallback state
    this.active = localStorage.getItem('use_fallback_data') === 'true';
    
    this.log('FallbackService initialized, fallback mode is', this.active ? 'ACTIVE' : 'INACTIVE');
  }
  
  /**
   * Enable fallback mode
   */
  enable() {
    if (this.active) {
      this.log('Fallback mode already active');
      return;
    }
    
    // Set fallback flags
    localStorage.setItem('use_fallback_data', 'true');
    localStorage.setItem('fallback_data_available', 'true');
    localStorage.setItem('demo_mode_enabled', 'true');
    
    this.active = true;
    
    this.log('Fallback mode enabled');
    
    // Notify application components
    this._dispatchEvent('fallback-mode-enabled');
  }
  
  /**
   * Disable fallback mode
   */
  disable() {
    if (!this.active) {
      this.log('Fallback mode already inactive');
      return;
    }
    
    // Remove fallback flags
    localStorage.removeItem('use_fallback_data');
    localStorage.removeItem('fallback_data_available');
    localStorage.removeItem('demo_mode_enabled');
    localStorage.removeItem('auth_error_refresh_needed');
    
    this.active = false;
    
    this.log('Fallback mode disabled');
    
    // Notify application components
    this._dispatchEvent('fallback-mode-disabled');
  }
  
  /**
   * Toggle fallback mode
   * @returns {boolean} - New fallback mode state (true=active)
   */
  toggle() {
    if (this.active) {
      this.disable();
    } else {
      this.enable();
    }
    
    return this.active;
  }
  
  /**
   * Check if fallback mode is active
   * @returns {boolean} - True if fallback mode is active
   */
  isActive() {
    return this.active;
  }
  
  /**
   * Get fallback data for a specific data type
   * @param {string} dataType - Type of data (orders, inventory, etc.)
   * @returns {Object|Array} - Fallback data for the requested type
   */
  getFallbackData(dataType) {
    switch (dataType) {
      case 'orders':
        return this._getOrdersData();
      case 'inventory':
        return this._getInventoryData();
      case 'stations':
        return this._getStationsData();
      case 'users':
        return this._getUsersData();
      case 'settings':
        return this._getSettingsData();
      default:
        return {};
    }
  }
  
  /**
   * Get fallback orders data
   * @returns {Array} - Fallback orders data
   * @private
   */
  _getOrdersData() {
    return [
      {
        id: 1,
        status: 'pending',
        customerName: 'Demo Customer 1',
        items: [
          { id: 1, name: 'Cappuccino', size: 'Medium', milk: 'Oat' }
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: 2,
        status: 'in_progress',
        customerName: 'Demo Customer 2',
        items: [
          { id: 2, name: 'Latte', size: 'Large', milk: 'Almond' }
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: 3,
        status: 'completed',
        customerName: 'Demo Customer 3',
        items: [
          { id: 3, name: 'Espresso', size: 'Small', milk: 'None' }
        ],
        createdAt: new Date(Date.now() - 3600000).toISOString(),
        updatedAt: new Date(Date.now() - 1800000).toISOString()
      }
    ];
  }
  
  /**
   * Get fallback inventory data
   * @returns {Object} - Fallback inventory data
   * @private
   */
  _getInventoryData() {
    return {
      coffee: [
        { id: 1, name: 'House Blend', stock: 75, unit: 'kg' },
        { id: 2, name: 'Dark Roast', stock: 50, unit: 'kg' },
        { id: 3, name: 'Decaf', stock: 30, unit: 'kg' }
      ],
      milk: [
        { id: 1, name: 'Whole Milk', stock: 85, unit: 'liters' },
        { id: 2, name: 'Oat Milk', stock: 65, unit: 'liters' },
        { id: 3, name: 'Almond Milk', stock: 55, unit: 'liters' },
        { id: 4, name: 'Soy Milk', stock: 40, unit: 'liters' }
      ],
      supplies: [
        { id: 1, name: 'Cups (Small)', stock: 200, unit: 'units' },
        { id: 2, name: 'Cups (Medium)', stock: 150, unit: 'units' },
        { id: 3, name: 'Cups (Large)', stock: 100, unit: 'units' },
        { id: 4, name: 'Lids', stock: 400, unit: 'units' }
      ]
    };
  }
  
  /**
   * Get fallback stations data
   * @returns {Array} - Fallback stations data
   * @private
   */
  _getStationsData() {
    return [
      { id: 1, name: 'Station 1', status: 'active', assignedBarista: 'Demo Barista 1', currentLoad: 2 },
      { id: 2, name: 'Station 2', status: 'active', assignedBarista: 'Demo Barista 2', currentLoad: 1 },
      { id: 3, name: 'Station 3', status: 'inactive', assignedBarista: null, currentLoad: 0 }
    ];
  }
  
  /**
   * Get fallback users data
   * @returns {Array} - Fallback users data
   * @private
   */
  _getUsersData() {
    return [
      {
        id: 'demo_user_1',
        username: 'admin',
        name: 'Admin User',
        email: 'admin@example.com',
        role: 'admin',
        permissions: ['manage_all']
      },
      {
        id: 'demo_user_2',
        username: 'barista1',
        name: 'Demo Barista 1',
        email: 'barista1@example.com',
        role: 'barista',
        permissions: ['manage_orders', 'view_stations'],
        assignedStations: [1]
      },
      {
        id: 'demo_user_3',
        username: 'barista2',
        name: 'Demo Barista 2',
        email: 'barista2@example.com',
        role: 'barista',
        permissions: ['manage_orders', 'view_stations'],
        assignedStations: [2]
      }
    ];
  }
  
  /**
   * Get fallback settings data
   * @returns {Object} - Fallback settings data
   * @private
   */
  _getSettingsData() {
    return {
      system: {
        defaultWaitTime: 10,
        notificationsEnabled: true,
        smsNotificationsEnabled: true,
        qrCodeEnabled: true,
        maxOrdersPerStation: 5
      },
      ui: {
        theme: 'light',
        autoDarkMode: true,
        refreshInterval: 30,
        soundEffects: true,
        animations: true
      }
    };
  }
  
  /**
   * Dispatch an event to notify application components
   * @param {string} eventName - Event name to dispatch
   * @private
   */
  _dispatchEvent(eventName) {
    try {
      window.dispatchEvent(new CustomEvent(eventName));
    } catch (error) {
      this.log(`Error dispatching ${eventName} event:`, error);
    }
  }
  
  /**
   * Log messages if debug mode is enabled
   * @param  {...any} args - Message parts
   */
  log(...args) {
    if (this.debug) {
      console.log('[FallbackService]', ...args);
    }
  }
}

// Export as singleton
export default new FallbackService();