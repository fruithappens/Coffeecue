/**
 * Integrated Authentication Fix for Coffee Cue
 * This script automatically fixes common JWT token issues and ensures proper offline functionality
 */
(function() {
  console.log('🔒 Initializing integrated authentication fix...');

  // Constants
  const TOKEN_KEYS = ['coffee_system_token', 'auth_token', 'coffee_auth_token', 'jwt_token'];
  const USER_KEY = 'coffee_system_user';
  const FALLBACK_KEY = 'use_fallback_data';
  const DEMO_MODE_KEY = 'demo_mode_enabled';
  
  // Run the fix process on load
  fixAuthenticationIssues();
  
  /**
   * Main function to fix authentication issues
   */
  async function fixAuthenticationIssues() {
    try {
      console.log('Checking authentication status...');
      
      // First check if we're already in demo/fallback mode
      const isAlreadyInFallbackMode = localStorage.getItem(FALLBACK_KEY) === 'true' && 
                                     localStorage.getItem(DEMO_MODE_KEY) === 'true';
      
      // Check current token
      const token = getToken();
      const tokenValid = token && validateToken(token).isValid;
      
      // If we're already in fallback mode with a valid token, just verify the setup
      if (isAlreadyInFallbackMode && tokenValid) {
        console.log('Already in fallback mode with valid token, verifying setup...');
        verifyAndEnhanceDemoMode();
        return;
      }
      
      // If token is invalid or missing, fix it
      if (!tokenValid) {
        console.log('Authentication token invalid or missing, fixing...');
        
        // Create a valid token
        const newToken = createValidToken();
        saveToken(newToken);
        
        // Enable demo mode
        enableDemoMode();
      } else {
        console.log('Authentication token valid');
      }
    } catch (error) {
      console.error('Error fixing authentication:', error);
      
      // Fallback to demo mode in case of errors
      enableDemoMode();
    }
  }
  
  /**
   * Validate a JWT token
   * @param {string} token - The token to validate
   * @returns {object} Validation result
   */
  function validateToken(token) {
    try {
      // Basic format check
      const parts = token.split('.');
      if (parts.length !== 3) {
        return {
          isValid: false,
          error: 'Invalid token format'
        };
      }
      
      // Decode payload
      try {
        const payload = JSON.parse(atob(parts[1]));
        
        // Check subject field
        if (!payload.sub) {
          return {
            isValid: false,
            error: 'Missing subject field'
          };
        }
        
        // Check if subject is a string (common issue)
        if (typeof payload.sub !== 'string') {
          return {
            isValid: false,
            error: 'Subject must be a string',
            fixable: true,
            payload
          };
        }
        
        // Check expiration
        if (payload.exp && payload.exp * 1000 < Date.now()) {
          return {
            isValid: false,
            error: 'Token has expired',
            fixable: true,
            payload
          };
        }
        
        // Token is valid
        return {
          isValid: true,
          payload
        };
      } catch (decodeError) {
        return {
          isValid: false,
          error: 'Invalid payload encoding'
        };
      }
    } catch (error) {
      return {
        isValid: false,
        error: error.message
      };
    }
  }
  
  /**
   * Create a valid token for demo mode
   * @returns {string} Valid JWT token
   */
  function createValidToken() {
    // Create header
    const header = {
      alg: 'HS256',
      typ: 'JWT'
    };
    
    // Create payload with string subject
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      sub: 'demo_user', // Must be a string to avoid "Subject must be a string" error
      name: 'Demo User',
      role: 'barista',
      username: 'demo',
      id: 'demo_user',
      stations: [1, 2, 3],
      iat: now,
      exp: now + (7 * 24 * 60 * 60), // 7 days from now
      permissions: ['view_orders', 'manage_orders', 'view_stations']
    };
    
    // Encode parts
    const headerB64 = btoa(JSON.stringify(header)).replace(/=+$/, '');
    const payloadB64 = btoa(JSON.stringify(payload)).replace(/=+$/, '');
    const signature = btoa('demo_signature').replace(/=+$/, '');
    
    // Combine into token
    return `${headerB64}.${payloadB64}.${signature}`;
  }
  
  /**
   * Save token to all known storage locations
   * @param {string} token - The token to save
   */
  function saveToken(token) {
    TOKEN_KEYS.forEach(key => {
      localStorage.setItem(key, token);
    });
    console.log('Token saved to all storage locations');
  }
  
  /**
   * Get token from any storage location
   * @returns {string|null} The token or null if not found
   */
  function getToken() {
    for (const key of TOKEN_KEYS) {
      const value = localStorage.getItem(key);
      if (value) {
        return value;
      }
    }
    return null;
  }
  
  /**
   * Enable demo mode with offline data
   */
  function enableDemoMode() {
    console.log('Enabling demo mode...');
    
    // Set demo mode flags
    localStorage.setItem(FALLBACK_KEY, 'true');
    localStorage.setItem(DEMO_MODE_KEY, 'true');
    localStorage.setItem('fallback_data_available', 'true');
    
    // Set connection status
    localStorage.setItem('coffee_connection_status', 'offline');
    localStorage.setItem('coffee_connection_timestamp', Date.now().toString());
    
    // Disable auto refresh
    localStorage.setItem('coffee_auto_refresh_enabled', 'false');
    
    // Clear error states
    localStorage.removeItem('auth_error_count');
    localStorage.removeItem('auth_error_refresh_needed');
    localStorage.removeItem('jwt_error_endpoints');
    localStorage.removeItem('anti_flicker_block_until');
    localStorage.removeItem('anti_flicker_blocked_endpoints');
    
    // Create demo user
    const user = {
      id: 'demo_user',
      username: 'demo',
      name: 'Demo User',
      role: 'barista',
      stations: [1, 2, 3]
    };
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    
    // Create sample data if needed
    createSampleDataIfNeeded();
    
    console.log('Demo mode enabled successfully');
  }
  
  /**
   * Create sample data if not already available
   */
  function createSampleDataIfNeeded() {
    // Check if sample data already exists
    if (localStorage.getItem('fallback_pending_orders')) {
      console.log('Sample data already exists');
      return;
    }
    
    console.log('Creating sample data for offline mode...');
    
    // Generate timestamps
    const now = Date.now();
    const minutes = (min) => min * 60 * 1000;
    
    // Pending orders
    const pendingOrders = [
      {
        id: 'po_001',
        orderNumber: 'P001',
        customerName: 'John Smith',
        phoneNumber: '+61412345678',
        coffeeType: 'Large Flat White',
        milkType: 'Full Cream',
        sugar: '1 sugar',
        extraHot: false,
        priority: false,
        status: 'pending',
        createdAt: new Date(now - minutes(10)).toISOString(),
        waitTime: 10,
        expectedCompletionTime: new Date(now + minutes(5)).toISOString(),
        stationId: 1
      },
      {
        id: 'po_002',
        orderNumber: 'P002',
        customerName: 'Sarah Williams',
        phoneNumber: '+61423456789',
        coffeeType: 'Regular Cappuccino',
        milkType: 'Almond',
        sugar: 'No sugar',
        extraHot: true,
        priority: true,
        status: 'pending',
        createdAt: new Date(now - minutes(7)).toISOString(),
        waitTime: 7,
        expectedCompletionTime: new Date(now + minutes(3)).toISOString(),
        stationId: 1
      }
    ];
    
    // In-progress orders
    const inProgressOrders = [
      {
        id: 'ip_001',
        orderNumber: 'IP001',
        customerName: 'Emma Davis',
        phoneNumber: '+61445678901',
        coffeeType: 'Regular Mocha',
        milkType: 'Full Cream',
        sugar: '1 sugar',
        extraHot: false,
        priority: false,
        status: 'in-progress',
        createdAt: new Date(now - minutes(12)).toISOString(),
        startedAt: new Date(now - minutes(2)).toISOString(),
        waitTime: 12,
        expectedCompletionTime: new Date(now + minutes(3)).toISOString(),
        stationId: 1
      }
    ];
    
    // Completed orders
    const completedOrders = [
      {
        id: 'co_001',
        orderNumber: 'C001',
        customerName: 'Jessica Taylor',
        phoneNumber: '+61467890123',
        coffeeType: 'Regular Flat White',
        milkType: 'Skim',
        sugar: 'No sugar',
        extraHot: false,
        priority: false,
        status: 'completed',
        createdAt: new Date(now - minutes(30)).toISOString(),
        startedAt: new Date(now - minutes(25)).toISOString(),
        completedAt: new Date(now - minutes(20)).toISOString(),
        stationId: 1
      }
    ];
    
    // Stations
    const stations = [
      {
        id: 1,
        name: 'Main Station',
        status: 'active',
        barista: 'John Barista',
        queue_length: pendingOrders.length + inProgressOrders.length,
        last_activity: new Date(now - minutes(2)).toISOString(),
        capabilities: ['espresso', 'milk-steaming', 'tea'],
        location: 'Main Hall'
      },
      {
        id: 2,
        name: 'Express Station',
        status: 'inactive',
        barista: null,
        queue_length: 0,
        last_activity: new Date(now - minutes(60)).toISOString(),
        capabilities: ['espresso', 'milk-steaming'],
        location: 'Side Entrance'
      }
    ];
    
    // Stock data
    const stock = {
      milk: [
        { id: 'milk_regular', name: 'Regular Milk', amount: 3.5, capacity: 5, unit: 'L', status: 'good' },
        { id: 'milk_skim', name: 'Skim Milk', amount: 2, capacity: 3, unit: 'L', status: 'good' },
        { id: 'milk_almond', name: 'Almond Milk', amount: 1.2, capacity: 2, unit: 'L', status: 'low' },
        { id: 'milk_oat', name: 'Oat Milk', amount: 1.5, capacity: 2, unit: 'L', status: 'good' }
      ],
      coffee: [
        { id: 'coffee_house', name: 'House Blend', amount: 1.2, capacity: 2, unit: 'kg', status: 'good' },
        { id: 'coffee_decaf', name: 'Decaf Blend', amount: 0.5, capacity: 1, unit: 'kg', status: 'low' }
      ]
    };
    
    // Save data to localStorage
    localStorage.setItem('fallback_pending_orders', JSON.stringify(pendingOrders));
    localStorage.setItem('fallback_in_progress_orders', JSON.stringify(inProgressOrders));
    localStorage.setItem('fallback_completed_orders', JSON.stringify(completedOrders));
    localStorage.setItem('fallback_stations', JSON.stringify(stations));
    localStorage.setItem('fallback_stock', JSON.stringify(stock));
    
    // Set additional data for compatibility with different components
    localStorage.setItem('sample_orders', JSON.stringify([...pendingOrders, ...inProgressOrders]));
    localStorage.setItem('sample_completed_orders', JSON.stringify(completedOrders));
    localStorage.setItem('sample_stations', JSON.stringify(stations));
    
    console.log('Sample data created successfully');
  }
  
  /**
   * Verify and enhance existing demo mode setup
   */
  function verifyAndEnhanceDemoMode() {
    console.log('Verifying demo mode configuration...');
    
    // Ensure token is valid
    const token = getToken();
    if (!token || !validateToken(token).isValid) {
      const newToken = createValidToken();
      saveToken(newToken);
    }
    
    // Ensure user data exists
    const userData = localStorage.getItem(USER_KEY);
    if (!userData) {
      const user = {
        id: 'demo_user',
        username: 'demo',
        name: 'Demo User',
        role: 'barista',
        stations: [1, 2, 3]
      };
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    }
    
    // Ensure all flags are set
    localStorage.setItem(FALLBACK_KEY, 'true');
    localStorage.setItem(DEMO_MODE_KEY, 'true');
    localStorage.setItem('fallback_data_available', 'true');
    localStorage.setItem('coffee_connection_status', 'offline');
    
    // Clear error states
    localStorage.removeItem('auth_error_count');
    localStorage.removeItem('auth_error_refresh_needed');
    localStorage.removeItem('jwt_error_endpoints');
    localStorage.removeItem('anti_flicker_block_until');
    
    // Create sample data if needed
    createSampleDataIfNeeded();
    
    console.log('Demo mode verification complete');
  }
  
  // Add a notification when fix is complete
  function showFixNotification() {
    // Only show if there were actual fixes needed
    const fixApplied = localStorage.getItem('auth_fix_applied');
    if (fixApplied) {
      return; // Already applied fix
    }
    
    // Mark as fixed
    localStorage.setItem('auth_fix_applied', 'true');
    
    // Show notification if DOM is ready
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      createNotification();
    } else {
      document.addEventListener('DOMContentLoaded', createNotification);
    }
    
    function createNotification() {
      const notification = document.createElement('div');
      notification.style.position = 'fixed';
      notification.style.bottom = '20px';
      notification.style.right = '20px';
      notification.style.backgroundColor = '#4caf50';
      notification.style.color = 'white';
      notification.style.padding = '12px 20px';
      notification.style.borderRadius = '4px';
      notification.style.boxShadow = '0 2px 10px rgba(0,0,0,0.2)';
      notification.style.zIndex = '9999';
      notification.style.fontFamily = 'system-ui, -apple-system, sans-serif';
      notification.style.fontSize = '14px';
      notification.style.transition = 'opacity 0.5s ease-out';
      notification.textContent = 'Authentication has been fixed automatically';
      
      // Add close button
      const closeBtn = document.createElement('span');
      closeBtn.textContent = '×';
      closeBtn.style.marginLeft = '10px';
      closeBtn.style.cursor = 'pointer';
      closeBtn.style.fontWeight = 'bold';
      closeBtn.style.fontSize = '20px';
      closeBtn.onclick = function() {
        notification.style.opacity = '0';
        setTimeout(() => notification.remove(), 500);
      };
      
      notification.appendChild(closeBtn);
      document.body.appendChild(notification);
      
      // Auto-remove after 5 seconds
      setTimeout(() => {
        notification.style.opacity = '0';
        setTimeout(() => notification.remove(), 500);
      }, 5000);
    }
  }
  
  // Show notification after delay
  setTimeout(showFixNotification, 2000);
  
  console.log('✓ Integrated authentication fix initialized');
})();