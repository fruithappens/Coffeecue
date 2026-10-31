// Enhanced Order Persistence Helper Script
// This script ensures orders are persisted when switching between tabs and navigating between pages

(function() {
  console.log('Enhanced Order Persistence Helper loaded');
  
  // Store which tab was last active
  let lastActiveTab = '';
  
  // Store the last navigation path
  let lastPath = window.location.pathname;
  
  // Track visibility changes
  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'visible') {
      console.log('Tab became visible - triggering order refresh');
      // Dispatch a custom event that the React app can listen for
      window.dispatchEvent(new CustomEvent('app:refreshOrders'));
      
      // Check for path changes when tab regains visibility
      const currentPath = window.location.pathname;
      if (currentPath !== lastPath) {
        console.log(`Path changed from ${lastPath} to ${currentPath} - triggering order sync`);
        syncOrdersAfterRouteChange(lastPath, currentPath);
        lastPath = currentPath;
      }
    }
  });
  
  // Helper to check if element exists in dom
  function elementExists(selector) {
    return document.querySelector(selector) !== null;
  }
  
  // Monitor tab changes within the app
  function monitorTabChanges() {
    // Check if we're on the barista page by looking for specific elements
    const isBarista = elementExists('.barista-interface') || 
                     elementExists('#barista-app');
    
    if (!isBarista) return;
    
    // Look for tab indicators
    const activeTab = document.querySelector('.tab-active, .active-tab, .nav-item.active');
    if (activeTab) {
      const tabName = activeTab.textContent.trim();
      
      // If tab has changed, trigger a refresh
      if (lastActiveTab && lastActiveTab !== tabName) {
        console.log(`Tab changed from ${lastActiveTab} to ${tabName} - triggering refresh`);
        window.dispatchEvent(new CustomEvent('app:refreshOrders'));
      }
      
      lastActiveTab = tabName;
    }
  }

  // Monitor path changes for route navigation
  function monitorPathChanges() {
    const currentPath = window.location.pathname;
    
    // If path has changed, check if it's related to organizer navigation
    if (lastPath !== currentPath) {
      console.log(`Path changed from ${lastPath} to ${currentPath}`);
      
      // Special handling for navigation between barista and organiser
      syncOrdersAfterRouteChange(lastPath, currentPath);
      
      lastPath = currentPath;
    }
  }
  
  // Handle special order sync cases after route changes
  function syncOrdersAfterRouteChange(fromPath, toPath) {
    // Create an immediately available cache when returning to barista from organiser
    if (fromPath.includes('/organiser') && toPath.includes('/barista')) {
      console.log('Detected return from organiser to barista - performing immediate sync');
      
      // Trigger instant order refresh
      window.dispatchEvent(new CustomEvent('app:refreshOrders'));
      
      // Also ensure the localStorage cache is properly copied to sessionStorage
      syncOrdersToSessionStorage(true);
    }
    
    // When entering organiser, make sure we have a strong backup of orders
    if (fromPath.includes('/barista') && toPath.includes('/organiser')) {
      console.log('Detected navigation to organiser - creating order backup');
      createOrderBackup();
    }
  }
  
  // Create a stronger backup when navigating away from barista
  function createOrderBackup() {
    try {
      const stationId = localStorage.getItem('current_station_id') || '1';
      const ordersKey = `orders_cache_station_${stationId}`;
      
      // First try to get orders from memory, then localStorage
      let ordersToBackup = null;
      
      // Get orders from localStorage
      const storedOrders = localStorage.getItem(ordersKey);
      
      if (storedOrders) {
        // Validate the stored orders format
        try {
          const parsedOrders = JSON.parse(storedOrders);
          const hasOrders = (
            (parsedOrders.pendingOrders && parsedOrders.pendingOrders.length > 0) ||
            (parsedOrders.inProgressOrders && parsedOrders.inProgressOrders.length > 0) ||
            (parsedOrders.completedOrders && parsedOrders.completedOrders.length > 0)
          );
          
          if (hasOrders) {
            console.log(`Found ${parsedOrders.pendingOrders?.length || 0} pending, ${parsedOrders.inProgressOrders?.length || 0} in-progress orders to backup`);
            ordersToBackup = storedOrders;
          } else {
            console.log('No orders found in localStorage to backup');
          }
        } catch (parseError) {
          console.error('Error parsing stored orders:', parseError);
        }
      }
      
      // If we have orders to back up, save them
      if (ordersToBackup) {
        try {
          // Store backup copy with a special key
          localStorage.setItem(`${ordersKey}_backup`, ordersToBackup);
          localStorage.setItem(`${ordersKey}_backup_time`, Date.now().toString());
          
          // Also ensure it's in sessionStorage for faster access
          sessionStorage.setItem(ordersKey, ordersToBackup);
          sessionStorage.setItem(`${ordersKey}_backup`, ordersToBackup);
          
          console.log('✅ Created orders backup before navigation');
          return true;
        } catch (storageError) {
          console.error('Error writing to storage:', storageError);
          
          // Try to use smaller storage if we got a quota error
          if (storageError.name === 'QuotaExceededError') {
            try {
              console.log('Storage quota exceeded, trying with only essential data');
              // Parse and extract only the essential data
              const parsed = JSON.parse(ordersToBackup);
              const minimal = {
                inProgressOrders: parsed.inProgressOrders || [],
                timestamp: Date.now()
              };
              const minimalStr = JSON.stringify(minimal);
              
              // Try storing the minimal version
              localStorage.setItem(`${ordersKey}_backup_minimal`, minimalStr);
              console.log('Created minimal backup');
              return true;
            } catch (minError) {
              console.error('Failed to create minimal backup:', minError);
            }
          }
        }
      } else {
        console.log('No valid order data found to backup');
      }
      
      return false;
    } catch (e) {
      console.error('Error in createOrderBackup:', e);
      return false;
    }
  }
  
  // Create a bridge between localStorage and sessionStorage for orders
  function syncOrdersToSessionStorage(forceTriggerRefresh = false) {
    try {
      const stationId = localStorage.getItem('current_station_id') || '1';
      const ordersKey = `orders_cache_station_${stationId}`;
      
      // First check for a backup if coming from organiser page
      let ordersData = null;
      
      // Check if we're on the barista page
      const isBarista = window.location.pathname.includes('/barista');
      
      if (isBarista) {
        // Try to get the backup first if it exists
        const backupOrders = localStorage.getItem(`${ordersKey}_backup`);
        
        if (backupOrders) {
          console.log('Found order backup, using it for faster restore');
          ordersData = backupOrders;
          
          // Don't remove backup immediately
          // We'll keep it until we confirm orders are properly loaded
          // localStorage.removeItem(`${ordersKey}_backup`);
          
          // Instead, mark it as used with timestamp so we can clean it up later
          localStorage.setItem(`${ordersKey}_backup_used`, Date.now());
        }
      }
      
      // If no backup found, use regular storage
      if (!ordersData) {
        ordersData = localStorage.getItem(ordersKey);
      }
      
      if (ordersData) {
        // First parse the data to check for orders
        try {
          const parsedData = JSON.parse(ordersData);
          const hasOrders = (
            (parsedData.pendingOrders && parsedData.pendingOrders.length > 0) ||
            (parsedData.inProgressOrders && parsedData.inProgressOrders.length > 0) ||
            (parsedData.completedOrders && parsedData.completedOrders.length > 0)
          );
          
          console.log(`Syncing orders - has orders: ${hasOrders}`);
          
          // Only restore if we actually have orders to restore
          if (hasOrders) {
            // Store in sessionStorage for faster access
            sessionStorage.setItem(ordersKey, ordersData);
            
            // Also store in localStorage in case it was from backup
            localStorage.setItem(ordersKey, ordersData);
            
            // If force refresh is requested (like returning from organiser)
            if (forceTriggerRefresh && isBarista) {
              // Set a flag to indicate we have fresh data
              sessionStorage.setItem('force_orders_refresh', 'true');
              
              // Trigger refresh through event
              window.dispatchEvent(new CustomEvent('app:refreshOrders'));
            }
          }
        } catch (parseError) {
          console.error('Error parsing order data:', parseError);
        }
      }
      
      // Clean up old backups after 1 minute
      const usedBackupTime = localStorage.getItem(`${ordersKey}_backup_used`);
      if (usedBackupTime) {
        const timeElapsed = Date.now() - parseInt(usedBackupTime);
        if (timeElapsed > 60000) { // 1 minute
          console.log('Cleaning up old backup data');
          localStorage.removeItem(`${ordersKey}_backup`);
          localStorage.removeItem(`${ordersKey}_backup_used`);
        }
      }
    } catch (e) {
      console.error('Error syncing orders to sessionStorage:', e);
    }
  }
  
  // Set up order persistence in sessionStorage before page unload
  window.addEventListener('beforeunload', function() {
    console.log('Page is being unloaded - creating order backup');
    createOrderBackup();
    
    // Record the time of navigation to help with restoration
    sessionStorage.setItem('last_navigation_time', Date.now().toString());
  });
  
  // Handle page reloads - when the page is loaded, check if we're returning from a refresh
  window.addEventListener('load', function() {
    console.log('Page loaded - checking for previous navigation');
    
    const lastNavigationTime = sessionStorage.getItem('last_navigation_time');
    if (lastNavigationTime) {
      const timeSinceNavigation = Date.now() - parseInt(lastNavigationTime);
      console.log(`Last navigation was ${timeSinceNavigation}ms ago`);
      
      // If this was a recent refresh (within last 10 seconds), trigger immediate order refresh
      if (timeSinceNavigation < 10000) {
        console.log('Detected page refresh - triggering order restoration');
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('app:refreshOrders'));
        }, 500);
      }
      
      // Clear the navigation time marker
      sessionStorage.removeItem('last_navigation_time');
    }
  });
  
  // Initial check for query parameters indicating we're returning from another page
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.has('from') && urlParams.get('from') === 'organiser') {
    console.log('Detected return from organiser via query param - triggering immediate refresh');
    syncOrdersToSessionStorage(true);
  }
  
  // Attach to all anchor tags to catch navigation before it happens
  document.addEventListener('click', function(e) {
    // Look for link clicks that might be navigation
    if (e.target.tagName === 'A' || e.target.closest('a')) {
      const link = e.target.tagName === 'A' ? e.target : e.target.closest('a');
      const href = link.getAttribute('href');
      
      // If it's an internal link to the organiser or from the organiser
      if (href && (href.includes('/organiser') || window.location.pathname.includes('/organiser'))) {
        console.log('Detected internal navigation link click:', href);
        createOrderBackup();
        
        // Add a parameter to track where we came from
        if (href.includes('/barista') && window.location.pathname.includes('/organiser')) {
          // Only if the link doesn't already have parameters
          if (!href.includes('?')) {
            e.preventDefault();
            window.location.href = `${href}?from=organiser`;
          }
        }
      }
    }
  });
  
  // Add a hook to React Router to track route changes
  // This works by monkey-patching the history.pushState method
  const originalPushState = window.history.pushState;
  window.history.pushState = function(state, title, url) {
    // Call the original method
    const result = originalPushState.apply(this, arguments);
    
    // Check for path changes that might involve organiser navigation
    if (url && (url.includes('/organiser') || lastPath.includes('/organiser'))) {
      console.log('Detected route change via pushState:', url);
      
      // Trigger event for route change
      syncOrdersAfterRouteChange(lastPath, url);
      lastPath = url;
    }
    
    return result;
  };
  
  // Set up periodic checks for tab and route changes
  setInterval(monitorTabChanges, 500);
  setInterval(monitorPathChanges, 1000);
  
  // Periodically sync orders to ensure persistence
  setInterval(syncOrdersToSessionStorage, 2000);
  
  // For manual refresh via console
  window.refreshOrdersNow = function() {
    window.dispatchEvent(new CustomEvent('app:refreshOrders'));
    console.log('Manual order refresh triggered');
    return 'Refresh triggered';
  };
  
  // Additional utility for emergency order recovery
  window.recoverOrders = function() {
    try {
      const stationId = localStorage.getItem('current_station_id') || '1';
      const ordersKey = `orders_cache_station_${stationId}`;
      const backupKey = `${ordersKey}_backup`;
      
      // Check for backup
      const backup = localStorage.getItem(backupKey);
      if (backup) {
        localStorage.setItem(ordersKey, backup);
        sessionStorage.setItem(ordersKey, backup);
        console.log('Orders recovered from backup');
        window.dispatchEvent(new CustomEvent('app:refreshOrders'));
        return 'Recovery successful';
      } else {
        console.log('No backup found');
        return 'No backup found';
      }
    } catch (e) {
      console.error('Error during order recovery:', e);
      return 'Recovery failed: ' + e.message;
    }
  };
})();