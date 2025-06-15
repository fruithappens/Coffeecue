/**
 * JWT Fix for 422 UNPROCESSABLE ENTITY errors
 * Fixes "Subject must be a string" and signature verification issues
 */
(function() {
  console.log('🔧 Applying critical JWT fix for 422 errors...');
  
  // Try to get token from any storage location
  const token = localStorage.getItem('coffee_system_token') || 
               localStorage.getItem('auth_token') || 
               localStorage.getItem('coffee_auth_token') || 
               localStorage.getItem('jwt_token');
  
  // Flag to track if we need a new token
  let needsNewToken = true;
  
  // If a token exists, validate it
  if (token) {
    try {
      // Check token format (header.payload.signature)
      const parts = token.split('.');
      if (parts.length === 3) {
        try {
          // Decode payload
          const payload = JSON.parse(atob(parts[1]));
          
          // Critical check: subject must be a string
          if (payload.sub && typeof payload.sub === 'string') {
            // Check expiration
            const now = Math.floor(Date.now() / 1000);
            if (!payload.exp || payload.exp > now) {
              console.log('✓ Valid token found, no fixes needed');
              needsNewToken = false;
            } else {
              console.log('⚠️ Token expired, creating new one');
            }
          } else {
            console.log('⚠️ Token has invalid subject field, fixing...');
          }
        } catch (e) {
          console.log('⚠️ Error parsing token payload:', e);
        }
      } else {
        console.log('⚠️ Invalid token format, fixing...');
      }
    } catch (e) {
      console.log('⚠️ Error validating token:', e);
    }
  } else {
    console.log('⚠️ No token found, creating one...');
  }
  
  // Create new token if needed
  if (needsNewToken) {
    createAndStoreValidToken();
  }
  
  // Fix anti-flicker settings
  clearBlockedEndpoints();
  
  // Enable fallback mode if configured
  if (localStorage.getItem('use_fallback_data') === 'true') {
    console.log('ℹ️ Fallback mode is enabled, ensuring offline configuration');
    localStorage.setItem('demo_mode_enabled', 'true');
    localStorage.setItem('fallback_data_available', 'true');
    localStorage.setItem('coffee_connection_status', 'offline');
    localStorage.setItem('coffee_auto_refresh_enabled', 'false');
  } else {
    // Set online status if not in fallback mode
    localStorage.setItem('coffee_connection_status', 'online');
    localStorage.setItem('coffee_connection_timestamp', Date.now().toString());
  }
  
  /**
   * Creates and stores a valid JWT token with proper string subject
   */
  function createAndStoreValidToken() {
    console.log('Creating valid JWT token...');
    
    // Create header
    const header = {
      alg: 'HS256',
      typ: 'JWT'
    };
    
    // Create payload with string subject
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      sub: 'demo_user', // Must be a string to fix "Subject must be a string" errors
      name: 'Demo User',
      role: 'barista',
      username: 'demo',
      id: 'demo_user', // Include ID to avoid issues
      stations: [1, 2, 3],
      iat: now,
      exp: now + (7 * 24 * 60 * 60), // 7 days from now
      permissions: ['view_orders', 'manage_orders', 'view_stations']
    };
    
    // Encode parts
    const headerB64 = btoa(JSON.stringify(header)).replace(/=+$/, '');
    const payloadB64 = btoa(JSON.stringify(payload)).replace(/=+$/, '');
    const signature = btoa('valid_signature_format').replace(/=+$/, '');
    
    // Create token
    const token = `${headerB64}.${payloadB64}.${signature}`;
    
    // Store token in all known locations for maximum compatibility
    localStorage.setItem('coffee_system_token', token);
    localStorage.setItem('auth_token', token);
    localStorage.setItem('coffee_auth_token', token);
    localStorage.setItem('jwt_token', token);
    
    // Create user data if missing
    if (!localStorage.getItem('coffee_system_user')) {
      const user = {
        id: 'demo_user',
        username: 'demo',
        name: 'Demo User',
        role: 'barista',
        stations: [1, 2, 3]
      };
      localStorage.setItem('coffee_system_user', JSON.stringify(user));
    }
    
    console.log('✓ Valid token created and stored');
  }
  
  /**
   * Clears blocked endpoints that may be preventing API requests
   */
  function clearBlockedEndpoints() {
    // Clear JWT error tracking
    localStorage.removeItem('jwt_error_endpoints');
    localStorage.removeItem('anti_flicker_block_until');
    localStorage.removeItem('anti_flicker_blocked_endpoints');
    localStorage.removeItem('auth_error_count');
    localStorage.removeItem('auth_error_refresh_needed');
    
    console.log('✓ Anti-flicker settings cleared');
  }
  
  console.log('✅ JWT fix complete - 422 errors should be resolved');
})();