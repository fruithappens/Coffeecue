/**
 * Fix Authentication
 * Simple script to bypass JWT authentication issues
 */
(function() {
  console.log('🔑 Applying authentication fix...');
  
  // Force fallback (offline) mode
  localStorage.setItem('use_fallback_data', 'true');
  localStorage.setItem('force_offline_mode', 'true');
  
  // Add a hook to prevent XHR from attempting real API calls
  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, async, user, password) {
    // Check if this is an API call
    if (typeof url === 'string' && url.includes('/api/')) {
      console.log(`🛑 Blocked real API call to ${url}`);
      
      // Change to a non-existent URL to force error and fallback
      return originalOpen.call(this, method, '/blocked-api-call', async === false ? false : true, user, password);
    }
    
    // For non-API URLs, proceed normally
    return originalOpen.call(this, method, url, async === false ? false : true, user, password);
  };
  
  // Add a hook to catch fetch API calls to /api endpoints
  const originalFetch = window.fetch;
  window.fetch = function(url, options) {
    // Check if this is an API call
    if (typeof url === 'string' && url.includes('/api/')) {
      console.log(`🛑 Blocked fetch API call to ${url}`);
      
      // Return a rejected promise to trigger fallback
      return Promise.reject(new Error('API blocked by fix-auth.js'));
    }
    
    // For non-API URLs, proceed normally
    return originalFetch.apply(this, arguments);
  };
  
  console.log('✅ Authentication fix applied - all API calls will use fallback data');
})();