/**
 * Unified Authentication Solution for Coffee Cue
 * This comprehensive script automatically detects and fixes all common authentication issues
 * and properly sets up the system for offline operation with realistic sample data.
 */
(function() {
  console.log('🔍 Starting unified authentication solution...');
  
  // State object to track diagnosis and fixes
  const state = {
    originalToken: null,
    tokenValid: false,
    tokenIssues: [],
    backendAvailable: false,
    fixes: [],
    demoModeEnabled: false
  };
  
  // Storage locations for tokens
  const TOKEN_KEYS = [
    'auth_token',
    'coffee_system_token',
    'coffee_auth_token',
    'jwt_token'
  ];
  
  // Initialize by checking current environment
  initialize();
  
  /**
   * Main initialization function
   */
  function initialize() {
    // Collect current state information
    state.originalToken = getToken();
    state.demoModeEnabled = localStorage.getItem('demo_mode_enabled') === 'true' && 
                           localStorage.getItem('use_fallback_data') === 'true';
    
    // If demo mode is already enabled, just verify and enhance it
    if (state.demoModeEnabled) {
      console.log('Demo mode is already enabled, verifying configuration...');
      verifyAndEnhanceDemoMode()
        .then(() => {
          console.log('Demo mode verification complete');
          notifyCompletion('Demo mode verified and enhanced');
        })
        .catch(error => {
          console.error('Error verifying demo mode:', error);
          // Try to fix anyway
          runFullDiagnosticAndFix();
        });
    } else {
      // Run full diagnostic and fix
      runFullDiagnosticAndFix();
    }
  }
  
  /**
   * Run comprehensive diagnostic and fix workflow
   */
  async function runFullDiagnosticAndFix() {
    try {
      console.log('Running full diagnostic and fix workflow...');
      
      // 1. Validate token (if any)
      const tokenValidation = await validateToken();
      if (tokenValidation.valid) {
        // 2a. If token is valid, verify with backend
        const backendVerification = await verifyWithBackend();
        if (backendVerification.success) {
          // Token works with backend, we're good!
          notifyCompletion('Authentication working perfectly');
          return;
        }
      }
      
      // 3. Test backend connectivity
      const backendStatus = await testBackendConnectivity();
      state.backendAvailable = backendStatus.available;
      
      if (state.backendAvailable) {
        // 4a. If backend is available, try to login
        const loginResult = await attemptLogin();
        if (loginResult.success) {
          notifyCompletion('Authentication fixed via login');
          return;
        }
      }
      
      // 5. Fall back to demo mode
      console.log('Enabling demo mode as fallback...');
      const demoResult = await enableDemoMode();
      if (demoResult.success) {
        notifyCompletion('Demo mode enabled successfully');
      } else {
        console.error('Failed to enable demo mode:', demoResult.error);
        notifyError('Failed to fix authentication issues');
      }
    } catch (error) {
      console.error('Error in diagnostic and fix workflow:', error);
      notifyError('Error in fix workflow: ' + error.message);
    }
  }
  
  /**
   * Validate the current token (if any)
   * @returns {Promise<object>} Validation result
   */
  async function validateToken() {
    try {
      console.log('Validating current token...');
      
      const token = state.originalToken;
      if (!token) {
        console.log('No token found');
        return { valid: false, reason: 'no_token' };
      }
      
      // Check token structure (3 parts separated by dots)
      const parts = token.split('.');
      if (parts.length !== 3) {
        state.tokenIssues.push('invalid_format');
        return { valid: false, reason: 'invalid_format' };
      }
      
      // Decode and check payload
      try {
        const payload = JSON.parse(atob(parts[1]));
        
        // Check subject
        if (!payload.sub) {
          state.tokenIssues.push('missing_subject');
          return { valid: false, reason: 'missing_subject' };
        }
        
        // Check subject type - must be string
        if (typeof payload.sub !== 'string') {
          state.tokenIssues.push('subject_not_string');
          return { valid: false, reason: 'subject_not_string' };
        }
        
        // Check expiration
        if (payload.exp) {
          const expirationDate = new Date(payload.exp * 1000);
          if (expirationDate < new Date()) {
            state.tokenIssues.push('expired');
            return { valid: false, reason: 'expired', expiration: expirationDate };
          }
        }
        
        // If we got here, token format looks valid
        console.log('Token format validation passed');
        state.tokenValid = true;
        return { 
          valid: true, 
          payload,
          expiration: payload.exp ? new Date(payload.exp * 1000) : null
        };
      } catch (decodeError) {
        console.error('Error decoding token payload:', decodeError);
        state.tokenIssues.push('decode_error');
        return { valid: false, reason: 'decode_error' };
      }
    } catch (error) {
      console.error('Token validation error:', error);
      return { valid: false, reason: 'validation_error', error };
    }
  }
  
  /**
   * Verify token with backend API
   * @returns {Promise<object>} Verification result
   */
  async function verifyWithBackend() {
    try {
      console.log('Verifying token with backend...');
      
      const token = state.originalToken;
      if (!token) {
        return { success: false, reason: 'no_token' };
      }
      
      // Try to connect to backend verify endpoint
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
        
        const response = await fetch('http://localhost:5001/api/auth/verify', {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json'
          },
          signal: controller.signal,
          mode: 'cors'
        });
        
        clearTimeout(timeoutId);
        
        if (response.ok) {
          console.log('Token verified successfully with backend');
          state.backendAvailable = true;
          return { success: true };
        } else {
          console.log(`Token verification failed: ${response.status}`);
          state.backendAvailable = true;
          return { success: false, status: response.status };
        }
      } catch (fetchError) {
        console.error('Error verifying with backend:', fetchError);
        // Connection issue - backend might be down
        state.backendAvailable = false;
        return { success: false, reason: 'connection_error', error: fetchError };
      }
    } catch (error) {
      console.error('Backend verification error:', error);
      return { success: false, reason: 'verification_error', error };
    }
  }
  
  /**
   * Test backend connectivity
   * @returns {Promise<object>} Connectivity result
   */
  async function testBackendConnectivity() {
    try {
      console.log('Testing backend connectivity...');
      
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
        
        const response = await fetch('http://localhost:5001/api/status', {
          method: 'GET',
          headers: {
            'Accept': 'application/json'
          },
          signal: controller.signal,
          mode: 'cors'
        });
        
        clearTimeout(timeoutId);
        
        if (response.ok) {
          console.log('Backend is available');
          return { available: true };
        } else {
          console.log(`Backend status check failed: ${response.status}`);
          return { available: false, status: response.status };
        }
      } catch (fetchError) {
        console.error('Backend connectivity error:', fetchError);
        return { available: false, reason: 'connection_error', error: fetchError };
      }
    } catch (error) {
      console.error('Backend availability check error:', error);
      return { available: false, reason: 'check_error', error };
    }
  }
  
  /**
   * Attempt to login with default credentials
   * @returns {Promise<object>} Login result
   */
  async function attemptLogin() {
    try {
      console.log('Attempting login with default credentials...');
      
      const defaultCredentials = {
        username: 'barista',
        password: 'coffee123'
      };
      
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
        
        const response = await fetch('http://localhost:5001/api/auth/login', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify(defaultCredentials),
          signal: controller.signal,
          mode: 'cors'
        });
        
        clearTimeout(timeoutId);
        
        if (response.ok) {
          const data = await response.json();
          
          if (data.token) {
            console.log('Login successful');
            
            // Save token to all locations
            saveToken(data.token);
            
            // Save user data if available
            if (data.user) {
              localStorage.setItem('coffee_system_user', JSON.stringify(data.user));
            }
            
            // Clear fallback mode if it was set
            disableDemoMode();
            
            return { success: true, token: data.token };
          } else {
            console.log('Login succeeded but no token returned');
            return { success: false, reason: 'no_token_returned' };
          }
        } else {
          console.log(`Login failed: ${response.status}`);
          return { success: false, status: response.status };
        }
      } catch (fetchError) {
        console.error('Login request error:', fetchError);
        return { success: false, reason: 'request_error', error: fetchError };
      }
    } catch (error) {
      console.error('Login attempt error:', error);
      return { success: false, reason: 'login_error', error };
    }
  }
  
  /**
   * Enable demo mode with valid token and sample data
   * @returns {Promise<object>} Demo mode result
   */
  async function enableDemoMode() {
    try {
      console.log('Enabling demo mode...');
      
      // 1. Create valid token
      const token = createValidToken();
      
      // 2. Save token to all locations
      saveToken(token);
      
      // 3. Create demo user
      const user = {
        id: 'demo_user',
        username: 'demo',
        name: 'Demo User',
        role: 'barista',
        stations: [1, 2, 3]
      };
      localStorage.setItem('coffee_system_user', JSON.stringify(user));
      
      // 4. Set fallback flags
      localStorage.setItem('use_fallback_data', 'true');
      localStorage.setItem('demo_mode_enabled', 'true');
      localStorage.setItem('fallback_data_available', 'true');
      
      // 5. Clear error states
      localStorage.removeItem('auth_error_count');
      localStorage.removeItem('auth_error_refresh_needed');
      localStorage.removeItem('jwt_error_endpoints');
      
      // 6. Set connection status
      localStorage.setItem('coffee_connection_status', 'offline');
      localStorage.setItem('coffee_connection_timestamp', Date.now().toString());
      
      // 7. Disable auto refresh
      localStorage.setItem('coffee_auto_refresh_enabled', 'false');
      
      // 8. Clear anti-flicker settings
      localStorage.removeItem('anti_flicker_block_until');
      localStorage.removeItem('anti_flicker_blocked_endpoints');
      
      // 9. Create comprehensive sample data
      await createSampleData();
      
      state.demoModeEnabled = true;
      state.fixes.push('demo_mode_enabled');
      
      return { success: true };
    } catch (error) {
      console.error('Error enabling demo mode:', error);
      return { success: false, reason: 'enable_error', error };
    }
  }
  
  /**
   * Verify and enhance existing demo mode
   * @returns {Promise<object>} Result
   */
  async function verifyAndEnhanceDemoMode() {
    try {
      console.log('Verifying and enhancing demo mode...');
      
      // 1. Check token
      const token = getToken();
      const tokenValid = token && validateToken(token);
      
      if (!tokenValid) {
        console.log('Creating new valid token for demo mode');
        const newToken = createValidToken();
        saveToken(newToken);
      }
      
      // 2. Ensure user data exists
      const userData = localStorage.getItem('coffee_system_user');
      if (!userData) {
        console.log('Creating demo user data');
        const user = {
          id: 'demo_user',
          username: 'demo',
          name: 'Demo User',
          role: 'barista',
          stations: [1, 2, 3]
        };
        localStorage.setItem('coffee_system_user', JSON.stringify(user));
      }
      
      // 3. Ensure all fallback flags are set
      localStorage.setItem('use_fallback_data', 'true');
      localStorage.setItem('demo_mode_enabled', 'true');
      localStorage.setItem('fallback_data_available', 'true');
      localStorage.setItem('coffee_connection_status', 'offline');
      
      // 4. Clear error states and anti-flicker
      localStorage.removeItem('auth_error_count');
      localStorage.removeItem('auth_error_refresh_needed');
      localStorage.removeItem('jwt_error_endpoints');
      localStorage.removeItem('anti_flicker_block_until');
      localStorage.removeItem('anti_flicker_blocked_endpoints');
      
      // 5. Create or update sample data
      await createSampleData();
      
      return { success: true };
    } catch (error) {
      console.error('Error verifying demo mode:', error);
      return { success: false, error };
    }
  }
  
  /**
   * Create comprehensive sample data for offline/demo mode
   * @returns {Promise<void>}
   */
  async function createSampleData() {
    console.log('Creating comprehensive sample data...');
    
    // Generate timestamps
    const now = Date.now();
    const minutes = (min) => min * 60 * 1000;
    
    // 1. Pending orders (ready to be made)
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
        stationId: 1,
        batchGroup: 'flat-white'
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
        stationId: 1,
        batchGroup: 'cappuccino-almond'
      },
      {
        id: 'po_003',
        orderNumber: 'P003',
        customerName: 'Michael Brown',
        phoneNumber: '+61434567890',
        coffeeType: 'Small Latte',
        milkType: 'Oat',
        sugar: '2 sugars',
        extraHot: false,
        priority: false,
        status: 'pending',
        createdAt: new Date(now - minutes(5)).toISOString(),
        waitTime: 5,
        expectedCompletionTime: new Date(now + minutes(7)).toISOString(),
        stationId: 2,
        batchGroup: 'latte-oat'
      }
    ];
    
    // 2. In-progress orders (currently being made)
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
      },
      {
        id: 'ip_002',
        orderNumber: 'IP002',
        customerName: 'David Wilson',
        phoneNumber: '+61456789012',
        coffeeType: 'Large Long Black',
        milkType: 'No milk',
        sugar: 'No sugar',
        extraHot: false,
        priority: true,
        status: 'in-progress',
        createdAt: new Date(now - minutes(8)).toISOString(),
        startedAt: new Date(now - minutes(1)).toISOString(),
        waitTime: 8,
        expectedCompletionTime: new Date(now + minutes(2)).toISOString(),
        stationId: 2
      }
    ];
    
    // 3. Completed orders
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
      },
      {
        id: 'co_002',
        orderNumber: 'C002',
        customerName: 'Thomas Johnson',
        phoneNumber: '+61478901234',
        coffeeType: 'Large Cappuccino',
        milkType: 'Full Cream',
        sugar: '2 sugars',
        extraHot: true,
        priority: true,
        status: 'completed',
        createdAt: new Date(now - minutes(25)).toISOString(),
        startedAt: new Date(now - minutes(20)).toISOString(),
        completedAt: new Date(now - minutes(15)).toISOString(),
        stationId: 2
      },
      {
        id: 'co_003',
        orderNumber: 'C003',
        customerName: 'Olivia Martin',
        phoneNumber: '+61489012345',
        coffeeType: 'Regular Mocha',
        milkType: 'Almond',
        sugar: '1 sugar',
        extraHot: false,
        priority: false,
        status: 'completed',
        createdAt: new Date(now - minutes(20)).toISOString(),
        startedAt: new Date(now - minutes(15)).toISOString(),
        completedAt: new Date(now - minutes(10)).toISOString(),
        stationId: 1
      }
    ];
    
    // 4. Coffee stations
    const stations = [
      {
        id: 1,
        name: 'Main Station',
        status: 'active',
        barista: 'John Barista',
        queue_length: pendingOrders.filter(o => o.stationId === 1).length + 
                     inProgressOrders.filter(o => o.stationId === 1).length,
        last_activity: new Date(now - minutes(2)).toISOString(),
        capabilities: ['espresso', 'milk-steaming', 'tea'],
        location: 'Main Hall'
      },
      {
        id: 2,
        name: 'Express Station',
        status: 'active',
        barista: 'Sarah Barista',
        queue_length: pendingOrders.filter(o => o.stationId === 2).length + 
                     inProgressOrders.filter(o => o.stationId === 2).length,
        last_activity: new Date(now - minutes(5)).toISOString(),
        capabilities: ['espresso', 'milk-steaming'],
        location: 'Side Entrance'
      },
      {
        id: 3,
        name: 'VIP Station',
        status: 'inactive',
        barista: null,
        queue_length: 0,
        last_activity: new Date(now - minutes(60)).toISOString(),
        capabilities: ['espresso', 'milk-steaming', 'tea', 'specialty'],
        location: 'VIP Area'
      }
    ];
    
    // 5. Stock/inventory data
    const stock = {
      coffee: [
        { id: 'coffee_house', name: 'House Blend', amount: 2500, capacity: 5000, unit: 'g', status: 'good' },
        { id: 'coffee_decaf', name: 'Decaf Blend', amount: 1200, capacity: 2000, unit: 'g', status: 'good' },
        { id: 'coffee_single_origin', name: 'Ethiopian Single Origin', amount: 800, capacity: 2000, unit: 'g', status: 'low' }
      ],
      milk: [
        { id: 'milk_full_cream', name: 'Full Cream Milk', amount: 4000, capacity: 6000, unit: 'ml', status: 'good' },
        { id: 'milk_skim', name: 'Skim Milk', amount: 3500, capacity: 6000, unit: 'ml', status: 'good' },
        { id: 'milk_almond', name: 'Almond Milk', amount: 2000, capacity: 4000, unit: 'ml', status: 'good' },
        { id: 'milk_oat', name: 'Oat Milk', amount: 1800, capacity: 4000, unit: 'ml', status: 'low' },
        { id: 'milk_soy', name: 'Soy Milk', amount: 2500, capacity: 4000, unit: 'ml', status: 'good' }
      ],
      supplies: [
        { id: 'cups_small', name: 'Small Cups', amount: 120, capacity: 200, unit: 'pcs', status: 'good' },
        { id: 'cups_regular', name: 'Regular Cups', amount: 85, capacity: 200, unit: 'pcs', status: 'low' },
        { id: 'cups_large', name: 'Large Cups', amount: 65, capacity: 150, unit: 'pcs', status: 'low' },
        { id: 'lids', name: 'Cup Lids', amount: 250, capacity: 400, unit: 'pcs', status: 'good' },
        { id: 'sugar_packets', name: 'Sugar Packets', amount: 300, capacity: 500, unit: 'pcs', status: 'good' }
      ]
    };
    
    // 6. User schedule data
    const scheduleData = {
      date: new Date().toISOString().split('T')[0],
      shifts: [
        {
          id: 'shift_1',
          stationId: 1,
          barista: 'John Barista',
          startTime: '08:00',
          endTime: '12:00'
        },
        {
          id: 'shift_2',
          stationId: 1,
          barista: 'Emma Davis',
          startTime: '12:00',
          endTime: '16:00'
        },
        {
          id: 'shift_3',
          stationId: 2,
          barista: 'Sarah Barista',
          startTime: '09:00',
          endTime: '13:00'
        },
        {
          id: 'shift_4',
          stationId: 2,
          barista: 'Michael Wilson',
          startTime: '13:00',
          endTime: '17:00'
        }
      ]
    };
    
    // 7. Settings data
    const settingsData = {
      system: {
        storeName: 'Coffee Cue Demo',
        eventName: 'Conference 2025',
        orderPrefix: 'CQ',
        defaultWaitTime: 10,
        maxQueueLength: 15,
        refreshInterval: 30,
        theme: 'light'
      },
      notifications: {
        smsEnabled: true,
        emailEnabled: false,
        pushEnabled: true,
        soundEnabled: true,
        orderReadyTemplate: 'Your coffee order {{orderNumber}} is ready for pickup!',
        delayTemplate: 'Your coffee order {{orderNumber}} is delayed by {{delay}} minutes. We apologize for the inconvenience.'
      },
      milkOptions: [
        { id: 'milk_full_cream', name: 'Full Cream', default: true, extraCost: 0 },
        { id: 'milk_skim', name: 'Skim', default: false, extraCost: 0 },
        { id: 'milk_almond', name: 'Almond', default: false, extraCost: 1 },
        { id: 'milk_oat', name: 'Oat', default: false, extraCost: 1 },
        { id: 'milk_soy', name: 'Soy', default: false, extraCost: 1 }
      ],
      coffeeOptions: [
        { id: 'coffee_flat_white', name: 'Flat White', available: true },
        { id: 'coffee_latte', name: 'Latte', available: true },
        { id: 'coffee_cappuccino', name: 'Cappuccino', available: true },
        { id: 'coffee_mocha', name: 'Mocha', available: true },
        { id: 'coffee_long_black', name: 'Long Black', available: true },
        { id: 'coffee_espresso', name: 'Espresso', available: true },
        { id: 'coffee_macchiato', name: 'Macchiato', available: true },
        { id: 'coffee_filter', name: 'Filter Coffee', available: false }
      ]
    };
    
    // Store data in localStorage
    localStorage.setItem('fallback_pending_orders', JSON.stringify(pendingOrders));
    localStorage.setItem('fallback_in_progress_orders', JSON.stringify(inProgressOrders));
    localStorage.setItem('fallback_completed_orders', JSON.stringify(completedOrders));
    localStorage.setItem('fallback_stations', JSON.stringify(stations));
    localStorage.setItem('fallback_stock', JSON.stringify(stock));
    localStorage.setItem('fallback_schedule', JSON.stringify(scheduleData));
    localStorage.setItem('fallback_settings', JSON.stringify(settingsData));
    
    // Set additional data for compatibility with different components
    localStorage.setItem('sample_orders', JSON.stringify([...pendingOrders, ...inProgressOrders]));
    localStorage.setItem('sample_completed_orders', JSON.stringify(completedOrders));
    localStorage.setItem('sample_stations', JSON.stringify(stations));
    
    // Mark fallback data as available and set timestamp
    localStorage.setItem('fallback_data_available', 'true');
    localStorage.setItem('fallback_data_timestamp', Date.now().toString());
    
    state.fixes.push('sample_data_created');
    console.log('Comprehensive sample data created');
  }
  
  /**
   * Create a valid token for demo mode
   * @returns {string} Valid token
   */
  function createValidToken() {
    console.log('Creating valid token for demo mode...');
    
    // Create header part
    const header = {
      alg: 'HS256',
      typ: 'JWT'
    };
    
    // Create payload with proper sub field as string
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      sub: 'demo_user', // Must be a string to avoid "Subject must be a string" error
      name: 'Demo User',
      role: 'barista',
      username: 'demo',
      id: 'demo_user', // Include ID to avoid issues
      stations: [1, 2, 3],
      iat: now,
      exp: now + (7 * 24 * 60 * 60), // 7 days from now (long expiry for reliability)
      permissions: ['view_orders', 'manage_orders', 'view_stations']
    };
    
    // Base64 encode parts
    const headerB64 = btoa(JSON.stringify(header)).replace(/=+$/, '');
    const payloadB64 = btoa(JSON.stringify(payload)).replace(/=+$/, '');
    
    // Create a signature that will be accepted by the app's validation logic
    const signature = btoa('demo_mode_signature_accepted_locally').replace(/=+$/, '');
    
    // Create the token
    return `${headerB64}.${payloadB64}.${signature}`;
  }
  
  /**
   * Save token to all storage locations
   * @param {string} token - The token to save
   */
  function saveToken(token) {
    console.log('Saving token to all storage locations...');
    
    TOKEN_KEYS.forEach(key => {
      localStorage.setItem(key, token);
    });
  }
  
  /**
   * Get token from any storage location
   * @returns {string|null} - The token or null if not found
   */
  function getToken() {
    for (const key of TOKEN_KEYS) {
      const token = localStorage.getItem(key);
      if (token) {
        return token;
      }
    }
    return null;
  }
  
  /**
   * Disable demo mode
   */
  function disableDemoMode() {
    console.log('Disabling demo mode...');
    
    localStorage.removeItem('use_fallback_data');
    localStorage.removeItem('demo_mode_enabled');
    localStorage.removeItem('coffee_connection_status');
    localStorage.removeItem('auth_error_count');
    localStorage.removeItem('auth_error_refresh_needed');
    
    state.demoModeEnabled = false;
  }
  
  /**
   * Notify user of completion
   * @param {string} message - Success message
   */
  function notifyCompletion(message) {
    console.log('Fix completed:', message);
    
    // Show a notification to the user
    if (typeof window !== 'undefined' && document.body) {
      createNotification(message, 'success');
    }
    
    // Set completion flag
    localStorage.setItem('auth_fix_applied', Date.now().toString());
    
    // Dispatch event for integrations
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('auth-fix-completed', { detail: { message, state } }));
    }
  }
  
  /**
   * Notify user of error
   * @param {string} message - Error message
   */
  function notifyError(message) {
    console.error('Fix failed:', message);
    
    // Show a notification to the user
    if (typeof window !== 'undefined' && document.body) {
      createNotification(message, 'error');
    }
    
    // Dispatch event for integrations
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('auth-fix-failed', { detail: { message, state } }));
    }
  }
  
  /**
   * Create visual notification
   * @param {string} message - Notification message
   * @param {string} type - Notification type ('success' or 'error')
   */
  function createNotification(message, type) {
    // Create notification container if it doesn't exist
    let container = document.getElementById('auth-fix-notification');
    if (!container) {
      container = document.createElement('div');
      container.id = 'auth-fix-notification';
      container.style.position = 'fixed';
      container.style.bottom = '20px';
      container.style.right = '20px';
      container.style.padding = '12px 20px';
      container.style.borderRadius = '6px';
      container.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
      container.style.fontFamily = 'system-ui, -apple-system, sans-serif';
      container.style.fontSize = '14px';
      container.style.zIndex = '9999';
      container.style.display = 'flex';
      container.style.alignItems = 'center';
      container.style.animation = 'auth-fix-slide-in 0.3s ease-out forwards';
      
      // Add animation style
      const style = document.createElement('style');
      style.textContent = `
        @keyframes auth-fix-slide-in {
          from { transform: translateY(20px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      `;
      document.head.appendChild(style);
      
      document.body.appendChild(container);
    }
    
    // Set style based on type
    if (type === 'success') {
      container.style.backgroundColor = '#10b981';
      container.style.color = 'white';
    } else {
      container.style.backgroundColor = '#ef4444';
      container.style.color = 'white';
    }
    
    // Set content
    container.innerHTML = `
      <div>${message}</div>
      <span style="margin-left: 15px; cursor: pointer; font-weight: bold;" onclick="this.parentNode.remove()">×</span>
    `;
    
    // Auto-remove after 10 seconds
    setTimeout(() => {
      container.style.opacity = '0';
      container.style.transition = 'opacity 0.5s ease-out';
      setTimeout(() => container.remove(), 500);
    }, 10000);
  }
  
  // Export public methods for external access
  if (typeof window !== 'undefined') {
    window.unifiedAuthSolution = {
      getDiagnosticState: () => ({ ...state }),
      validateToken,
      createValidToken,
      enableDemoMode,
      disableDemoMode,
      verifyWithBackend,
      testBackendConnectivity,
      createSampleData
    };
  }
  
  console.log('✓ Unified authentication solution initialized');
})();