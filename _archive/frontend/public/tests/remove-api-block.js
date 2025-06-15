/**
 * Remove API Block
 * 
 * This script removes the API blocking from fix-auth.js and 
 * allows real API calls to go through to the backend.
 */
(function() {
  console.log('🔓 Removing API blocking...');
  
  // Look for the API block in fix-auth.js
  if (window.blockAPI || window.isAPIBlocked) {
    console.log('🔓 Found API blocking function, disabling it');
    
    // Disable the blocking functions
    window.blockAPI = false;
    window.isAPIBlocked = false;
    
    console.log('✅ API blocking disabled');
  }
  
  // Check for intercepted fetch
  if (window.originalFetch && window.fetch !== window.originalFetch) {
    console.log('🔓 Restoring original fetch function');
    
    // Save a reference to the current intercepted fetch
    const interceptedFetch = window.fetch;
    
    // Create a new fetch that only intercepts if it's not an API call
    window.fetch = function(resource, init) {
      // If it's an API call, use the original fetch
      if (typeof resource === 'string' && resource.includes('/api/')) {
        console.log(`🔓 Allowing API call: ${resource}`);
        return window.originalFetch.apply(this, arguments);
      }
      
      // Otherwise, use the intercepted fetch
      return interceptedFetch.apply(this, arguments);
    };
    
    console.log('✅ Original fetch restored for API calls');
  }
  
  // Check for intercepted XMLHttpRequest
  if (window.originalXHROpen && XMLHttpRequest.prototype.open !== window.originalXHROpen) {
    console.log('🔓 Restoring original XMLHttpRequest functions');
    
    // Store the current intercepted functions
    const interceptedOpen = XMLHttpRequest.prototype.open;
    
    // Create a new open that only uses original for API calls
    XMLHttpRequest.prototype.open = function(method, url) {
      // Remember the URL for send
      this._url = url;
      
      // Log and use original for API calls
      if (typeof url === 'string' && url.includes('/api/')) {
        console.log(`🔓 Allowing XHR API call: ${url}`);
        return window.originalXHROpen.apply(this, arguments);
      }
      
      // Otherwise use intercepted
      return interceptedOpen.apply(this, arguments);
    };
    
    console.log('✅ Original XMLHttpRequest restored for API calls');
  }
  
  // Clear localStorage that might force fallback mode
  localStorage.removeItem('use_fallback_data');
  localStorage.removeItem('force_offline_mode');
  localStorage.removeItem('use_sample_data');
  localStorage.removeItem('use_offline_mode');
  localStorage.removeItem('force_demo_mode');
  localStorage.setItem('coffee_connection_status', 'online');
  localStorage.setItem('api_mode', 'online');
  
  // Clear fallback data
  const fallbackKeys = [
    'fallback_pending_orders',
    'fallback_in_progress_orders',
    'fallback_completed_orders',
    'sample_orders',
    'demo_orders',
    'coffee_fallback_data'
  ];
  fallbackKeys.forEach(key => localStorage.removeItem(key));
  
  console.log('✅ Cleared fallback settings and data');
  
  // Create a MutationObserver to watch for the insertion of fix-auth.js
  const observer = new MutationObserver(function(mutations) {
    mutations.forEach(function(mutation) {
      if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
        for (let i = 0; i < mutation.addedNodes.length; i++) {
          const node = mutation.addedNodes[i];
          
          // Check if it's a script node
          if (node.tagName === 'SCRIPT' && node.src && node.src.includes('fix-auth.js')) {
            console.log('⚠️ Detected fix-auth.js being loaded, will disable it');
            
            // Wait a moment for the script to load
            setTimeout(function() {
              // Disable API blocking
              if (window.blockAPI || window.isAPIBlocked) {
                console.log('🔓 Found API blocking function from fix-auth.js, disabling it');
                window.blockAPI = false;
                window.isAPIBlocked = false;
                console.log('✅ API blocking from fix-auth.js disabled');
              }
            }, 500);
          }
        }
      }
    });
  });
  
  // Start observing the document
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
  
  // Monitor window.fetch and window.XMLHttpRequest for changes
  let originalFetchWatcher = window.fetch;
  let originalXHROpenWatcher = XMLHttpRequest.prototype.open;
  
  const funcWatcher = setInterval(function() {
    // Check if fetch has been replaced
    if (window.fetch !== originalFetchWatcher) {
      console.log('⚠️ fetch has been replaced, restoring for API calls');
      
      // Save a reference to the new intercepted fetch
      const newInterceptedFetch = window.fetch;
      originalFetchWatcher = newInterceptedFetch;
      
      // Create a new fetch that only intercepts if it's not an API call
      window.fetch = function(resource, init) {
        // If it's an API call, use the original fetch
        if (typeof resource === 'string' && resource.includes('/api/')) {
          console.log(`🔓 Allowing API call: ${resource}`);
          return window.originalFetch.apply(this, arguments);
        }
        
        // Otherwise, use the intercepted fetch
        return newInterceptedFetch.apply(this, arguments);
      };
    }
    
    // Check if XHR.open has been replaced
    if (XMLHttpRequest.prototype.open !== originalXHROpenWatcher) {
      console.log('⚠️ XMLHttpRequest.open has been replaced, restoring for API calls');
      
      // Store the new intercepted function
      const newInterceptedOpen = XMLHttpRequest.prototype.open;
      originalXHROpenWatcher = newInterceptedOpen;
      
      // Create a new open that only uses original for API calls
      XMLHttpRequest.prototype.open = function(method, url) {
        // Remember the URL for send
        this._url = url;
        
        // Log and use original for API calls
        if (typeof url === 'string' && url.includes('/api/')) {
          console.log(`🔓 Allowing XHR API call: ${url}`);
          return window.originalXHROpen.apply(this, arguments);
        }
        
        // Otherwise use intercepted
        return newInterceptedOpen.apply(this, arguments);
      };
    }
  }, 1000);
  
  // Stop watching after 60 seconds
  setTimeout(function() {
    clearInterval(funcWatcher);
    observer.disconnect();
    console.log('⏱ API unblock watchers stopped after timeout');
  }, 60000);
  
  console.log('✅ API unblocking complete! Real API calls should now work');
})();