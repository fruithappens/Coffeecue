/**
 * Disable Fallback Data Mode
 * 
 * This script explicitly disables fallback/demo mode and forces
 * the app to use the real backend API.
 */

(function() {
  // Get current fallback status
  const usingFallback = localStorage.getItem('use_fallback_data') === 'true' || 
                      localStorage.getItem('fallback_data_available') === 'true' ||
                      localStorage.getItem('demo_mode') === 'true';
  
  console.log(`Current fallback data status: ${usingFallback ? 'ENABLED (will disable)' : 'already disabled'}`);
  
  // Remove all fallback data flags
  localStorage.removeItem('use_fallback_data');
  localStorage.removeItem('fallback_data_available');
  localStorage.removeItem('demo_mode');
  localStorage.removeItem('sample_data_loaded');
  localStorage.removeItem('force_offline');
  localStorage.removeItem('offline_mode');
  
  // Set connection status to online
  localStorage.setItem('coffee_connection_status', 'online');
  localStorage.setItem('coffee_connection_timestamp', Date.now().toString());
  
  // Force data refresh
  localStorage.setItem('force_data_reload', 'true');
  localStorage.setItem('force_api_refresh', Date.now().toString());
  
  // Set API base URL explicitly
  localStorage.setItem('api_base_url', 'http://localhost:5001');
  
  // Clear any cached orders that might contain sample data
  localStorage.removeItem('cached_pending_orders');
  localStorage.removeItem('cached_in_progress_orders');
  localStorage.removeItem('cached_completed_orders');
  localStorage.removeItem('orders_cache');
  localStorage.removeItem('fallback_pending_orders');
  localStorage.removeItem('fallback_in_progress_orders');
  localStorage.removeItem('fallback_completed_orders');
  
  // Also clear from sessionStorage
  sessionStorage.removeItem('cached_pending_orders');
  sessionStorage.removeItem('cached_in_progress_orders');
  sessionStorage.removeItem('cached_completed_orders');
  sessionStorage.removeItem('orders_cache');
  
  console.log('✅ Fallback data mode has been disabled. App will now use live data.');
  
  // Show status on page
  document.addEventListener('DOMContentLoaded', function() {
    // Create status indicator
    const statusDiv = document.createElement('div');
    statusDiv.style.position = 'fixed';
    statusDiv.style.top = '20px';
    statusDiv.style.right = '20px';
    statusDiv.style.backgroundColor = '#00aa55';
    statusDiv.style.color = 'white';
    statusDiv.style.padding = '10px 15px';
    statusDiv.style.borderRadius = '4px';
    statusDiv.style.zIndex = '9999';
    statusDiv.style.boxShadow = '0 2px 4px rgba(0,0,0,0.2)';
    statusDiv.textContent = 'Demo mode disabled. Using live data.';
    
    // Add to the page
    document.body.appendChild(statusDiv);
    
    // Remove after 5 seconds
    setTimeout(() => {
      if (document.body.contains(statusDiv)) {
        document.body.removeChild(statusDiv);
      }
    }, 5000);
  });
})();