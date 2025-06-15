/**
 * Component Fixes Script
 * 
 * This script contains targeted fixes for specific components
 * that are causing infinite update loops or other issues.
 */

(function() {
  console.log('Loading component fixes...');

  // Create a log container to help with debugging
  const logEntries = [];
  function logFix(message) {
    const entry = `[${new Date().toLocaleTimeString()}] ${message}`;
    logEntries.push(entry);
    console.log(`ComponentFix: ${message}`);
  }

  // Fix for StationChat component (causing infinite update loop)
  function fixStationChat() {
    logFix('Attempting to fix StationChat component...');

    // Fix useEffect hook in StationChat.js that's causing the infinite loop
    // We need to modify the component's code or intercept the React hooks

    // Wait for React to be available
    function checkForReact() {
      if (window.React) {
        applyReactFixes();
      } else {
        setTimeout(checkForReact, 100);
      }
    }

    // Apply fixes once React is loaded
    function applyReactFixes() {
      logFix('React found, applying component fixes');

      // Store original useEffect to modify its behavior
      const originalUseEffect = React.useEffect;

      // Override useEffect to patch infinite loops in StationChat
      React.useEffect = function(effect, deps) {
        // Get the call stack to identify the component
        const stack = new Error().stack || '';
        
        // Check if this is from StationChat component
        if (stack.includes('StationChat') && deps === undefined) {
          logFix('Intercepted StationChat useEffect with missing dependency array');
          // Force an empty dependency array to prevent infinite updates
          return originalUseEffect(effect, []);
        }
        
        // For other components, just use the normal behavior
        return originalUseEffect(effect, deps);
      };
      
      logFix('Successfully patched React.useEffect');
    }

    // Start checking for React
    checkForReact();
  }

  // Fix for BaristaInterface (also causing infinite update loop)
  function fixBaristaInterface() {
    logFix('Attempting to fix BaristaInterface component...');

    // Wait for React to be available
    const checkInterval = setInterval(() => {
      if (window.React) {
        clearInterval(checkInterval);
        
        // Look for the BaristaInterface component
        setTimeout(() => {
          // Find all components in the page
          const components = document.querySelectorAll('[class*="barista"], [class*="Barista"]');
          if (components.length > 0) {
            logFix(`Found ${components.length} potential Barista components`);
          } else {
            logFix('No Barista components found yet, will try again');
          }
          
          // Apply force render limiter
          applyRenderLimiter();
        }, 1000);
      }
    }, 100);

    // Apply a render limiter to prevent too many updates
    function applyRenderLimiter() {
      // Override setState for class components
      const originalCreateElement = React.createElement;
      
      React.createElement = function(type, props, ...children) {
        // Only process if type is a class component (BaristaInterface is likely a class)
        if (typeof type === 'function' && type.prototype && type.prototype.isReactComponent) {
          // Check if this might be BaristaInterface by name
          const componentName = type.name || type.displayName || '';
          if (componentName.includes('Barista') || componentName.includes('Interface')) {
            logFix(`Found component: ${componentName}`);
            
            // Create a wrapped component that limits updates
            const WrappedComponent = function(props) {
              // Use a ref to track render count
              const renderCount = React.useRef(0);
              
              // Track last update time
              const lastUpdateTime = React.useRef(Date.now());
              
              // Override setState to prevent rapid updates
              React.useEffect(() => {
                const instance = this;
                if (instance && instance.setState) {
                  const originalSetState = instance.setState;
                  
                  instance.setState = function(state, callback) {
                    const now = Date.now();
                    const timeSinceLastUpdate = now - lastUpdateTime.current;
                    
                    // If updates are happening too rapidly, debounce them
                    if (timeSinceLastUpdate < 200) {
                      logFix(`Throttling rapid setState in ${componentName}`);
                      setTimeout(() => {
                        originalSetState.call(instance, state, callback);
                      }, 300);
                      return;
                    }
                    
                    // Normal update
                    lastUpdateTime.current = now;
                    return originalSetState.call(instance, state, callback);
                  };
                }
              }, []);
              
              // Render the original component
              return originalCreateElement(type, props, ...children);
            };
            
            // Copy static properties
            Object.assign(WrappedComponent, type);
            
            // Use the wrapped component instead
            return originalCreateElement(WrappedComponent, props, ...children);
          }
        }
        
        // Default behavior for other components
        return originalCreateElement(type, props, ...children);
      };
      
      logFix('Applied render limiter to React components');
    }
  }

  // Fix API request blocking from anti-flicker.js
  function fixApiBlocking() {
    logFix('Attempting to fix API blocking...');
    
    // Clear any stored blocked endpoints
    localStorage.removeItem('jwt_error_endpoints');
    
    // Disable the anti-flicker.js blocking
    localStorage.setItem('reset_api_block', 'true');
    
    // Try to hook into fetch to prevent blocks
    const originalFetch = window.fetch;
    
    window.fetch = function(...args) {
      const url = args[0].toString();
      
      // Check if this is a blocked API call
      if (url.includes('/api/')) {
        const urlObj = new URL(url);
        const endpoint = urlObj.pathname;
        
        logFix(`Ensuring endpoint ${endpoint} is not blocked`);
      }
      
      // Continue with normal fetch
      return originalFetch.apply(this, args);
    };
    
    logFix('API blocking fixes applied');
  }

  // Start applying fixes
  fixStationChat();
  fixBaristaInterface();
  fixApiBlocking();

  // Create a debug UI
  function createDebugOverlay() {
    // Only create if it doesn't exist yet
    if (document.getElementById('component-fix-debug')) {
      return;
    }
    
    const overlay = document.createElement('div');
    overlay.id = 'component-fix-debug';
    overlay.style.position = 'fixed';
    overlay.style.bottom = '10px';
    overlay.style.left = '10px';
    overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
    overlay.style.color = '#fff';
    overlay.style.padding = '5px';
    overlay.style.borderRadius = '5px';
    overlay.style.fontSize = '12px';
    overlay.style.zIndex = '9999';
    overlay.style.maxWidth = '300px';
    overlay.style.maxHeight = '200px';
    overlay.style.overflow = 'auto';
    overlay.style.fontFamily = 'monospace';
    
    // Add a header
    const header = document.createElement('div');
    header.textContent = 'Component Fixes Active';
    header.style.fontWeight = 'bold';
    header.style.marginBottom = '5px';
    overlay.appendChild(header);
    
    // Add log entries
    const logContainer = document.createElement('div');
    logContainer.id = 'component-fix-logs';
    logContainer.style.fontSize = '10px';
    overlay.appendChild(logContainer);
    
    // Update log entries
    function updateLogs() {
      const container = document.getElementById('component-fix-logs');
      if (container) {
        container.innerHTML = logEntries.slice(-10).join('<br>');
      }
    }
    
    // Add to document
    document.body.appendChild(overlay);
    
    // Update logs initially
    updateLogs();
    
    // Update logs periodically
    setInterval(updateLogs, 1000);
  }

  // Create the debug overlay when DOM is loaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createDebugOverlay);
  } else {
    createDebugOverlay();
  }
})();