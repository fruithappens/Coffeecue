/**
 * React Component Debugger
 * This script creates a non-intrusive debug panel to monitor React components
 * and identify issues like infinite render loops and failed API calls.
 */
(function() {
  // Create debug container
  function createDebugPanel() {
    // Create panel container
    const panel = document.createElement('div');
    panel.id = 'react-debug-panel';
    panel.style.position = 'fixed';
    panel.style.bottom = '10px';
    panel.style.right = '10px';
    panel.style.width = '400px';
    panel.style.maxHeight = '80vh';
    panel.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
    panel.style.color = '#fff';
    panel.style.padding = '10px';
    panel.style.borderRadius = '5px';
    panel.style.zIndex = '10000';
    panel.style.fontFamily = 'monospace';
    panel.style.fontSize = '12px';
    panel.style.overflow = 'auto';
    panel.style.boxShadow = '0 0 10px rgba(0, 0, 0, 0.5)';
    panel.style.transition = 'all 0.3s ease';
    panel.style.transform = 'translateY(calc(100% - 32px))';
    
    // Panel header
    const header = document.createElement('div');
    header.style.cursor = 'pointer';
    header.style.fontWeight = 'bold';
    header.style.marginBottom = '5px';
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    header.innerHTML = '<span>🛠️ React Debugger (click to expand)</span><span id="react-debug-status">●</span>';
    panel.appendChild(header);
    
    // Content container
    const content = document.createElement('div');
    content.id = 'react-debug-content';
    content.style.display = 'none';
    panel.appendChild(content);
    
    // Tabs container
    const tabs = document.createElement('div');
    tabs.style.display = 'flex';
    tabs.style.borderBottom = '1px solid #444';
    tabs.style.marginBottom = '10px';
    
    // Tab function
    function createTab(id, label) {
      const tab = document.createElement('div');
      tab.id = `tab-${id}`;
      tab.textContent = label;
      tab.style.padding = '5px 10px';
      tab.style.cursor = 'pointer';
      tab.style.borderRight = '1px solid #444';
      tab.onclick = () => selectTab(id);
      return tab;
    }
    
    tabs.appendChild(createTab('render', 'Renders'));
    tabs.appendChild(createTab('api', 'API Calls'));
    tabs.appendChild(createTab('state', 'State Updates'));
    tabs.appendChild(createTab('errors', 'Errors'));
    tabs.appendChild(createTab('fixes', 'Fixes'));
    content.appendChild(tabs);
    
    // Tab content containers
    const tabIds = ['render', 'api', 'state', 'errors', 'fixes'];
    tabIds.forEach(id => {
      const container = document.createElement('div');
      container.id = `tab-content-${id}`;
      container.style.display = 'none';
      container.style.height = '300px';
      container.style.overflowY = 'auto';
      content.appendChild(container);
    });
    
    // Fixes tab content
    const fixesContainer = document.getElementById('tab-content-fixes');
    if (fixesContainer) {
      fixesContainer.innerHTML = `
        <div style="padding: 5px; margin-bottom: 10px;">
          <h3 style="margin: 0 0 10px 0;">Available Fixes</h3>
          <div style="margin-bottom: 10px;">
            <button id="fix-infinite-renders" style="background: #cc3300; color: white; border: none; padding: 5px 10px; margin-right: 5px; cursor: pointer;">Fix Infinite Renders</button>
            <button id="fix-api-calls" style="background: #0066cc; color: white; border: none; padding: 5px 10px; margin-right: 5px; cursor: pointer;">Fix API Calls</button>
          </div>
          <div style="margin-bottom: 10px;">
            <button id="fix-station-chat" style="background: #00aa55; color: white; border: none; padding: 5px 10px; margin-right: 5px; cursor: pointer;">Fix StationChat</button>
            <button id="fix-barista-interface" style="background: #00aa55; color: white; border: none; padding: 5px 10px; cursor: pointer;">Fix BaristaInterface</button>
          </div>
          <div>
            <button id="restart-app" style="background: #cc3300; color: white; border: none; padding: 5px 10px; margin-top: 10px; cursor: pointer;">Restart App (Hard Reload)</button>
          </div>
        </div>
      `;
    }
    
    // Select initial tab
    function selectTab(id) {
      tabIds.forEach(tabId => {
        const tabElement = document.getElementById(`tab-${tabId}`);
        const contentElement = document.getElementById(`tab-content-${tabId}`);
        
        if (tabId === id) {
          tabElement.style.backgroundColor = '#333';
          contentElement.style.display = 'block';
        } else {
          tabElement.style.backgroundColor = 'transparent';
          contentElement.style.display = 'none';
        }
      });
    }
    
    // Toggle panel visibility
    header.addEventListener('click', function() {
      if (content.style.display === 'none') {
        content.style.display = 'block';
        panel.style.transform = 'translateY(0)';
      } else {
        content.style.display = 'none';
        panel.style.transform = 'translateY(calc(100% - 32px))';
      }
    });
    
    document.body.appendChild(panel);
    
    // Select default tab
    selectTab('errors');
    
    // Add fix button handlers when elements are available
    setTimeout(() => {
      // Fix infinite renders
      const fixRenderBtn = document.getElementById('fix-infinite-renders');
      if (fixRenderBtn) {
        fixRenderBtn.addEventListener('click', function() {
          localStorage.setItem('disable_infinite_renders', 'true');
          addLogEntry('fixes', 'Applied fix for infinite renders. Reload required.', 'success');
        });
      }
      
      // Fix API calls
      const fixApiBtn = document.getElementById('fix-api-calls');
      if (fixApiBtn) {
        fixApiBtn.addEventListener('click', function() {
          localStorage.removeItem('jwt_error_endpoints');
          localStorage.setItem('reset_api_block', 'true');
          addLogEntry('fixes', 'Cleared API blocks. Refresh required.', 'success');
        });
      }
      
      // Fix StationChat
      const fixChatBtn = document.getElementById('fix-station-chat');
      if (fixChatBtn) {
        fixChatBtn.addEventListener('click', function() {
          localStorage.setItem('fix_station_chat', 'true');
          addLogEntry('fixes', 'Applied fix for StationChat component.', 'success');
        });
      }
      
      // Fix BaristaInterface
      const fixBaristaBtn = document.getElementById('fix-barista-interface');
      if (fixBaristaBtn) {
        fixBaristaBtn.addEventListener('click', function() {
          localStorage.setItem('fix_barista_interface', 'true');
          addLogEntry('fixes', 'Applied fix for BaristaInterface component.', 'success');
        });
      }
      
      // Restart app
      const restartBtn = document.getElementById('restart-app');
      if (restartBtn) {
        restartBtn.addEventListener('click', function() {
          window.location.href = '/?debug=true&t=' + Date.now();
        });
      }
    }, 500);
    
    return panel;
  }
  
  // Wait for DOM to be loaded
  function init() {
    if (document.body) {
      createDebugPanel();
      setupMonitoring();
    } else {
      window.addEventListener('DOMContentLoaded', function() {
        createDebugPanel();
        setupMonitoring();
      });
    }
  }
  
  // Setup monitoring
  function setupMonitoring() {
    setupNetworkMonitoring();
    setupErrorMonitoring();
    setupComponentMonitoring();
    monitorResourceUsage();
  }
  
  // Logging util
  function addLogEntry(tabId, message, type = 'info') {
    const container = document.getElementById(`tab-content-${tabId}`);
    if (!container) return;
    
    const entry = document.createElement('div');
    entry.style.padding = '5px';
    entry.style.borderBottom = '1px solid #333';
    entry.style.wordBreak = 'break-word';
    
    // Color code by type
    switch (type) {
      case 'error':
        entry.style.color = '#ff6666';
        break;
      case 'warning':
        entry.style.color = '#ffcc00';
        break;
      case 'success':
        entry.style.color = '#66ff66';
        break;
      default:
        entry.style.color = '#ffffff';
    }
    
    const time = new Date().toTimeString().split(' ')[0];
    entry.innerHTML = `<span style="color: #999;">[${time}]</span> ${message}`;
    
    container.insertBefore(entry, container.firstChild);
    
    // Update status indicator
    updateStatus(type);
  }
  
  // Update status indicator
  function updateStatus(type) {
    const statusEl = document.getElementById('react-debug-status');
    if (!statusEl) return;
    
    switch (type) {
      case 'error':
        statusEl.style.color = '#ff6666';
        break;
      case 'warning':
        statusEl.style.color = '#ffcc00';
        break;
      case 'success':
        statusEl.style.color = '#66ff66';
        break;
      default:
        statusEl.style.color = '#ffffff';
    }
  }
  
  // Setup network monitoring
  function setupNetworkMonitoring() {
    const originalFetch = window.fetch;
    window.fetch = function(...args) {
      const url = args[0].toString();
      const options = args[1] || {};
      const startTime = performance.now();
      
      // Log API call start
      if (url.includes('/api/')) {
        addLogEntry('api', `REQUEST: ${options.method || 'GET'} ${url}`, 'info');
      }
      
      return originalFetch.apply(this, args)
        .then(response => {
          const endTime = performance.now();
          const duration = Math.round(endTime - startTime);
          
          if (url.includes('/api/')) {
            if (response.ok) {
              addLogEntry('api', `SUCCESS: ${url} (${duration}ms)`, 'success');
            } else {
              addLogEntry('api', `FAILED: ${url} - Status ${response.status} (${duration}ms)`, 'error');
              
              // Clone response to avoid consuming it
              response.clone().text().then(text => {
                try {
                  const data = JSON.parse(text);
                  addLogEntry('api', `Response: ${JSON.stringify(data)}`, 'error');
                } catch (e) {
                  addLogEntry('api', `Response: ${text}`, 'error');
                }
              }).catch(() => {});
            }
          }
          
          return response;
        })
        .catch(error => {
          const endTime = performance.now();
          const duration = Math.round(endTime - startTime);
          
          if (url.includes('/api/')) {
            addLogEntry('api', `ERROR: ${url} - ${error.message} (${duration}ms)`, 'error');
          }
          
          throw error;
        });
    };
  }
  
  // Setup error monitoring
  function setupErrorMonitoring() {
    // Override console.error
    const originalConsoleError = console.error;
    console.error = function(...args) {
      // Call original method
      originalConsoleError.apply(console, args);
      
      // Log to our panel
      const message = args.map(arg => {
        if (typeof arg === 'object') {
          try {
            return JSON.stringify(arg);
          } catch (e) {
            return String(arg);
          }
        }
        return String(arg);
      }).join(' ');
      
      // Filter out uninteresting errors
      if (message.includes('Warning: validateDOMNesting') || 
          message.includes('Non-serializable values were found in the navigation state')) {
        return;
      }
      
      // Special handling for React warnings
      if (message.includes('Warning: Maximum update depth exceeded')) {
        addLogEntry('errors', `Infinite Loop Detected: ${message}`, 'error');
        
        // Extract component information if available
        const match = message.match(/in (\w+)/);
        if (match && match[1]) {
          addLogEntry('errors', `Component causing loop: ${match[1]}`, 'error');
        }
        
        return;
      }
      
      addLogEntry('errors', message, 'error');
    };
    
    // Override console.warn
    const originalConsoleWarn = console.warn;
    console.warn = function(...args) {
      // Call original method
      originalConsoleWarn.apply(console, args);
      
      // Log to our panel
      const message = args.map(arg => {
        if (typeof arg === 'object') {
          try {
            return JSON.stringify(arg);
          } catch (e) {
            return String(arg);
          }
        }
        return String(arg);
      }).join(' ');
      
      // Only log React warnings
      if (message.includes('Warning:')) {
        addLogEntry('errors', message, 'warning');
      }
    };
    
    // Global error handler
    window.addEventListener('error', function(event) {
      addLogEntry('errors', `Uncaught Error: ${event.message} at ${event.filename}:${event.lineno}`, 'error');
    });
    
    // Unhandled promise rejections
    window.addEventListener('unhandledrejection', function(event) {
      addLogEntry('errors', `Unhandled Promise Rejection: ${event.reason}`, 'error');
    });
  }
  
  // Monitor component rendering
  function setupComponentMonitoring() {
    // This requires React DevTools integration or custom logging in components
    // Since we can't modify React components directly, we'll use heuristics
    
    // Track state updates by monitoring localStorage
    const originalSetItem = localStorage.setItem;
    localStorage.setItem = function(key, value) {
      // Call original method
      originalSetItem.call(localStorage, key, value);
      
      // Log state changes
      addLogEntry('state', `LocalStorage Updated: ${key} = ${value}`, 'info');
    };
    
    // Monitor React state change events
    const targetNodes = ['button', 'input', 'select', 'a'];
    document.addEventListener('click', function(event) {
      if (targetNodes.includes(event.target.tagName.toLowerCase())) {
        const elementInfo = `${event.target.tagName.toLowerCase()}${event.target.id ? '#'+event.target.id : ''}${event.target.className ? '.'+event.target.className.replace(/\s+/g, '.') : ''}`;
        addLogEntry('state', `User interaction: Click on ${elementInfo}`, 'info');
      }
    }, true);
    
    // Inject patch code for StationChat component
    if (localStorage.getItem('fix_station_chat') === 'true') {
      addLogEntry('render', 'Applying StationChat component fix...', 'info');
      
      const script = document.createElement('script');
      script.textContent = `
        // Apply fix to StationChat component once it's loaded
        (function() {
          const originalUseEffect = React.useEffect;
          
          // Override useEffect to patch infinite loops
          React.useEffect = function(callback, deps) {
            // Check if this is the problematic component's useEffect
            const callbackString = callback.toString();
            
            if (callbackString.includes('StationChat') && deps === undefined) {
              console.log('Patching StationChat useEffect with missing dependency array');
              return originalUseEffect(callback, []); // Add empty dependency array
            }
            
            return originalUseEffect(callback, deps);
          };
        })();
      `;
      document.head.appendChild(script);
    }
    
    // Inject patch code for BaristaInterface component
    if (localStorage.getItem('fix_barista_interface') === 'true') {
      addLogEntry('render', 'Applying BaristaInterface component fix...', 'info');
      
      const script = document.createElement('script');
      script.textContent = `
        // Apply fix to BaristaInterface component once it's loaded
        (function() {
          const originalUseEffect = React.useEffect;
          let hasPatched = false;
          
          // Method to patch setState calls inside useEffect
          function patchSetState() {
            if (hasPatched) return;
            
            // Find all component instances that might be BaristaInterface
            const reactInstances = Array.from(document.querySelectorAll('[data-reactroot]'))
              .map(el => el._reactRootContainer?._internalRoot?.current?.child?.stateNode)
              .filter(Boolean);
            
            reactInstances.forEach(instance => {
              if (instance.constructor?.name === 'BaristaInterface') {
                // Patch setState methods to prevent infinite updates
                const originalSetState = instance.setState;
                instance.setState = function(state, callback) {
                  // Check if we're in a render or useEffect cycle
                  const stack = new Error().stack;
                  if (stack.includes('useEffect')) {
                    console.log('Prevented setState in useEffect cycle');
                    return;
                  }
                  return originalSetState.call(this, state, callback);
                };
                
                hasPatched = true;
                console.log('Successfully patched BaristaInterface setState');
              }
            });
          }
          
          // Try to patch after a delay to ensure components are mounted
          setTimeout(patchSetState, 1000);
          setTimeout(patchSetState, 2000);
          setTimeout(patchSetState, 3000);
        })();
      `;
      document.head.appendChild(script);
    }
  }
  
  // Monitor resource usage
  function monitorResourceUsage() {
    setInterval(() => {
      if (window.performance && window.performance.memory) {
        const memory = window.performance.memory;
        const usedHeapSizeMB = Math.round(memory.usedJSHeapSize / (1024 * 1024));
        const totalHeapSizeMB = Math.round(memory.totalJSHeapSize / (1024 * 1024));
        const heapLimit = Math.round(memory.jsHeapSizeLimit / (1024 * 1024));
        
        const usagePercent = Math.round((usedHeapSizeMB / totalHeapSizeMB) * 100);
        
        let type = 'info';
        if (usagePercent > 90) {
          type = 'error';
        } else if (usagePercent > 70) {
          type = 'warning';
        }
        
        addLogEntry('state', `Memory: ${usedHeapSizeMB}MB / ${totalHeapSizeMB}MB (${usagePercent}%)`, type);
      }
    }, 5000); // Check every 5 seconds
  }
  
  // Initialize the debug panel
  init();
})();