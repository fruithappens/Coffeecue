// Emergency fix for constant refreshing issue
console.log('*** EMERGENCY REFRESH FIX LOADING ***');

(function() {
  // Completely disable auto-refresh
  localStorage.setItem('coffee_auto_refresh_enabled', 'false');
  localStorage.setItem('coffee_auto_refresh_interval', '300');  // 5 minutes as failsafe
  
  // Set connection status to stable
  localStorage.setItem('coffee_connection_status', 'online');
  localStorage.setItem('coffee_connection_timestamp', Date.now().toString());
  localStorage.setItem('connection_cache_expiry', '600000');  // 10 minutes
  
  // Enable fallback data to prevent API calls
  localStorage.setItem('use_fallback_data', 'true');
  localStorage.setItem('fallback_data_available', 'true');

  // Patch window.setInterval to prevent rapid refreshing
  const originalSetInterval = window.setInterval;
  window.setInterval = function(callback, delay, ...args) {
    // Force a minimum delay of 10 seconds for all intervals
    const safeDelay = Math.max(10000, delay);
    
    // Log if we're adjusting the timer significantly
    if (safeDelay > delay && delay < 5000) {
      console.log(`🛑 Blocked fast interval (${delay}ms) - increased to ${safeDelay}ms`);
    }
    
    // Create the interval with the safe delay
    return originalSetInterval(callback, safeDelay, ...args);
  };

  // Add manual refresh button
  document.addEventListener('DOMContentLoaded', function() {
    const refreshButtonContainer = document.createElement('div');
    refreshButtonContainer.style.position = 'fixed';
    refreshButtonContainer.style.top = '10px';
    refreshButtonContainer.style.right = '10px';
    refreshButtonContainer.style.zIndex = '9999';
    refreshButtonContainer.style.display = 'flex';
    refreshButtonContainer.style.gap = '10px';
    
    // Add manual refresh button
    const refreshButton = document.createElement('button');
    refreshButton.textContent = '🔄 Refresh';
    refreshButton.style.padding = '8px 12px';
    refreshButton.style.backgroundColor = '#0066cc';
    refreshButton.style.color = 'white';
    refreshButton.style.border = 'none';
    refreshButton.style.borderRadius = '4px';
    refreshButton.style.cursor = 'pointer';
    refreshButton.style.fontWeight = 'bold';
    
    refreshButton.addEventListener('click', function() {
      // Trigger a manual refresh via the app's event system
      window.dispatchEvent(new CustomEvent('app:refreshOrders'));
      
      // Visual feedback
      this.textContent = '⏳ Refreshing...';
      this.disabled = true;
      
      setTimeout(() => {
        this.textContent = '✅ Refreshed';
        
        setTimeout(() => {
          this.textContent = '🔄 Refresh';
          this.disabled = false;
        }, 1000);
      }, 1000);
    });
    
    // Add link to more comprehensive fix page
    const fixLink = document.createElement('a');
    fixLink.href = '/fix-auto-refresh.html';
    fixLink.textContent = '🔧 Fix Settings';
    fixLink.style.padding = '8px 12px';
    fixLink.style.backgroundColor = '#f0f0f0';
    fixLink.style.color = '#333';
    fixLink.style.textDecoration = 'none';
    fixLink.style.borderRadius = '4px';
    fixLink.style.border = '1px solid #ddd';
    fixLink.style.fontWeight = 'bold';
    
    refreshButtonContainer.appendChild(refreshButton);
    refreshButtonContainer.appendChild(fixLink);
    
    document.body.appendChild(refreshButtonContainer);
    
    console.log('Manual refresh controls added to page');
  });
  
  console.log('*** EMERGENCY REFRESH FIX APPLIED ***');
})();