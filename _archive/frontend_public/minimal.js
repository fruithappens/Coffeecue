/**
 * Minimal Barista Interface Start Script
 * 
 * This script will check if the URL contains 'minimal' parameter
 * and will block most scripts from running to ensure the
 * interface loads cleanly.
 */

// Run immediately when parsed
(function() {
  // Check for minimal mode in URL
  const urlParams = new URLSearchParams(window.location.search);
  const isMinimalMode = urlParams.has('minimal') || localStorage.getItem('use_minimal_interface') === 'true';
  
  if (isMinimalMode) {
    console.log('💡 Running in minimal mode');
    
    // Set minimal mode flag
    localStorage.setItem('use_minimal_interface', 'true');
    
    // Block console capture
    localStorage.setItem('disable_console_capture', 'true');
    
    // Disable auto-refresh
    localStorage.setItem('coffee_auto_refresh_enabled', 'false');
    
    // Set stable connection status
    localStorage.setItem('coffee_connection_status', 'online');
    localStorage.setItem('coffee_connection_timestamp', Date.now().toString());
    
    // Block extra scripts from loading
    let originalCreateElement = document.createElement;
    document.createElement = function(tagName) {
      const element = originalCreateElement.call(document, tagName);
      
      // For script tags, add a hook to block problematic scripts
      if (tagName.toLowerCase() === 'script') {
        const originalSetAttribute = element.setAttribute;
        element.setAttribute = function(name, value) {
          if (name === 'src') {
            // Block known problematic scripts
            const blockedScripts = [
              'console-capture.js',
              'throttled-console-capture.js',
              'anti-flicker.js'
            ];
            
            if (blockedScripts.some(script => value.includes(script))) {
              console.log(`🛑 Blocked loading of ${value}`);
              return element;
            }
          }
          return originalSetAttribute.call(this, name, value);
        };
      }
      
      return element;
    };
    
    // Create minimal UI for loading state
    window.addEventListener('DOMContentLoaded', function() {
      // Add minimal mode indicator
      const indicator = document.createElement('div');
      indicator.textContent = 'Minimal Mode';
      indicator.style.position = 'fixed';
      indicator.style.bottom = '10px';
      indicator.style.right = '10px';
      indicator.style.backgroundColor = '#f0f0f0';
      indicator.style.color = '#333';
      indicator.style.padding = '5px 10px';
      indicator.style.borderRadius = '4px';
      indicator.style.fontSize = '12px';
      indicator.style.zIndex = '9999';
      document.body.appendChild(indicator);
    });
  }
})();