// utils/offlineDataHelper.js

/**
 * Utility functions for managing offline data and fallback mode
 * Enhanced to handle authentication errors and JWT token issues
 */
export const OfflineDataHelper = {
  /**
   * Prepares offline data for fallback mode
   * This initializes sample data in localStorage if not already set
   */
  prepareOfflineData: () => {
    console.log('Preparing offline fallback data');
    
    // Initialize sample pending orders
    if (!localStorage.getItem('fallback_pending_orders')) {
      localStorage.setItem('fallback_pending_orders', JSON.stringify([
        {
          id: 'fb-p-1',
          orderNumber: 'O-1001',
          customerName: 'Alex Johnson',
          phoneNumber: '+61412345678',
          coffeeType: 'Latte',
          milkType: 'Regular',
          sugar: '1 sugar',
          extraHot: false,
          status: 'pending',
          createdAt: new Date(Date.now() - 10 * 60000).toISOString(),
          waitTime: 10,
          stationId: 1
        },
        {
          id: 'fb-p-2',
          orderNumber: 'O-1002',
          customerName: 'Jamie Smith',
          phoneNumber: '+61423456789',
          coffeeType: 'Cappuccino',
          milkType: 'Almond',
          sugar: 'No sugar',
          extraHot: true,
          status: 'pending',
          createdAt: new Date(Date.now() - 5 * 60000).toISOString(),
          waitTime: 5,
          stationId: 1
        },
        {
          id: 'fb-p-3',
          orderNumber: 'O-1003',
          customerName: 'Taylor Wilson',
          phoneNumber: '+61434567890',
          coffeeType: 'Flat White',
          milkType: 'Skim',
          sugar: '2 sugars',
          extraHot: false,
          status: 'pending',
          createdAt: new Date(Date.now() - 2 * 60000).toISOString(),
          waitTime: 2,
          stationId: 1
        }
      ]));
    }
    
    // Initialize sample in-progress orders
    if (!localStorage.getItem('fallback_in_progress_orders')) {
      localStorage.setItem('fallback_in_progress_orders', JSON.stringify([
        {
          id: 'fb-ip-1',
          orderNumber: 'O-1000',
          customerName: 'Sam Taylor',
          phoneNumber: '+61445678901',
          coffeeType: 'Mocha',
          milkType: 'Regular',
          sugar: 'No sugar',
          extraHot: false,
          status: 'in-progress',
          createdAt: new Date(Date.now() - 15 * 60000).toISOString(),
          startedAt: new Date(Date.now() - 3 * 60000).toISOString(),
          waitTime: 15,
          stationId: 1
        }
      ]));
    }
    
    // Initialize sample completed orders
    if (!localStorage.getItem('fallback_completed_orders')) {
      localStorage.setItem('fallback_completed_orders', JSON.stringify([
        {
          id: 'fb-c-1',
          orderNumber: 'O-999',
          customerName: 'Jordan Lee',
          phoneNumber: '+61456789012',
          coffeeType: 'Espresso',
          milkType: 'None',
          sugar: 'No sugar',
          extraHot: false,
          status: 'completed',
          createdAt: new Date(Date.now() - 25 * 60000).toISOString(),
          startedAt: new Date(Date.now() - 20 * 60000).toISOString(),
          completedAt: new Date(Date.now() - 18 * 60000).toISOString(),
          stationId: 1
        },
        {
          id: 'fb-c-2',
          orderNumber: 'O-998',
          customerName: 'Casey Jones',
          phoneNumber: '+61467890123',
          coffeeType: 'Americano',
          milkType: 'Regular',
          sugar: '1 sugar',
          extraHot: true,
          status: 'completed',
          createdAt: new Date(Date.now() - 35 * 60000).toISOString(),
          startedAt: new Date(Date.now() - 30 * 60000).toISOString(),
          completedAt: new Date(Date.now() - 28 * 60000).toISOString(),
          stationId: 1
        }
      ]));
    }
    
    // Initialize sample stock data
    if (!localStorage.getItem('fallback_stock_data')) {
      localStorage.setItem('fallback_stock_data', JSON.stringify({
        milk: [
          {
            id: 'milk_regular',
            name: 'Regular Milk',
            amount: 3.5,
            capacity: 5,
            unit: 'L',
            status: 'good'
          },
          {
            id: 'milk_skim',
            name: 'Skim Milk',
            amount: 2,
            capacity: 3,
            unit: 'L',
            status: 'good'
          },
          {
            id: 'milk_almond',
            name: 'Almond Milk',
            amount: 1.2,
            capacity: 2,
            unit: 'L',
            status: 'low'
          }
        ],
        coffee: [
          {
            id: 'coffee_house',
            name: 'House Blend',
            amount: 1.2,
            capacity: 2,
            unit: 'kg',
            status: 'good'
          },
          {
            id: 'coffee_decaf',
            name: 'Decaf Blend',
            amount: 0.5,
            capacity: 1,
            unit: 'kg',
            status: 'low'
          }
        ],
        cups: [
          {
            id: 'cups_small',
            name: 'Small Cups',
            amount: 25,
            capacity: 50,
            unit: 'pcs',
            status: 'good'
          },
          {
            id: 'cups_medium',
            name: 'Medium Cups',
            amount: 30,
            capacity: 50,
            unit: 'pcs',
            status: 'good'
          },
          {
            id: 'cups_large',
            name: 'Large Cups',
            amount: 15,
            capacity: 50,
            unit: 'pcs',
            status: 'low'
          }
        ]
      }));
    }
    
    // Mark fallback data as available
    localStorage.setItem('fallback_data_available', 'true');
    
    console.log('Fallback data prepared and ready for offline use');
  },
  
  /**
   * Checks if fallback mode is enabled
   * @returns {boolean} - True if fallback mode is enabled
   */
  isFallbackModeEnabled: () => {
    return localStorage.getItem('use_fallback_data') === 'true';
  },
  
  /**
   * Enables fallback mode with proper auth error handling
   */
  enableFallbackMode: () => {
    // Set fallback flags
    localStorage.setItem('use_fallback_data', 'true');
    localStorage.setItem('auth_error_refresh_needed', 'true');
    localStorage.setItem('demo_mode_enabled', 'true');
    
    // Reset error counters
    localStorage.removeItem('auth_error_count');
    
    // Set connection status to indicate offline mode
    localStorage.setItem('coffee_connection_status', 'offline');
    
    // Prepare offline data if not already done
    if (localStorage.getItem('fallback_data_available') !== 'true') {
      OfflineDataHelper.prepareOfflineData();
    }
    
    // Create valid JWT token with proper subject field
    OfflineDataHelper.createValidDummyToken();
    
    // Dispatch event to notify app of fallback mode
    window.dispatchEvent(new CustomEvent('fallback_mode_enabled'));
    
    console.log('Fallback mode enabled with sample data');
  },
  
  /**
   * Disables fallback mode
   */
  disableFallbackMode: () => {
    // Remove fallback flags
    localStorage.removeItem('use_fallback_data');
    localStorage.removeItem('auth_error_refresh_needed');
    localStorage.removeItem('demo_mode_enabled');
    
    // Set connection status back to online
    localStorage.setItem('coffee_connection_status', 'online');
    
    // Remove dummy tokens
    localStorage.removeItem('coffee_system_token');
    localStorage.removeItem('coffee_auth_token');
    localStorage.removeItem('jwt_token');
    localStorage.removeItem('auth_token');
    
    // Reset error counts
    localStorage.removeItem('auth_error_count');
    
    // Dispatch event
    window.dispatchEvent(new CustomEvent('fallback_mode_disabled'));
    console.log('Fallback mode disabled');
  },
  
  /**
   * Gets fallback orders data
   * @param {string} type - Type of orders (pending, in_progress, completed)
   * @returns {Array} - Array of orders
   */
  getFallbackOrders: (type) => {
    const key = `fallback_${type}_orders`;
    try {
      return JSON.parse(localStorage.getItem(key)) || [];
    } catch (error) {
      console.error(`Error parsing fallback ${type} orders:`, error);
      return [];
    }
  },
  
  /**
   * Saves fallback orders data
   * @param {string} type - Type of orders (pending, in_progress, completed)
   * @param {Array} orders - Array of orders to save
   */
  saveFallbackOrders: (type, orders) => {
    const key = `fallback_${type}_orders`;
    localStorage.setItem(key, JSON.stringify(orders));
  },

  /**
   * Create a valid JWT token with proper subject field
   * This helps resolve the "Subject must be a string" error
   * @returns {string} The created token
   */
  createValidDummyToken: () => {
    // Create header part
    const header = {
      alg: 'HS256',
      typ: 'JWT'
    };
    
    // Create payload with proper sub field as string
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      sub: 'demo_user', // Must be a string
      name: 'Demo User',
      role: 'barista',
      stations: [1, 2, 3],
      iat: now,
      exp: now + (24 * 60 * 60), // 24 hours from now
      permissions: ['manage_orders', 'view_stations']
    };
    
    // Base64 encode parts
    const headerB64 = btoa(JSON.stringify(header)).replace(/=/g, '');
    const payloadB64 = btoa(JSON.stringify(payload)).replace(/=/g, '');
    
    // Create a dummy signature
    const signature = 'valid_signature_for_offline_demo_mode';
    
    // Create and store the token
    const validToken = `${headerB64}.${payloadB64}.${signature}`;
    localStorage.setItem('coffee_system_token', validToken);
    
    // Add to other storages for compatibility
    localStorage.setItem('coffee_auth_token', validToken);
    localStorage.setItem('jwt_token', validToken);
    localStorage.setItem('auth_token', validToken);
    
    console.log('Created and stored valid dummy token for offline/demo mode');
    return validToken;
  },
  
  /**
   * Check if token has the proper subject field type (string)
   * @returns {boolean} True if token has valid subject field
   */
  hasValidTokenSubject: () => {
    const token = localStorage.getItem('coffee_system_token');
    if (!token) return false;
    
    try {
      // Extract payload
      const parts = token.split('.');
      if (parts.length !== 3) return false;
      
      const payload = JSON.parse(atob(parts[1]));
      
      // Check if sub exists and is a string
      return typeof payload.sub === 'string';
    } catch (error) {
      console.error('Error validating token subject:', error);
      return false;
    }
  },
  
  /**
   * Fix token subject field if needed
   * @returns {boolean} True if fixed or already valid
   */
  fixTokenSubjectIfNeeded: () => {
    if (OfflineDataHelper.hasValidTokenSubject()) {
      return true; // Already valid
    }
    
    // Create a new valid token
    OfflineDataHelper.createValidDummyToken();
    return true;
  }
};

export default OfflineDataHelper;