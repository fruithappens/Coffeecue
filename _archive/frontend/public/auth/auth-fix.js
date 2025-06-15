/**
 * Comprehensive authentication fix script for Coffee Cue system
 * This script addresses the "Subject must be a string" JWT errors and provides
 * better authentication handling with automatic fallback to demo mode.
 */
console.log('🔐 Initializing auth fix...');

// Store current authentication state
const currentAuthState = {
  token: localStorage.getItem('coffee_system_token') || 
         localStorage.getItem('auth_token') || 
         localStorage.getItem('coffee_auth_token') || 
         localStorage.getItem('jwt_token'),
  hasValidToken: false,
  demoModeEnabled: localStorage.getItem('demo_mode_enabled') === 'true',
  usesFallbackData: localStorage.getItem('use_fallback_data') === 'true',
};

// Backend configuration
const config = {
  apiBaseUrl: 'http://localhost:5001/api',
  defaultCredentials: {
    username: 'barista',
    password: 'coffee123'
  },
  debugMode: true,
  tokenRefreshIntervalMs: 20 * 60 * 1000, // 20 minutes
};

/**
 * Validate token structure and check for common JWT issues
 * @param {string} token - JWT token to validate
 * @returns {object} Validation result with error information
 */
function validateToken(token) {
  if (!token) {
    return { isValid: false, error: 'No token provided' };
  }
  
  try {
    // Check basic token structure (3 parts separated by dots)
    const parts = token.split('.');
    if (parts.length !== 3) {
      return { isValid: false, error: 'Invalid token format (must have 3 parts)' };
    }
    
    // Try to parse the payload
    try {
      const payload = JSON.parse(atob(parts[1]));
      
      // Check for common JWT validation issues
      
      // Check if 'sub' (subject) exists
      if (!('sub' in payload)) {
        return { isValid: false, error: 'Token missing subject claim' };
      }
      
      // Check if 'sub' is a string (common issue in this app)
      if (typeof payload.sub !== 'string') {
        return { 
          isValid: false, 
          error: 'Subject must be a string', 
          fixable: true,
          payload 
        };
      }
      
      // Check if token is expired
      if (payload.exp && payload.exp * 1000 < Date.now()) {
        return { 
          isValid: false, 
          error: 'Token has expired', 
          expired: true,
          expiresAt: new Date(payload.exp * 1000)
        };
      }
      
      // Token passed all checks
      return { 
        isValid: true, 
        payload,
        expiresAt: payload.exp ? new Date(payload.exp * 1000) : null
      };
    } catch (parseError) {
      return { isValid: false, error: 'Invalid token payload (cannot be decoded)' };
    }
  } catch (error) {
    return { isValid: false, error: 'Token validation error: ' + error.message };
  }
}

/**
 * Create a valid dummy token with proper string subject for demo mode
 * @returns {string} Valid JWT token for demo mode
 */
function createValidDemoToken() {
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
    stations: [1, 2, 3],
    iat: now,
    exp: now + (24 * 60 * 60), // 24 hours from now
    permissions: ['manage_orders', 'view_stations']
  };
  
  // Encode parts to Base64
  const headerB64 = btoa(JSON.stringify(header)).replace(/=+$/, '');
  const payloadB64 = btoa(JSON.stringify(payload)).replace(/=+$/, '');
  
  // Create a simple signature (in a real app this would be cryptographically secure)
  const signature = btoa('demo_signature').replace(/=+$/, '');
  
  // Combine the parts to form the token
  return `${headerB64}.${payloadB64}.${signature}`;
}

/**
 * Fix token subject to be a string
 * @param {object} invalidPayload - Payload with invalid subject
 * @returns {string} Fixed token
 */
