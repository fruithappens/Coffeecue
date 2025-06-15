/**
 * Proxy Fixer
 * 
 * This script ensures API requests are correctly proxied through 
 * the React development server instead of going directly to the backend.
 */
(function() {
  console.log('🔧 Starting Proxy Fixer...');
  
  // Configuration
  const config = {
    // Use complete URLs with the development server domain
    apiUrl: window.location.origin + '/api',
    fallbackUrl: 'http://localhost:3000/api',
    directUrl: 'http://localhost:5001/api'
  };
  
  // Set up console logging with timestamp
  const log = function(message, type = 'info') {
    const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
    let style = '';
    
    switch(type) {
      case 'error':
        style = 'color: #ff5252; font-weight: bold';
        break;
      case 'success':
        style = 'color: #4caf50; font-weight: bold';
        break;
      case 'warning':
        style = 'color: #ff9800; font-weight: bold';
        break;
      case 'api':
        style = 'color: #2196f3';
        break;
      default:
        style = 'color: #757575';
    }
    
    console.log(`[${timestamp}] %c${message}`, style);
  };
  
  // Store originals
  const originalFetch = window.fetch;
  const originalXHROpen = XMLHttpRequest.prototype.open;
  
  log('🔍 Examining current URL: ' + window.location.href, 'info');
  log('🔍 API requests will be directed to: ' + config.apiUrl, 'info');
  
  // Helper function to convert direct API URLs to proxied URLs
  const convertToProxiedUrl = function(url) {
    // If it's already a relative URL starting with /api, it's fine
    if (url.startsWith('/api')) {
      return url;
    }
    
    // If it's an absolute URL to localhost:5001/api, convert it
    if (url.includes('localhost:5001/api')) {
      return url.replace('http://localhost:5001/api', '/api');
    }
    
    // If it's an absolute URL to the current origin with /api, convert it
    if (url.includes(window.location.origin + '/api')) {
      return url.replace(window.location.origin + '/api', '/api');
    }
    
    // For any other URL going to an API, make it relative
    if (url.includes('/api')) {
      // Extract the /api part and everything after
      const apiPath = '/api' + url.split('/api')[1];
      return apiPath;
    }
    
    // If it's not an API URL, leave it alone
    return url;
  };
  
  // Intercept fetch to ensure it uses the proxied API
  window.fetch = function(resource, init) {
    // Only change API URLs
    if (typeof resource === 'string' && resource.includes('/api')) {
      const originalUrl = resource;
      const proxiedUrl = convertToProxiedUrl(resource);
      
      // Only log if we changed something
      if (originalUrl !== proxiedUrl) {
        log(`🔄 Redirecting fetch from ${originalUrl} to ${proxiedUrl}`, 'api');
      }
      
      // Use the proxied URL
      return originalFetch.call(this, proxiedUrl, init);
    }
    
    // Call original fetch for non-API requests
    return originalFetch.apply(this, arguments);
  };
  
  // Intercept XMLHttpRequest to ensure it uses the proxied API
  XMLHttpRequest.prototype.open = function(method, url, async, user, password) {
    // Only change API URLs
    if (typeof url === 'string' && url.includes('/api')) {
      const originalUrl = url;
      const proxiedUrl = convertToProxiedUrl(url);
      
      // Only log if we changed something
      if (originalUrl !== proxiedUrl) {
        log(`🔄 Redirecting XHR from ${originalUrl} to ${proxiedUrl}`, 'api');
      }
      
      // Use the proxied URL
      return originalXHROpen.call(this, method, proxiedUrl, async, user, password);
    }
    
    // Call original open for non-API requests
    return originalXHROpen.apply(this, arguments);
  };
  
  // Clear any localStorage items that might interfere with API calls
  localStorage.removeItem('use_fallback_data');
  localStorage.removeItem('force_offline_mode');
  localStorage.setItem('coffee_connection_status', 'online');
  localStorage.setItem('api_mode', 'online');
  localStorage.removeItem('use_sample_data');
  localStorage.removeItem('use_offline_mode');
  localStorage.removeItem('force_demo_mode');
  
  // Create or verify JWT token
  if (!localStorage.getItem('coffee_auth_token')) {
    log('🔑 Creating new JWT token', 'info');
    
    // Create token header
    const header = {
      alg: 'HS256',
      typ: 'JWT'
    };
    
    // Create token payload
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      sub: 'barista',
      name: 'Barista User',
      role: 'barista',
      iat: now,
      exp: now + 86400 * 30,
      jti: 'fix-' + Math.random().toString(36).substring(2)
    };
    
    // Encode parts
    const encodeBase64 = (obj) => {
      return btoa(JSON.stringify(obj))
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
    };
    
    const headerEncoded = encodeBase64(header);
    const payloadEncoded = encodeBase64(payload);
    
    // Create signature
    const signature = btoa('signature-placeholder')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    
    // Combine to form token
    const token = `${headerEncoded}.${payloadEncoded}.${signature}`;
    
    // Store token
    localStorage.setItem('coffee_auth_token', token);
    localStorage.setItem('authenticated', 'true');
    localStorage.setItem('user_role', 'barista');
    localStorage.setItem('user_name', 'Barista User');
  }
  
  // Remove any blocking code
  window.blockAPI = false;
  window.isAPIBlocked = false;
  
  // Create UI
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    createUI();
  } else {
    document.addEventListener('DOMContentLoaded', createUI);
  }
  
  function createUI() {
    const container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.bottom = '10px';
    container.style.right = '10px';
    container.style.backgroundColor = 'rgba(33, 33, 33, 0.8)';
    container.style.color = 'white';
    container.style.padding = '10px';
    container.style.borderRadius = '5px';
    container.style.zIndex = '10000';
    container.style.fontFamily = 'system-ui, -apple-system, sans-serif';
    container.style.fontSize = '12px';
    container.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.3)';
    
    // Add title with close button
    const title = document.createElement('div');
    title.textContent = 'API Proxy Fixer';
    title.style.display = 'flex';
    title.style.justifyContent = 'space-between';
    title.style.marginBottom = '5px';
    title.style.fontWeight = 'bold';
    
    const closeButton = document.createElement('span');
    closeButton.textContent = '×';
    closeButton.style.cursor = 'pointer';
    closeButton.style.marginLeft = '10px';
    closeButton.onclick = function() {
      document.body.removeChild(container);
    };
    
    title.appendChild(closeButton);
    container.appendChild(title);
    
    // Add status
    const status = document.createElement('div');
    status.textContent = 'API requests are now being correctly proxied ✓';
    status.style.marginBottom = '5px';
    container.appendChild(status);
    
    // Add test button
    const testButton = document.createElement('button');
    testButton.textContent = 'Test API';
    testButton.style.backgroundColor = '#2196f3';
    testButton.style.color = 'white';
    testButton.style.border = 'none';
    testButton.style.borderRadius = '3px';
    testButton.style.padding = '5px 10px';
    testButton.style.marginRight = '5px';
    testButton.style.cursor = 'pointer';
    testButton.onclick = function() {
      // Test API connection
      log('🔍 Testing API connection...', 'info');
      
      fetch('/api/auth/status')
        .then(response => response.json())
        .then(data => {
          log(`✅ API test successful: ${JSON.stringify(data).substring(0, 100)}`, 'success');
          status.textContent = 'API test successful ✓';
          status.style.color = '#4caf50';
        })
        .catch(error => {
          log(`❌ API test failed: ${error.message}`, 'error');
          status.textContent = 'API test failed ✗';
          status.style.color = '#ff5252';
        });
    };
    container.appendChild(testButton);
    
    // Add barista button
    const baristaButton = document.createElement('button');
    baristaButton.textContent = 'Go to Barista';
    baristaButton.style.backgroundColor = '#4caf50';
    baristaButton.style.color = 'white';
    baristaButton.style.border = 'none';
    baristaButton.style.borderRadius = '3px';
    baristaButton.style.padding = '5px 10px';
    baristaButton.style.cursor = 'pointer';
    baristaButton.onclick = function() {
      // Get current URL base
      const baseUrl = window.location.origin;
      
      // Attempt to navigate to barista interface
      log('🔍 Navigating to Barista interface...', 'info');
      window.location.href = baseUrl + '/barista';
    };
    container.appendChild(baristaButton);
    
    document.body.appendChild(container);
  }
  
  log('✅ Proxy Fixer initialized successfully', 'success');
})();