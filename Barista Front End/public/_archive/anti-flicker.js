/**
 * Anti-flicker script to prevent rapid refreshing and error loops
 */
console.log('🛑 Loading anti-flicker protection...');

(function() {
  // Store original fetch to patch it
  const originalFetch = window.fetch;
  
  // Track JWT errors to prevent rapid retry loops
  let jwtErrorTimes = new Map();
  const JWT_ERROR_DEBOUNCE_MS = 30000; // 30 seconds
  
  // Try to load cached JWT errors from localStorage
  try {
    const cachedErrors = localStorage.getItem('jwt_error_endpoints');
    if (cachedErrors) {
      const parsed = JSON.parse(cachedErrors);
      jwtErrorTimes = new Map(Object.entries(parsed));
    }
  } catch (e) {
    console.error('Error loading JWT error cache:', e);
  }
  
  // Patch fetch to detect and handle JWT errors
  window.fetch = function(...args) {
    const url = args[0].toString();
    
    // Only process API requests
    if (url.includes('/api/') || url.includes('localhost:5001')) {
      // Get endpoint key for tracking
      let endpoint = url;
      try {
        // Extract path from URL
        const urlObj = new URL(url);
        endpoint = urlObj.pathname;
      } catch (e) {
        // Use full URL if parsing fails
      }
      
      // Check if this endpoint has had a recent JWT error
      const lastErrorTime = jwtErrorTimes.get(endpoint) || 0;
      const now = Date.now();
      const timeSinceLastError = now - lastErrorTime;
      
      // If we've seen a JWT error for this endpoint recently, block the request
      if (timeSinceLastError < JWT_ERROR_DEBOUNCE_MS) {
        console.log(`Anti-flicker: Blocking request to ${endpoint} (JWT error ${Math.round(timeSinceLastError/1000)}s ago)`);
        
        // Return a fake response instead of making the request
        return new Promise((resolve) => {
          setTimeout(() => {
            resolve({
              ok: false,
              status: 422,
              statusText: 'Blocked by anti-flicker',
              json: () => Promise.resolve({ 
                msg: 'Request blocked by anti-flicker protection',
                blocked: true,
                endpoint
              })
            });
          }, 100);
        });
      }
    }
    
    // Make the actual request
    return originalFetch.apply(this, args).then(response => {
      // Check for auth errors in the response
      if (response.status === 401 || response.status === 403 || response.status === 422) {
        // Clone the response to avoid consuming the body
        response.clone().json().then(data => {
          // Check for various JWT error messages
          const isJwtError = data && (
            (data.msg && (
              data.msg.includes('Signature verification failed') ||
              data.msg.includes('Token has expired') ||
              data.msg.includes('Subject must be a string')
            )) || 
            data.error === 'Unauthorized' ||
            data.error === 'InvalidToken'
          );
          
          if (isJwtError) {
            console.log(`Anti-flicker: Detected JWT error for ${args[0]}, blocking further requests`);
            
            // Record the error time for this endpoint
            let endpoint = args[0].toString();
            try {
              // Extract path from URL
              const url = new URL(endpoint);
              endpoint = url.pathname;
            } catch (e) {
              // Use full URL if parsing fails
            }
            
            // Update in-memory map
            jwtErrorTimes.set(endpoint, Date.now());
            
            // Also persist to localStorage for page reloads
            try {
              const errorsObject = {};
              jwtErrorTimes.forEach((time, key) => {
                errorsObject[key] = time;
              });
              localStorage.setItem('jwt_error_endpoints', JSON.stringify(errorsObject));
              
              // Mark that we've detected auth errors and increment count
              localStorage.setItem('resource_issues_detected', 'true');
              
              // Increment auth error count
              const currentCount = parseInt(localStorage.getItem('auth_error_count') || '0');
              localStorage.setItem('auth_error_count', (currentCount + 1).toString());
              
              // If we've hit the threshold, enable fallback mode
              const maxErrors = 3;
              if (currentCount + 1 >= maxErrors) {
                console.warn(`Auth error threshold reached (${currentCount + 1}/${maxErrors}), enabling fallback mode`);
                localStorage.setItem('use_fallback_data', 'true');
                localStorage.setItem('auth_error_refresh_needed', 'true');
              }
            } catch (e) {
              console.error('Error saving JWT error cache:', e);
            }
          }
        }).catch(() => {
          // If we can't parse the error, just continue
        });
      }
      
      return response;
    });
  };
  
  // Prevent rapid setIntervals
  const originalSetInterval = window.setInterval;
  window.setInterval = function(callback, delay, ...args) {
    // Ensure minimum delay of 10 seconds for intervals
    const safeDelay = Math.max(10000, delay);
    
    // Log if we've increased the delay
    if (safeDelay > delay && delay < 5000) {
      console.log(`Anti-flicker: Increased interval delay from ${delay}ms to ${safeDelay}ms`);
    }
    
    return originalSetInterval.call(this, callback, safeDelay, ...args);
  };
  
  // Add a manual refresh button
  document.addEventListener('DOMContentLoaded', () => {
    // Force disable auto-refresh
    localStorage.setItem('coffee_auto_refresh_enabled', 'false');
    
    const refreshBtn = document.createElement('button');
    
    // Check if auth recovery is needed
    const authErrorRefreshNeeded = localStorage.getItem('auth_error_refresh_needed') === 'true';
    
    // Set different appearance based on auth recovery status
    if (authErrorRefreshNeeded) {
      refreshBtn.textContent = 'Reconnect to Server';
      refreshBtn.style.backgroundColor = '#e74c3c'; // Red for auth recovery
    } else {
      refreshBtn.textContent = 'Refresh Data';
      refreshBtn.style.backgroundColor = '#0066cc'; // Blue for normal refresh
    }
    
    refreshBtn.style.position = 'fixed';
    refreshBtn.style.top = '10px';
    refreshBtn.style.right = '10px';
    refreshBtn.style.zIndex = '9999';
    refreshBtn.style.padding = '8px 15px';
    refreshBtn.style.color = 'white';
    refreshBtn.style.border = 'none';
    refreshBtn.style.borderRadius = '4px';
    refreshBtn.style.cursor = 'pointer';
    
    // Add pulsing animation if auth recovery is needed
    if (authErrorRefreshNeeded) {
      refreshBtn.style.animation = 'pulse 2s infinite';
      
      // Define the pulse animation
      const style = document.createElement('style');
      style.textContent = `
        @keyframes pulse {
          0% { transform: scale(1); }
          50% { transform: scale(1.05); box-shadow: 0 0 10px rgba(255, 0, 0, 0.5); }
          100% { transform: scale(1); }
        }
      `;
      document.head.appendChild(style);
    }
    
    refreshBtn.addEventListener('click', () => {
      console.log('Manual refresh triggered');
      
      // Check if auth recovery is needed
      const authErrorRefreshNeeded = localStorage.getItem('auth_error_refresh_needed') === 'true';
      
      // If we need auth recovery, clear JWT error caches
      if (authErrorRefreshNeeded) {
        console.log('Clearing JWT error caches and resetting auth error counters');
        localStorage.removeItem('jwt_error_endpoints');
        localStorage.setItem('auth_error_count', '0');
        localStorage.removeItem('auth_error_refresh_needed');
        
        // Clear error tracking map
        jwtErrorTimes.clear();
        
        // Try to exit fallback mode
        localStorage.setItem('use_fallback_data', 'false');
        
        // Refresh the page to ensure clean state
        window.location.reload();
        return;
      }
      
      // Regular refresh
      window.dispatchEvent(new CustomEvent('app:refreshOrders'));
      
      // Provide visual feedback
      refreshBtn.disabled = true;
      refreshBtn.textContent = 'Refreshing...';
      setTimeout(() => {
        refreshBtn.textContent = 'Refresh Data';
        refreshBtn.disabled = false;
      }, 2000);
    });
    
    document.body.appendChild(refreshBtn);
  });
  
  console.log('✓ Anti-flicker protection active');
})();