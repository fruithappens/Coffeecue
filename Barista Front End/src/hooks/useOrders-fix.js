// Fix for disappearing orders issue
// This patch ensures orders persist when switching tabs/stations

export function fixOrdersPersistence() {
  // Clean up any stale temporary variables
  const cleanupTempVars = () => {
    const tempVars = [
      '_tempOnlineStatus',
      '_tempQueueCount', 
      '_tempLastUpdated',
      '_tempPendingOrders',
      '_tempInProgressOrders',
      '_tempCompletedOrders',
      '_tempPreviousOrders',
      '_tempError',
      '_tempCachedOrderData'
    ];
    
    tempVars.forEach(varName => {
      if (window[varName] !== undefined) {
        delete window[varName];
      }
    });
  };

  // Override setTimeout to ensure temp vars are cleaned up
  const originalSetTimeout = window.setTimeout;
  window.setTimeout = function(fn, delay, ...args) {
    // If this is a 0-delay timeout (used for state updates), wrap it
    if (delay === 0 && typeof fn === 'function') {
      const wrappedFn = function() {
        try {
          fn.apply(this, args);
        } finally {
          // Clean up temp vars after state updates
          cleanupTempVars();
        }
      };
      return originalSetTimeout.call(window, wrappedFn, delay);
    }
    return originalSetTimeout.apply(window, arguments);
  };

  // Add event listener for tab changes to force refresh
  let lastActiveTab = null;
  const checkTabChange = () => {
    const activeTabElement = document.querySelector('[class*="border-amber-600"]');
    if (activeTabElement) {
      const currentTab = activeTabElement.textContent.trim();
      if (lastActiveTab && lastActiveTab !== currentTab) {
        console.log(`Tab changed from ${lastActiveTab} to ${currentTab} - refreshing orders`);
        // Dispatch refresh event
        window.dispatchEvent(new CustomEvent('app:refreshOrders'));
      }
      lastActiveTab = currentTab;
    }
  };

  // Monitor for tab changes
  const observer = new MutationObserver(() => {
    checkTabChange();
  });

  // Start observing when DOM is ready
  if (document.body) {
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['class'],
      subtree: true
    });
  }

  // Also add click handler for immediate response
  document.addEventListener('click', (e) => {
    if (e.target.closest('button') && e.target.textContent.match(/Orders|Stock|Inventory|Schedule|Completed|Display|Queue|Balance|Capabilities|Staff|Settings/)) {
      setTimeout(checkTabChange, 50);
    }
  });

  // Fix for station changes - ensure orders are saved before switching
  window.addEventListener('beforeStationChange', (e) => {
    const stationId = e.detail?.stationId;
    if (stationId) {
      console.log(`Saving orders before switching to station ${stationId}`);
      
      // Force save current orders to cache
      const ordersKey = `orders_cache_station_${stationId}`;
      const backupKey = `${ordersKey}_backup`;
      
      // Get current state from React if available
      const currentOrders = window._currentOrdersState || {};
      
      if (currentOrders.pendingOrders || currentOrders.inProgressOrders) {
        const ordersData = {
          pendingOrders: currentOrders.pendingOrders || [],
          inProgressOrders: currentOrders.inProgressOrders || [],
          completedOrders: currentOrders.completedOrders || [],
          previousOrders: currentOrders.previousOrders || [],
          timestamp: Date.now()
        };
        
        const serialized = JSON.stringify(ordersData);
        localStorage.setItem(backupKey, serialized);
        sessionStorage.setItem(ordersKey, serialized);
        
        console.log('Orders backed up before station change');
      }
    }
  });

  // Return cleanup function
  return () => {
    observer.disconnect();
    window.setTimeout = originalSetTimeout;
    cleanupTempVars();
  };
}

// Auto-initialize on import
if (typeof window !== 'undefined') {
  fixOrdersPersistence();
}