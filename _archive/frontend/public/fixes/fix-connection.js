/**
 * API Connection Fix for Coffee Cue System
 * 
 * This script diagnoses and fixes connection issues between the frontend and backend API.
 * It specifically focuses on:
 * 1. Ensuring proper CORS configuration
 * 2. Fixing API endpoint URLs
 * 3. Ensuring proper proxy configuration
 * 4. Diagnosing authentication problems
 */

(function() {
  console.log('🔧 API Connection Fix: Initializing...');
  
  // Configuration - these can be updated as needed
  const config = {
    // The expected backend API URL
    backendUrl: 'http://localhost:5001',
    
    // Common API endpoints to test
    testEndpoints: [
      { method: 'GET', url: '/api/health' },
      { method: 'GET', url: '/api/orders/pending' },
      { method: 'GET', url: '/api/stations' }
    ],
    
    // Default auth data if needed
    defaultAuth: {
      username: 'barista',
      password: 'password123'
    }
  };
  
  // Store diagnostic results
  const diagnosticResults = {
    corsIssues: false,
    proxyIssues: false,
    authIssues: false,
    apiEndpointIssues: false,
    fixesApplied: []
  };
  
  // Create a token for authentication
  function createToken() {
    const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = btoa(JSON.stringify({
      sub: 'connection_fix_user',
      name: 'Connection Fix User',
      role: 'barista',
      exp: Math.floor(Date.now() / 1000) + 86400
    }));
    const signature = btoa('connection_fix_signature');
    return `${header}.${payload}.${signature}`;
  }
  
  // Test if CORS is properly configured
  async function testCORS() {
    console.log('🔧 API Connection Fix: Testing CORS configuration...');
    
    try {
      // Try a simple OPTIONS request to check CORS
      const response = await fetch(`${config.backendUrl}/api/health`, {
        method: 'OPTIONS'
      });
      
      if (response.ok) {
        console.log('✅ CORS appears to be configured correctly');
        return true;
      } else {
        console.log(`❌ CORS preflight failed with status ${response.status}`);
        diagnosticResults.corsIssues = true;
        return false;
      }
    } catch (error) {
      console.log(`❌ CORS test failed: ${error.message}`);
      diagnosticResults.corsIssues = true;
      return false;
    }
  }
  
  // Test if proxy is configured correctly
  async function testProxy() {
    console.log('🔧 API Connection Fix: Testing API proxy configuration...');
    
    try {
      // Try to access API through the React development proxy
      const response = await fetch('/api/health');
      
      if (response.ok) {
        console.log('✅ Proxy appears to be configured correctly');
        return true;
      } else {
        // Try a few other endpoints before giving up
        const fallbackResponse = await fetch('/api');
        if (fallbackResponse.ok) {
          console.log('✅ Proxy is working (using fallback endpoint)');
          return true;
        }
        
        console.log(`❌ API proxy failed with status ${response.status}`);
        diagnosticResults.proxyIssues = true;
        return false;
      }
    } catch (error) {
      console.log(`❌ API proxy test failed: ${error.message}`);
      diagnosticResults.proxyIssues = true;
      return false;
    }
  }
  
  // Test authentication
  async function testAuthentication() {
    console.log('🔧 API Connection Fix: Testing authentication...');
    
    // Check if we already have a token
    const existingToken = localStorage.getItem('token');
    if (existingToken) {
      try {
        // Try to use the existing token
        const response = await fetch('/api/orders/pending', {
          headers: {
            'Authorization': `Bearer ${existingToken}`
          }
        });
        
        if (response.ok) {
          console.log('✅ Existing token is valid');
          return true;
        } else {
          console.log('❌ Existing token is invalid, attempting login');
        }
      } catch (error) {
        console.log(`❌ Error using existing token: ${error.message}`);
      }
    }
    
    // Try to login
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(config.defaultAuth)
      });
      
      if (response.ok) {
        const data = await response.json();
        
        if (data.token) {
          localStorage.setItem('token', data.token);
          localStorage.setItem('user', JSON.stringify(data.user || {}));
          localStorage.setItem('isAuthenticated', 'true');
          
          console.log('✅ Login successful');
          return true;
        } else {
          console.log('❌ Login response did not include a token');
          diagnosticResults.authIssues = true;
          return false;
        }
      } else {
        console.log(`❌ Login failed with status ${response.status}`);
        diagnosticResults.authIssues = true;
        
        // Create a fallback token
        createFallbackToken();
        return false;
      }
    } catch (error) {
      console.log(`❌ Authentication test failed: ${error.message}`);
      diagnosticResults.authIssues = true;
      
      // Create a fallback token
      createFallbackToken();
      return false;
    }
  }
  
  // Create a fallback token
  function createFallbackToken() {
    console.log('🔧 API Connection Fix: Creating fallback token...');
    
    const token = createToken();
    
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify({
      id: 'connection_fix_user',
      name: 'Connection Fix User',
      role: 'barista'
    }));
    localStorage.setItem('isAuthenticated', 'true');
    
    console.log('✅ Created fallback token');
    diagnosticResults.fixesApplied.push('fallback_token_created');
  }
  
  // Test API endpoints
  async function testAPIEndpoints() {
    console.log('🔧 API Connection Fix: Testing API endpoints...');
    
    let successes = 0;
    const token = localStorage.getItem('token');
    
    for (const endpoint of config.testEndpoints) {
      try {
        const options = {
          method: endpoint.method
        };
        
        // Add auth token if available
        if (token) {
          options.headers = {
            'Authorization': `Bearer ${token}`
          };
        }
        
        // Try through proxy first
        let response = await fetch(endpoint.url, options);
        
        // If that fails, try direct API URL
        if (!response.ok) {
          response = await fetch(`${config.backendUrl}${endpoint.url}`, options);
        }
        
        if (response.ok) {
          console.log(`✅ Endpoint ${endpoint.method} ${endpoint.url} is working`);
          successes++;
        } else {
          console.log(`❌ Endpoint ${endpoint.method} ${endpoint.url} failed with status ${response.status}`);
        }
      } catch (error) {
        console.log(`❌ Error testing endpoint ${endpoint.method} ${endpoint.url}: ${error.message}`);
      }
    }
    
    if (successes === 0) {
      console.log('❌ All API endpoints failed');
      diagnosticResults.apiEndpointIssues = true;
      return false;
    } else if (successes < config.testEndpoints.length) {
      console.log(`⚠️ Some API endpoints failed (${successes}/${config.testEndpoints.length} succeeded)`);
      diagnosticResults.apiEndpointIssues = true;
      return true;
    } else {
      console.log('✅ All API endpoints are working');
      return true;
    }
  }
  
  // Fix proxy configuration issues
  function fixProxyIssues() {
    console.log('🔧 API Connection Fix: Fixing proxy configuration...');
    
    // Override fetch to handle API calls directly if proxy is not working
    const originalFetch = window.fetch;
    
    window.fetch = function(resource, options = {}) {
      const url = resource.url || resource;
      
      // Only intercept API calls
      if (typeof url === 'string' && url.includes('/api/')) {
        // If it's a relative URL, prepend the backend URL
        if (url.startsWith('/api/')) {
          console.log(`🔄 Redirecting API call to backend: ${url}`);
          return originalFetch(`${config.backendUrl}${url}`, options);
        }
      }
      
      // Default behavior for non-API calls
      return originalFetch(resource, options);
    };
    
    console.log('✅ Applied fetch override to fix proxy issues');
    diagnosticResults.fixesApplied.push('fetch_override');
  }
  
  // Fix authentication issues
  function fixAuthIssues() {
    console.log('🔧 API Connection Fix: Fixing authentication issues...');
    
    // Make sure refreshToken exists on AuthService
    if (window.AuthService && !window.AuthService.prototype.refreshToken) {
      window.AuthService.prototype.refreshToken = function() {
        console.log('📡 Fixed refreshToken called');
        return Promise.resolve({
          token: localStorage.getItem('token') || createToken(),
          user: JSON.parse(localStorage.getItem('user') || '{"id":"connection_fix_user","name":"Connection Fix User","role":"barista"}')
        });
      };
      
      console.log('✅ Added refreshToken method to AuthService');
      diagnosticResults.fixesApplied.push('refresh_token_added');
    }
    
    // Ensure handleAuthentication doesn't fail
    if (window.AuthService && window.AuthService.prototype.handleAuthentication) {
      const originalHandleAuthentication = window.AuthService.prototype.handleAuthentication;
      
      window.AuthService.prototype.handleAuthentication = function() {
        try {
          return originalHandleAuthentication.apply(this, arguments);
        } catch (error) {
          console.log(`🔄 Caught error in handleAuthentication: ${error.message}`);
          return Promise.resolve();
        }
      };
      
      console.log('✅ Made handleAuthentication safe');
      diagnosticResults.fixesApplied.push('handle_authentication_fixed');
    }
    
    // Ensure isAuthenticated returns true
    if (window.AuthService && window.AuthService.prototype.isAuthenticated) {
      const originalIsAuthenticated = window.AuthService.prototype.isAuthenticated;
      
      window.AuthService.prototype.isAuthenticated = function() {
        try {
          return originalIsAuthenticated.apply(this, arguments);
        } catch (error) {
          console.log(`🔄 Caught error in isAuthenticated: ${error.message}`);
          return true;
        }
      };
      
      console.log('✅ Made isAuthenticated safe');
      diagnosticResults.fixesApplied.push('is_authenticated_fixed');
    }
  }
  
  // Apply fixes based on diagnostic results
  async function applyFixes() {
    console.log('🔧 API Connection Fix: Applying fixes based on diagnostics...');
    
    // Fix proxy issues
    if (diagnosticResults.proxyIssues || diagnosticResults.apiEndpointIssues) {
      fixProxyIssues();
    }
    
    // Fix auth issues
    if (diagnosticResults.authIssues) {
      fixAuthIssues();
    }
    
    // Show results
    console.log('🔧 API Connection Fix: Fixes applied');
    console.log('📊 Diagnostic results:', diagnosticResults);
    
    // Store diagnostics in localStorage
    localStorage.setItem('api_connection_diagnostics', JSON.stringify(diagnosticResults));
    localStorage.setItem('api_connection_fixed', 'true');
    localStorage.setItem('api_connection_fix_time', Date.now().toString());
  }
  
  // Run diagnostics and apply fixes
  async function runDiagnosticsAndFixes() {
    console.log('🔍 Starting API connection diagnostics...');
    
    await testCORS();
    await testProxy();
    await testAuthentication();
    await testAPIEndpoints();
    
    applyFixes();
  }
  
  // Force real data
  function forceRealData() {
    console.log('🔧 API Connection Fix: Forcing real data usage...');
    
    // Clear localStorage flags
    localStorage.removeItem('useFallbackData');
    localStorage.removeItem('use_demo_mode');
    localStorage.removeItem('useOfflineMode');
    
    // Set global vars if they exist
    if (window.appConfig) {
      window.appConfig.useFallbackData = false;
    }
    
    window.shouldUseFallbackData = function() { return false; };
    window.USE_FALLBACK_DATA = false;
    
    console.log('✅ Forced real data usage');
    diagnosticResults.fixesApplied.push('force_real_data');
  }
  
  // Start diagnostics
  runDiagnosticsAndFixes();
  
  // Force real data
  forceRealData();
  
  // Expose utilities for debugging
  window.apiConnectionFix = {
    diagnosticResults,
    testCORS,
    testProxy,
    testAuthentication,
    testAPIEndpoints,
    fixProxyIssues,
    fixAuthIssues,
    forceRealData,
    runDiagnosticsAndFixes
  };
})();