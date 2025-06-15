/**
 * Debug script to monitor refresh behavior
 */
(function() {
  console.log("[DEBUG-REFRESH] Loading debug monitor...");
  
  // Track fetch attempts
  const originalFetch = window.fetch;
  window.fetch = function(...args) {
    const url = args[0].toString();
    
    // Only log API requests
    if (url.includes('/api/') || url.includes('localhost:5001')) {
      const timestamp = new Date().toLocaleTimeString() + "." + new Date().getMilliseconds();
      console.log(`[DEBUG-REFRESH] [${timestamp}] Fetch request to: ${url}`);
    }
    return originalFetch.apply(this, args);
  };
  
  // Track XMLHttpRequest
  const originalXHROpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(...args) {
    const method = args[0];
    const url = args[1];
    
    // Only log API requests
    if (url.includes('/api/') || url.includes('localhost:5001')) {
      const timestamp = new Date().toLocaleTimeString() + "." + new Date().getMilliseconds();
      console.log(`[DEBUG-REFRESH] [${timestamp}] XHR ${method} request to: ${url}`);
    }
    return originalXHROpen.apply(this, args);
  };
  
  // Monitor state changes
  let lastRefreshTime = 0;
  let refreshCount = 0;
  setInterval(() => {
    const now = Date.now();
    
    // Check localStorage for updates
    try {
      const autoRefreshEnabled = localStorage.getItem('coffee_auto_refresh_enabled') === 'true';
      const autoRefreshInterval = parseInt(localStorage.getItem('coffee_auto_refresh_interval') || '30');
      const connectionStatus = localStorage.getItem('coffee_connection_status');
      const connectionTime = parseInt(localStorage.getItem('coffee_connection_timestamp') || '0');
      const timeSinceConnection = now - connectionTime;
      
      console.log(`[DEBUG-REFRESH] Status: auto-refresh=${autoRefreshEnabled}, interval=${autoRefreshInterval}s, connection=${connectionStatus} (${Math.round(timeSinceConnection/1000)}s ago)`);
    } catch (e) {
      console.error('[DEBUG-REFRESH] Error reading localStorage:', e);
    }
    
    // Report refresh rate
    const elapsed = now - lastRefreshTime;
    if (elapsed < 2000) {
      refreshCount++;
      console.warn(`[DEBUG-REFRESH] ⚠️ RAPID REFRESH DETECTED: ${refreshCount} refreshes in under 2 seconds!`);
    } else {
      // Reset counter if more than 2 seconds since last refresh
      refreshCount = 0;
    }
    lastRefreshTime = now;
  }, 2000);
  
  console.log("[DEBUG-REFRESH] Debug monitor active. Watch for 'RAPID REFRESH' warnings.");
})();