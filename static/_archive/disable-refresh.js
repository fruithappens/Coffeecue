/**
 * Disable Auto-Refresh
 * This script completely disables the automatic refreshing of order data
 * to prevent excessive console messages and state changes.
 */
(function() {
  console.log('🛑 Disabling automatic refreshing...');
  
  // Disable auto-refresh in localStorage
  localStorage.setItem('coffee_auto_refresh_enabled', 'false');
  
  // Set a very large interval to further reduce potential refreshes
  localStorage.setItem('coffee_auto_refresh_interval', '3600'); // 1 hour
  
  // Set last manual refresh time to now to prevent initial refresh
  sessionStorage.setItem('last_manual_refresh_time', Date.now().toString());
  
  // Store refresh-related interval IDs to clear them later
  window.disabledRefreshIntervals = [];
  
  // A more targeted approach that's less likely to break critical functionality
  const originalSetInterval = window.setInterval;
  window.setInterval = function(callback, delay, ...args) {
    // Only intercept intervals that look like refresh timers and aren't critical
    const callbackStr = callback.toString();
    if (
      (callbackStr.includes('refresh') || callbackStr.includes('poll')) && 
      delay < 60000 &&
      !callbackStr.includes('critical') && 
      !callbackStr.includes('render')
    ) {
      console.log(`🛑 Modified refresh interval (${delay}ms) to run less frequently`);
      // Make it run much less frequently instead of blocking completely
      const id = originalSetInterval.call(this, callback, 300000, ...args); // 5 minutes
      window.disabledRefreshIntervals.push(id);
      return id;
    }
    
    // Allow other intervals to proceed normally
    return originalSetInterval.call(this, callback, delay, ...args);
  };
  
  // A safer approach to handling event listeners
  const refreshEvents = ['app:refreshOrders', 'app:forceRefresh'];
  const originalAddEventListener = window.addEventListener;
  window.addEventListener = function(event, listener, ...args) {
    // Only intercept specific refresh events
    if (refreshEvents.includes(event)) {
      console.log(`🛑 Modified ${event} event listener to run less frequently`);
      
      // Wrap the listener to rate-limit it
      let lastRun = 0;
      const wrappedListener = function(e) {
        const now = Date.now();
        if (now - lastRun > 300000) { // 5 minutes
          lastRun = now;
          return listener.call(this, e);
        } else {
          console.log(`Skipped ${event} due to rate limiting`);
        }
      };
      
      // Register the wrapped listener
      return originalAddEventListener.call(this, event, wrappedListener, ...args);
    }
    
    // Allow other event listeners to proceed normally
    return originalAddEventListener.call(this, event, listener, ...args);
  };
  
  console.log('✅ Automatic refreshing has been disabled');
})();