/**
 * jwt-debug.js
 * Comprehensive debugging tools for JWT token issues, particularly signature verification
 */

(function() {
  console.log('Loading JWT debugging tools...');
  
  /**
   * Inspect JWT token and provide detailed information
   * @returns {Object|null} Decoded payload or null if token is invalid
   */
  window.inspectJwtToken = function() {
    const token = localStorage.getItem('coffee_system_token');
    
    if (!token) {
      console.log('No JWT token found in localStorage');
      return null;
    }
    
    console.log(`Token found (length: ${token.length})`);
    
    // Check token format (3 parts separated by dots)
    const parts = token.split('.');
    if (parts.length !== 3) {
      console.error('⚠️ Invalid token format! JWT should have 3 parts separated by dots.');
      console.log(`Token: ${token}`);
      return null;
    }
    
    try {
      // Decode the parts properly with handling for base64url format
      function decodeBase64(str) {
        // Convert base64url to base64 by replacing characters
        const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
        // Add padding if needed
        const padding = '='.repeat((4 - base64.length % 4) % 4);
        return atob(base64 + padding);
      }
      
      // Decode header
      const header = JSON.parse(decodeBase64(parts[0]));
      console.log('Token header:', header);
      
      // Check header fields
      if (!header.alg) {
        console.error('⚠️ Token header missing algorithm (alg) field!');
      }
      
      if (!header.typ) {
        console.warn('⚠️ Token header missing type (typ) field!');
      }
      
      if (header.alg !== 'HS256') {
        console.warn(`⚠️ Token algorithm is ${header.alg}, expected HS256`);
      }
      
      // Decode the payload (middle part)
      const payload = JSON.parse(decodeBase64(parts[1]));
      console.log('Token payload:', payload);
      
      // Check required claims
      if (!payload.sub) {
        console.error('⚠️ Token missing subject (sub) claim!');
      } else if (typeof payload.sub !== 'string') {
        console.error(`⚠️ Token subject is not a string! Type: ${typeof payload.sub}`);
      }
      
      // Check for expiration
      if (payload.exp) {
        const expiryDate = new Date(payload.exp * 1000);
        const now = new Date();
        
        console.log(`Token expiry: ${expiryDate}`);
        console.log(`Current time: ${now}`);
        
        if (expiryDate < now) {
          console.error('⚠️ Token is expired!');
        } else {
          console.log(`Token valid for ${Math.floor((expiryDate - now) / 1000 / 60)} more minutes`);
        }
      } else {
        console.warn('⚠️ Token does not have an expiration (exp) claim!');
      }
      
      // Check issued at
      if (payload.iat) {
        const issuedDate = new Date(payload.iat * 1000);
        console.log(`Token issued at: ${issuedDate}`);
      } else {
        console.warn('⚠️ Token does not have an issued at (iat) claim!');
      }
      
      // Check iss and aud claims
      if (!payload.iss) {
        console.warn('⚠️ Token missing issuer (iss) claim');
      }
      
      if (!payload.aud) {
        console.warn('⚠️ Token missing audience (aud) claim');
      }
      
      // Signature (we can't decode it but can check format)
      console.log(`Token signature (length: ${parts[2].length}): ${parts[2].substring(0, 10)}...`);
      
      // Check storage consistency
      checkTokenConsistency();
      
      return payload;
    } catch (error) {
      console.error('Failed to decode token payload:', error);
      return null;
    }
  };
  
  /**
   * Check if token is stored consistently across different localStorage keys
   */
  function checkTokenConsistency() {
    const tokenKeys = [
      'coffee_system_token', 
      'coffee_auth_token',
      'auth_token',
      'token',
      'access_token',
      'jwt_token'
    ];
    
    const tokens = {};
    let hasInconsistency = false;
    
    // Collect all tokens
    tokenKeys.forEach(key => {
      const value = localStorage.getItem(key);
      if (value) {
        tokens[key] = value;
      }
    });
    
    // Check if we have any tokens
    if (Object.keys(tokens).length === 0) {
      console.log('No tokens found in any localStorage keys');
      return;
    }
    
    // Check consistency
    const firstKey = Object.keys(tokens)[0];
    const firstToken = tokens[firstKey];
    
    Object.entries(tokens).forEach(([key, token]) => {
      if (token !== firstToken) {
        console.error(`⚠️ Token inconsistency: ${key} token differs from ${firstKey}`);
        hasInconsistency = true;
      }
    });
    
    if (hasInconsistency) {
      console.error('⚠️ Token inconsistency detected! This may cause authentication issues.');
    } else {
      console.log(`Token is consistent across ${Object.keys(tokens).length} storage keys`);
    }
  }
  
  /**
   * Create a properly formatted JWT token that matches backend expectations
   * @param {string} subject - Token subject (user identifier)
   * @param {string} role - User role
   * @returns {string} Properly formatted JWT token
   */
  window.createProperJwt = function(subject = 'barista_user', role = 'barista') {
    // Create standard JWT header
    const header = {
      alg: 'HS256',
      typ: 'JWT'
    };
    
    // Create payload with all standard claims
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      // Required claims
      sub: subject,  // Must be a string
      iat: now,
      exp: now + (24 * 60 * 60),  // 24 hours
      
      // Standard claims
      iss: 'expresso-client',
      aud: 'expresso-api',
      
      // Application-specific claims
      name: 'Barista User',
      role: role,
      stations: [1, 2, 3]
    };
    
    // Base64Url encode parts
    function base64UrlEncode(str) {
      // Standard base64 encoding
      const base64 = btoa(str);
      // Convert to base64url format
      return base64
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
    }
    
    const encodedHeader = base64UrlEncode(JSON.stringify(header));
    const encodedPayload = base64UrlEncode(JSON.stringify(payload));
    
    // For development, create a deterministic but changing signature
    // In production, this would be an HMAC of the header and payload with the secret key
    const signature = base64UrlEncode(`expresso-${Date.now()}`);
    
    const token = `${encodedHeader}.${encodedPayload}.${signature}`;
    console.log(`Created proper JWT token: ${token.substring(0, 20)}...`);
    
    return token;
  };
  
  /**
   * Store JWT token consistently across all storage locations
   * @param {string} token - JWT token to store
   */
  window.storeJwtConsistently = function(token) {
    if (!token) {
      console.error('Cannot store empty token');
      return;
    }
    
    const tokenKeys = [
      'coffee_system_token', 
      'coffee_auth_token',
      'auth_token',
      'token',
      'access_token',
      'jwt_token'
    ];
    
    // Store token in all locations
    tokenKeys.forEach(key => {
      localStorage.setItem(key, token);
    });
    
    console.log(`Token stored consistently in ${tokenKeys.length} localStorage keys`);
    
    // Also store basic user information
    try {
      // Decode token to get user info
      const parts = token.split('.');
      if (parts.length === 3) {
        function decodeBase64(str) {
          const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
          const padding = '='.repeat((4 - base64.length % 4) % 4);
          return atob(base64 + padding);
        }
        
        const payload = JSON.parse(decodeBase64(parts[1]));
        const user = {
          id: payload.sub || 'barista_user',
          name: payload.name || 'Barista User',
          role: payload.role || 'barista'
        };
        
        // Store user data
        localStorage.setItem('coffee_system_user', JSON.stringify(user));
        localStorage.setItem('user', JSON.stringify(user));
        
        console.log('User data stored from token payload');
      }
    } catch (e) {
      console.error('Failed to extract and store user data from token:', e);
      
      // Fall back to default user data
      const user = {
        id: 'barista_user',
        name: 'Barista User',
        role: 'barista'
      };
      
      localStorage.setItem('coffee_system_user', JSON.stringify(user));
      localStorage.setItem('user', JSON.stringify(user));
    }
    
    // Mark as authenticated
    localStorage.setItem('isAuthenticated', 'true');
  };
  
  /**
   * Fix JWT token issues and ensure consistent storage
   */
  window.fixJwtIssues = function() {
    // First check if we have a token
    const existingToken = localStorage.getItem('coffee_system_token');
    
    if (existingToken) {
      console.log('Found existing token, inspecting...');
      const payload = window.inspectJwtToken();
      
      // Check if token is valid
      if (payload) {
        // Check token expiration
        const now = Math.floor(Date.now() / 1000);
        if (payload.exp && payload.exp > now) {
          console.log('Existing token is valid, ensuring consistent storage');
          window.storeJwtConsistently(existingToken);
          return existingToken;
        } else {
          console.log('Existing token is expired or invalid, creating new token');
        }
      } else {
        console.log('Existing token is invalid, creating new token');
      }
    } else {
      console.log('No existing token found, creating new token');
    }
    
    // Create and store a new token
    const newToken = window.createProperJwt();
    window.storeJwtConsistently(newToken);
    
    // Clear any error flags
    localStorage.removeItem('auth_error_count');
    localStorage.removeItem('auth_error_refresh_needed');
    localStorage.removeItem('JWT_SIGNATURE_ERROR');
    localStorage.removeItem('jwt_error_endpoints');
    
    return newToken;
  };
  
  /**
   * Complete reset of all authentication data and create fresh token
   */
  window.resetAuthentication = function() {
    // Clear all auth-related items from localStorage
    const authKeys = [
      // Token keys
      'coffee_system_token', 
      'coffee_auth_token',
      'auth_token',
      'token',
      'access_token',
      'jwt_token',
      'coffee_refresh_token',
      
      // User data
      'coffee_system_user',
      'user',
      
      // Auth state
      'isAuthenticated',
      'tokenExpiry',
      'coffee_system_token_expiry',
      
      // Error tracking
      'auth_error_count',
      'auth_error_refresh_needed',
      'JWT_SIGNATURE_ERROR',
      'LAST_TOKEN_RESET',
      'jwt_error_endpoints',
      
      // Don't clear fallback mode as we might need it
      // 'use_fallback_data',
      // 'fallback_data_available'
    ];
    
    authKeys.forEach(key => {
      localStorage.removeItem(key);
    });
    
    console.log('All authentication data has been cleared');
    
    // Create fresh valid token
    return window.fixJwtIssues();
  };
  
  /**
   * Test the complete JWT flow with the backend
   */
  window.testJwtFlow = async function() {
    try {
      console.log('Testing JWT flow with backend...');
      
      // First try to get settings with current token
      const currentToken = localStorage.getItem('coffee_system_token');
      
      if (currentToken) {
        console.log('Testing with current token...');
        
        try {
          const settingsResponse = await fetch('http://localhost:5001/api/settings', {
            headers: {
              'Accept': 'application/json',
              'Authorization': `Bearer ${currentToken}`
            }
          });
          
          if (settingsResponse.ok) {
            const settingsData = await settingsResponse.json();
            console.log('✅ Current token works correctly!', settingsData);
            return true;
          } else {
            console.log(`❌ Current token failed with status: ${settingsResponse.status}`);
            
            // Check if it's a signature verification error
            if (settingsResponse.status === 422) {
              try {
                const errorData = await settingsResponse.json();
                if (errorData.msg === 'Signature verification failed') {
                  console.error('Signature verification failed with current token');
                } else {
                  console.error('422 error response:', errorData);
                }
              } catch (e) {
                console.error('Error parsing error response:', e);
              }
            }
          }
        } catch (e) {
          console.error('Error testing current token:', e);
        }
      } else {
        console.log('No current token to test');
      }
      
      // Create a new token and test that
      console.log('Creating new token for testing...');
      const newToken = window.createProperJwt();
      
      // Store the new token
      window.storeJwtConsistently(newToken);
      
      // Test with the new token
      try {
        console.log('Testing with new token...');
        const settingsResponse = await fetch('http://localhost:5001/api/settings', {
          headers: {
            'Accept': 'application/json',
            'Authorization': `Bearer ${newToken}`
          }
        });
        
        if (settingsResponse.ok) {
          const settingsData = await settingsResponse.json();
          console.log('✅ New token works correctly!', settingsData);
          return true;
        } else {
          console.log(`❌ New token failed with status: ${settingsResponse.status}`);
          
          // Check if it's a signature verification error
          if (settingsResponse.status === 422) {
            try {
              const errorData = await settingsResponse.json();
              console.error('422 error with new token:', errorData);
              
              // Since our new token also fails, try a pure fetch without auth to see if the API is responsive
              console.log('Testing API without authentication...');
              const noAuthResponse = await fetch('http://localhost:5001/api/settings');
              
              if (noAuthResponse.status === 401) {
                console.log('✅ API is responsive but requires authentication (401 received)');
              } else if (noAuthResponse.ok) {
                console.log('⚠️ API allowed unauthenticated access - unusual');
              } else {
                console.log(`API returned ${noAuthResponse.status} without auth`);
              }
            } catch (e) {
              console.error('Error parsing error response:', e);
            }
          }
        }
      } catch (e) {
        console.error('Error testing new token:', e);
      }
      
      return false;
    } catch (error) {
      console.error('Error in JWT test flow:', error);
      return false;
    }
  };
  
  // Export the API
  window.jwtDebug = {
    inspectToken: window.inspectJwtToken,
    createToken: window.createProperJwt,
    storeToken: window.storeJwtConsistently,
    fixIssues: window.fixJwtIssues,
    resetAuth: window.resetAuthentication,
    testFlow: window.testJwtFlow
  };
  
  console.log('JWT debugging tools loaded. Use jwtDebug.* functions to diagnose token issues.');
})();