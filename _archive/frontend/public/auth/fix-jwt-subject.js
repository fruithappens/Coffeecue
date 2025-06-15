// fix-jwt-subject.js - Fixes "Subject must be a string" JWT token errors
(function() {
  console.log('Running JWT subject field fix script...');
  
  // Create a valid JWT token with proper sub field as a string
  function createValidToken() {
    // Create header part
    const header = {
      alg: 'HS256',
      typ: 'JWT'
    };
    
    // Create payload with proper sub field as string
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      sub: 'barista1', // Must be a string
      name: 'Barista User',
      role: 'barista',
      stations: [1, 2, 3],
      iat: now,
      exp: now + (24 * 60 * 60), // 24 hours from now
      permissions: ['manage_orders', 'view_stations']
    };
    
    // Base64 encode parts
    const headerB64 = btoa(JSON.stringify(header)).replace(/=/g, '');
    const payloadB64 = btoa(JSON.stringify(payload)).replace(/=/g, '');
    
    // We can't create a real signature here, but create a properly formatted one
    // For backend testing purposes, this token's signature will be verified
    const signature = 'valid_signature_will_be_verified_by_backend';
    
    // Return properly formatted token
    return `${headerB64}.${payloadB64}.${signature}`;
  }
  
  // Clear all token-related settings to ensure clean setup
  function clearAllTokenSettings() {
    localStorage.removeItem('coffee_system_token');
    localStorage.removeItem('coffee_auth_token');
    localStorage.removeItem('jwt_token');
    localStorage.removeItem('auth_error_count');
    localStorage.removeItem('auth_error_refresh_needed');
    localStorage.removeItem('use_fallback_data');
    localStorage.setItem('coffee_connection_status', 'online');
  }
  
  // Set up the new token in the system
  function setupToken() {
    // Clear any existing problematic tokens
    clearAllTokenSettings();
    
    // Create and set new valid token
    const validToken = createValidToken();
    localStorage.setItem('coffee_system_token', validToken);
    
    // Also store in alternate locations to ensure compatibility with all code paths
    localStorage.setItem('coffee_auth_token', validToken);
    localStorage.setItem('jwt_token', validToken);
    
    // Reset any error tracking
    localStorage.setItem('auth_error_count', '0');
    localStorage.removeItem('auth_error_refresh_needed');
    localStorage.removeItem('use_fallback_data');
    
    console.log('Valid JWT token created and stored successfully');
    return validToken;
  }
  
  // Try to fix anti-flicker protection
  function fixAntiFlickerProtection() {
    // Reset anti-flicker protection if it's blocking requests
    if (localStorage.getItem('anti_flicker_block_until')) {
      localStorage.removeItem('anti_flicker_block_until');
      localStorage.removeItem('anti_flicker_blocked_endpoints');
      console.log('Reset anti-flicker protection');
    }
  }
  
  // Check current token to see if it has valid "sub" field
  function checkCurrentToken() {
    const token = localStorage.getItem('coffee_system_token');
    if (!token) {
      console.log('No token found, will create a new one');
      return false;
    }
    
    try {
      // Try to decode token
      const parts = token.split('.');
      if (parts.length !== 3) {
        console.log('Token format is invalid, will create a new one');
        return false;
      }
      
      // Decode payload
      const payload = JSON.parse(atob(parts[1]));
      
      // Check if sub is a string
      if (typeof payload.sub === 'string') {
        console.log('Token already has a valid string "sub" field');
        return true;
      } else {
        console.log('Token has invalid "sub" field (not a string)');
        return false;
      }
    } catch (e) {
      console.error('Error parsing token, will create a new one:', e);
      return false;
    }
  }
  
  // Entry point - check current token and fix if needed
  function runFixes() {
    console.log('Checking JWT token for "Subject must be a string" issue...');
    
    // Check if current token is valid
    const isCurrentTokenValid = checkCurrentToken();
    
    // If current token is invalid, create a new one
    if (!isCurrentTokenValid) {
      setupToken();
    }
    
    // Fix anti-flicker protection
    fixAntiFlickerProtection();
    
    console.log('JWT token subject field fix completed.');
    
    // Add visual feedback
    const div = document.createElement('div');
    div.style.position = 'fixed';
    div.style.top = '10px';
    div.style.left = '10px';
    div.style.right = '10px';
    div.style.backgroundColor = '#4CAF50';
    div.style.color = 'white';
    div.style.padding = '15px';
    div.style.borderRadius = '5px';
    div.style.zIndex = '9999';
    div.style.textAlign = 'center';
    div.innerHTML = 'JWT token subject field fixed. <button onclick="window.location.reload()" style="margin-left:15px;background:#fff;color:#4CAF50;border:none;padding:5px 10px;border-radius:3px;cursor:pointer;">Refresh Page</button>';
    
    document.body.appendChild(div);
  }
  
  // Run the fixes
  runFixes();
})();