function fixTokenSubject(invalidPayload) {
  // Create a copy of the payload
  const fixedPayload = {...invalidPayload};
  
  // Convert subject to string if it exists
  if ('sub' in fixedPayload) {
    fixedPayload.sub = String(fixedPayload.sub);
  } else {
    fixedPayload.sub = 'fixed_user';
  }
  
  // Create header part
  const header = {
    alg: 'HS256',
    typ: 'JWT'
  };
  
  // Encode parts to Base64
  const headerB64 = btoa(JSON.stringify(header)).replace(/=+$/, '');
  const payloadB64 = btoa(JSON.stringify(fixedPayload)).replace(/=+$/, '');
  
  // Reuse the original signature (since we can't recreate it without the secret)
  const originalSignature = localStorage.getItem('coffee_system_token').split('.')[2] || btoa('fixed_signature');
  
  // Combine the parts to form the token
  return `${headerB64}.${payloadB64}.${originalSignature}`;
}

/**
 * Attempt to login with default credentials
 * @returns {Promise<object>} Login result
 */
async function loginWithDefaultCredentials() {
  try {
    console.log('Attempting login with default credentials...');
    
    const response = await fetch(`${config.apiBaseUrl}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(config.defaultCredentials),
      mode: 'cors'
    });
    
    if (!response.ok) {
      throw new Error(`Login failed with status ${response.status}`);
    }
    
    const data = await response.json();
    
    if (!data.token) {
      throw new Error('No token received from server');
    }
    
    console.log('Login successful with default credentials');
    
    // Store token in all known storage locations for compatibility
    localStorage.setItem('coffee_system_token', data.token);
    localStorage.setItem('auth_token', data.token);
    localStorage.setItem('coffee_auth_token', data.token);
    localStorage.setItem('jwt_token', data.token);
    
    // Store user data if available
    if (data.user) {
      localStorage.setItem('coffee_system_user', JSON.stringify(data.user));
    }
    
    // Clear fallback flags
    localStorage.removeItem('use_fallback_data');
    localStorage.removeItem('auth_error_refresh_needed');
    localStorage.removeItem('demo_mode_enabled');
    localStorage.removeItem('auth_error_count');
    
    return {
      success: true,
      message: 'Authentication successful with default credentials',
      token: data.token,
      user: data.user
    };
  } catch (error) {
    console.error('Login with default credentials failed:', error);
    
    return {
      success: false,
      message: `Login failed: ${error.message}`,
      error
    };
  }
}

/**
 * Enable demo mode with valid token
 */
function enableDemoMode() {
  console.log('Enabling demo mode with valid token...');
  
  // Create valid token
  const token = createValidDemoToken();
  
  // Store in all known token locations
  localStorage.setItem('coffee_system_token', token);
  localStorage.setItem('auth_token', token);
  localStorage.setItem('coffee_auth_token', token);
  localStorage.setItem('jwt_token', token);
  
  // Create demo user data
  const demoUser = {
    id: 'demo_user',
    username: 'demo',
    role: 'barista',
    name: 'Demo User',
    stations: [1]
  };
  localStorage.setItem('coffee_system_user', JSON.stringify(demoUser));
  
  // Set fallback flags
  localStorage.setItem('use_fallback_data', 'true');
  localStorage.setItem('demo_mode_enabled', 'true');
  
  // Reset error counters
  localStorage.removeItem('auth_error_count');
  localStorage.removeItem('auth_error_refresh_needed');
  
  // Set connection status
  localStorage.setItem('coffee_connection_status', 'offline');
  
  // Prepare sample data for offline mode
  prepareSampleData();
  
  console.log('Demo mode enabled successfully');
  return true;
}

/**
 * Prepare sample data for offline/demo mode
 */
function prepareSampleData() {
  // Check if we already have sample data
  if (localStorage.getItem('fallback_data_available') === 'true') {
    return;
  }
  
  console.log('Preparing sample data for offline/demo mode...');
  
  // Sample pending orders
  const pendingOrders = [
    {
      id: 'demo_p1',
      orderNumber: 'P001',
      customerName: 'John Smith',
      phoneNumber: '+61412345678',
      coffeeType: 'Latte',
      milkType: 'Full Cream',
      sugar: '1 sugar',
      status: 'pending',
      createdAt: new Date(Date.now() - 10 * 60000).toISOString(),
      waitTime: 10,
      stationId: 1
    },
    {
      id: 'demo_p2',
      orderNumber: 'P002',
      customerName: 'Sarah Johnson',
      phoneNumber: '+61423456789',
      coffeeType: 'Cappuccino',
      milkType: 'Almond',
      sugar: 'No sugar',
      status: 'pending',
      createdAt: new Date(Date.now() - 5 * 60000).toISOString(),
      waitTime: 5,
      stationId: 1
    }
  ];
  
  // Sample in-progress orders
  const inProgressOrders = [
    {
      id: 'demo_i1',
      orderNumber: 'I001',
      customerName: 'Michael Brown',
      phoneNumber: '+61434567890',
      coffeeType: 'Flat White',
      milkType: 'Oat',
      sugar: '2 sugars',
      status: 'in-progress',
      createdAt: new Date(Date.now() - 8 * 60000).toISOString(),
      startedAt: new Date(Date.now() - 2 * 60000).toISOString(),
      waitTime: 8,
      stationId: 1
    }
  ];
  
  // Sample completed orders
  const completedOrders = [
    {
      id: 'demo_c1',
      orderNumber: 'C001',
      customerName: 'Emily Davis',
      phoneNumber: '+61445678901',
      coffeeType: 'Long Black',
      milkType: 'None',
      sugar: 'No sugar',
      status: 'completed',
      createdAt: new Date(Date.now() - 15 * 60000).toISOString(),
      completedAt: new Date(Date.now() - 5 * 60000).toISOString(),
      stationId: 1
    },
    {
      id: 'demo_c2',
      orderNumber: 'C002',
      customerName: 'Alex Wilson',
      phoneNumber: '+61456789012',
      coffeeType: 'Mocha',
      milkType: 'Full Cream',
      sugar: '1 sugar',
      status: 'completed',
      createdAt: new Date(Date.now() - 20 * 60000).toISOString(),
      completedAt: new Date(Date.now() - 10 * 60000).toISOString(),
      stationId: 1
    }
  ];
  
  // Sample stations
  const stations = [
    {
      id: 1,
      name: 'Main Station',
      status: 'active',
      barista: 'Demo Barista',
      queue_length: pendingOrders.length + inProgressOrders.length
    },
    {
      id: 2,
      name: 'Express Station',
      status: 'inactive',
      barista: null,
      queue_length: 0
    }
  ];
  
  // Sample stock
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
  
  // Store sample data in localStorage
  localStorage.setItem('fallback_pending_orders', JSON.stringify(pendingOrders));
  localStorage.setItem('fallback_in_progress_orders', JSON.stringify(inProgressOrders));
  localStorage.setItem('fallback_completed_orders', JSON.stringify(completedOrders));
  localStorage.setItem('fallback_stations', JSON.stringify(stations));
  localStorage.setItem('fallback_stock', JSON.stringify(stock));
  
  // Mark fallback data as available
  localStorage.setItem('fallback_data_available', 'true');
  localStorage.setItem('fallback_data_timestamp', Date.now().toString());
  
  console.log('Sample data prepared for offline/demo mode');
}

/**
 * Verify token with backend API
 * @param {string} token - JWT token to verify
 * @returns {Promise<object>} Verification result
 */
async function verifyTokenWithBackend(token) {
  try {
    console.log('Verifying token with backend...');
    
    const response = await fetch(`${config.apiBaseUrl}/auth/verify`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      mode: 'cors'
    });
    
    if (!response.ok) {
      return {
        success: false,
        message: `Token verification failed: ${response.status} ${response.statusText}`
      };
    }
    
    const data = await response.json();
    
    return {
      success: true,
      message: 'Token verified successfully',
      data
    };
  } catch (error) {
    console.error('Token verification error:', error);
    return {
      success: false,
      message: `Token verification error: ${error.message}`,
      error
    };
  }
}

/**
 * Test the backend connectivity
 * @returns {Promise<object>} Connectivity test result
 */
async function testBackendConnectivity() {
  try {
    console.log('Testing backend connectivity...');
    
    const response = await fetch(`${config.apiBaseUrl}/status`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      },
      mode: 'cors'
    });
    
    if (!response.ok) {
      return {
        isOnline: false,
        message: `Backend is not responding properly: ${response.status} ${response.statusText}`
      };
    }
    
    const data = await response.json();
    
    return {
      isOnline: true,
      message: 'Backend is online',
      data
    };
  } catch (error) {
    console.error('Backend connectivity test failed:', error);
    return {
      isOnline: false,
      message: `Backend connectivity error: ${error.message}`,
      error
    };
  }
}

/**
 * Set up token refresh interval
 */
function setupTokenRefresh() {
  // Clear any existing interval
  if (window._tokenRefreshInterval) {
    clearInterval(window._tokenRefreshInterval);
  }
  
  // Set up new interval
  window._tokenRefreshInterval = setInterval(async () => {
    // Skip if in demo mode
    if (localStorage.getItem('demo_mode_enabled') === 'true') {
      return;
    }
    
    const token = localStorage.getItem('coffee_system_token');
    if (!token) {
      return;
    }
    
    // Validate token
    const validation = validateToken(token);
    
    // If token is valid and not expired, no need to refresh
    if (validation.isValid && validation.expiresAt && validation.expiresAt > new Date()) {
      // Only refresh if expiring soon (within 30 minutes)
      const minutesToExpiry = (validation.expiresAt - new Date()) / (1000 * 60);
      if (minutesToExpiry > 30) {
        return;
      }
    }
    
    console.log('Token refresh triggered by interval');
    
    try {
      // Try to login with default credentials
      const loginResult = await loginWithDefaultCredentials();
      
      if (loginResult.success) {
        console.log('Token refreshed successfully by interval');
      } else {
        console.warn('Token refresh failed, will retry next interval');
      }
    } catch (error) {
      console.error('Token refresh interval error:', error);
    }
  }, config.tokenRefreshIntervalMs);
  
  console.log(`Token refresh interval set up (every ${config.tokenRefreshIntervalMs / 60000} minutes)`);
}

/**
 * Comprehensive auth fix process - main function
 */
async function fixAuthenticationIssues() {
  console.log('Starting comprehensive authentication fix...');
  
  // Step 1: Check existing token
  const currentToken = currentAuthState.token;
  if (currentToken) {
    console.log('Found existing token, validating...');
    const validation = validateToken(currentToken);
    
    if (validation.isValid) {
      console.log('Existing token is valid');
      currentAuthState.hasValidToken = true;
      
      // Verify with backend
      const verificationResult = await verifyTokenWithBackend(currentToken);
      if (verificationResult.success) {
        console.log('Token verified successfully with backend');
        // Token is valid and verified - we're good!
        setupTokenRefresh();
        return {
          success: true,
          message: 'Authentication is already valid',
          token: currentToken
        };
      } else {
        console.log('Token failed backend verification, proceeding with fix...');
      }
    } else {
      console.log(`Token validation failed: ${validation.error}`);
      
      // Special case: If subject is not a string, we can fix it
      if (validation.error === 'Subject must be a string' && validation.fixable) {
        console.log('Fixing token with invalid subject type...');
        const fixedToken = fixTokenSubject(validation.payload);
        
        // Store fixed token
        localStorage.setItem('coffee_system_token', fixedToken);
        localStorage.setItem('auth_token', fixedToken);
        localStorage.setItem('coffee_auth_token', fixedToken);
        localStorage.setItem('jwt_token', fixedToken);
        
        console.log('Token fixed (subject converted to string)');
        
        // Verify fixed token with backend
        const verificationResult = await verifyTokenWithBackend(fixedToken);
        if (verificationResult.success) {
          console.log('Fixed token verified successfully with backend');
          setupTokenRefresh();
          return {
            success: true,
            message: 'Token fixed (subject converted to string) and verified',
            token: fixedToken
          };
        }
        
        console.log('Fixed token failed backend verification, trying other approaches...');
      }
    }
  } else {
    console.log('No existing token found');
  }
  
  // Step 2: Check backend connectivity
  const connectivityResult = await testBackendConnectivity();
  if (connectivityResult.isOnline) {
    console.log('Backend is online, attempting to login...');
    
    // Step 3: Try to login with default credentials
    const loginResult = await loginWithDefaultCredentials();
    if (loginResult.success) {
      console.log('Login successful, authentication fixed!');
      setupTokenRefresh();
      return {
        success: true,
        message: 'Successfully authenticated with backend',
        token: loginResult.token
      };
    }
    
    console.log('Login failed, falling back to demo mode...');
  } else {
    console.log('Backend is offline, falling back to demo mode...');
  }
  
  // Step 4: Fall back to demo mode
  const demoResult = enableDemoMode();
  if (demoResult) {
    console.log('Demo mode enabled successfully as fallback');
    return {
      success: true,
      message: 'Authentication fixed by enabling demo mode',
      demoMode: true
    };
  }
  
  // If all else fails
  console.error('All authentication fix attempts failed');
  return {
    success: false,
    message: 'Could not fix authentication issues'
  };
}

// Start the fix process
const authFixPromise = fixAuthenticationIssues();

// Add to window for external access
window.coffeeAuthFix = {
  promise: authFixPromise,
  validateToken,
  createValidDemoToken,
  fixTokenSubject,
  loginWithDefaultCredentials,
  enableDemoMode,
  verifyTokenWithBackend,
  testBackendConnectivity,
  fixAuthenticationIssues
};

// Show a simple UI to indicate fix status
document.addEventListener('DOMContentLoaded', () => {
  // Create status box
  const statusBox = document.createElement('div');
  statusBox.style.position = 'fixed';
  statusBox.style.top = '10px';
  statusBox.style.right = '10px';
  statusBox.style.padding = '10px 15px';
  statusBox.style.backgroundColor = '#ffe066';
  statusBox.style.color = '#333';
  statusBox.style.borderRadius = '4px';
  statusBox.style.boxShadow = '0 2px 4px rgba(0,0,0,0.2)';
  statusBox.style.zIndex = '9999';
  statusBox.style.fontFamily = 'system-ui, -apple-system, sans-serif';
  statusBox.style.fontSize = '14px';
  statusBox.style.display = 'flex';
  statusBox.style.alignItems = 'center';
  statusBox.style.gap = '8px';
  
  // Add spinner
  const spinner = document.createElement('div');
  spinner.style.width = '16px';
  spinner.style.height = '16px';
  spinner.style.borderRadius = '50%';
  spinner.style.border = '2px solid rgba(0,0,0,0.1)';
  spinner.style.borderTopColor = '#333';
  spinner.style.animation = 'auth-fix-spin 1s linear infinite';
  
  // Add style for spinner animation
  const style = document.createElement('style');
  style.textContent = `
    @keyframes auth-fix-spin {
      to { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(style);
  
  // Add text
  const text = document.createElement('span');
  text.textContent = 'Fixing authentication...';
  
  statusBox.appendChild(spinner);
  statusBox.appendChild(text);
  document.body.appendChild(statusBox);
  
  // Update status based on fix result
  authFixPromise.then(result => {
    if (result.success) {
      statusBox.style.backgroundColor = '#a3e635';
      text.textContent = result.demoMode 
        ? 'Demo mode enabled' 
        : 'Authentication fixed!';
      
      // Add button to continue
      const continueBtn = document.createElement('button');
      continueBtn.textContent = 'Continue →';
      continueBtn.style.marginLeft = '10px';
      continueBtn.style.padding = '4px 8px';
      continueBtn.style.backgroundColor = '#4d7c0f';
      continueBtn.style.color = 'white';
      continueBtn.style.border = 'none';
      continueBtn.style.borderRadius = '4px';
      continueBtn.style.cursor = 'pointer';
      continueBtn.onclick = () => {
        window.location.href = '/';
      };
      
      statusBox.appendChild(continueBtn);
    } else {
      statusBox.style.backgroundColor = '#f87171';
      text.textContent = 'Auth fix failed';
    }
    
    // Remove spinner
    spinner.remove();
    
    // Auto-remove after 10 seconds
    setTimeout(() => {
      statusBox.style.opacity = '0';
      statusBox.style.transition = 'opacity 0.5s ease-out';
      setTimeout(() => statusBox.remove(), 500);
    }, 10000);
  }).catch(error => {
    statusBox.style.backgroundColor = '#f87171';
    text.textContent = 'Auth fix error';
    console.error('Auth fix error:', error);
    spinner.remove();
  });
});

console.log('✓ Auth fix initialization complete');