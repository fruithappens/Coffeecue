/**
 * AGGRESSIVE REFRESH KILLER
 * This script forcefully stops all auto-refresh and blinking functionality
 */

(function() {
  console.log('🛑 REFRESH KILLER: Initializing aggressive refresh and animation blocker...');
  
  // First, kill all existing intervals (this stops auto-refresh)
  function killAllIntervals() {
    console.log('🛑 REFRESH KILLER: Killing all intervals...');
    const maxId = window.setInterval(function(){}, 9999);
    for (let i = 1; i <= maxId; i++) {
      window.clearInterval(i);
    }
  }
  
  // Kill all timeouts that might restart intervals
  function killAllTimeouts() {
    console.log('🛑 REFRESH KILLER: Killing all timeouts...');
    const maxId = window.setTimeout(function(){}, 9999);
    for (let i = 1; i <= maxId; i++) {
      window.clearTimeout(i);
    }
  }
  
  // Override setInterval to prevent new refresh intervals
  function overrideIntervalFunctions() {
    console.log('🛑 REFRESH KILLER: Overriding interval functions...');
    
    // Save original functions
    window.originalSetInterval = window.setInterval;
    window.originalSetTimeout = window.setTimeout;
    
    // Override setInterval
    window.setInterval = function(callback, delay, ...args) {
      // Block all intervals with short delays (likely refresh)
      if (delay < 10000) {
        console.log('🛑 REFRESH KILLER: Blocked interval with delay:', delay);
        return 0;
      }
      console.log('🛑 REFRESH KILLER: Allowed interval with delay:', delay);
      return window.originalSetInterval(callback, delay, ...args);
    };
    
    // Override setTimeout for short delays that might set up intervals
    window.setTimeout = function(callback, delay, ...args) {
      if (delay < 100) {
        // For very short timeouts, check if the callback source contains refresh keywords
        const callbackString = callback.toString().toLowerCase();
        if (callbackString.includes('refresh') || 
            callbackString.includes('interval') || 
            callbackString.includes('fetch') ||
            callbackString.includes('update')) {
          console.log('🛑 REFRESH KILLER: Blocked suspicious timeout with delay:', delay);
          return 0;
        }
      }
      return window.originalSetTimeout(callback, delay, ...args);
    };
  }
  
  // Disable specific refresh functions
  function disableRefreshFunctions() {
    console.log('🛑 REFRESH KILLER: Disabling specific refresh functions...');
    
    // Common refresh function names
    const refreshFunctionNames = [
      'refreshData',
      'autoRefresh',
      'refreshOrders',
      'refresh',
      'startRefresh',
      'enableRefresh',
      'refreshContent',
      'periodicRefresh',
      'startAutoRefresh',
      'setupRefresh',
      'refreshLoop',
      'scheduleRefresh',
      'refreshCallback'
    ];
    
    // Replace them all with no-op functions
    refreshFunctionNames.forEach(name => {
      if (window[name]) {
        console.log(`🛑 REFRESH KILLER: Disabling ${name}...`);
        window[`original_${name}`] = window[name];
        window[name] = function() {
          console.log(`🛑 REFRESH KILLER: Blocked call to ${name}`);
          return false;
        };
      }
    });
    
    // Also look for any other functions with "refresh" in the name
    Object.getOwnPropertyNames(window).forEach(prop => {
      if (typeof window[prop] === 'function' && 
          prop.toLowerCase().includes('refresh') &&
          !prop.startsWith('original_')) {
        console.log(`🛑 REFRESH KILLER: Found and disabling ${prop}...`);
        window[`original_${prop}`] = window[prop];
        window[prop] = function() {
          console.log(`🛑 REFRESH KILLER: Blocked call to ${prop}`);
          return false;
        };
      }
    });
  }
  
  // Set all storage flags to disable refresh
  function setRefreshFlags() {
    console.log('🛑 REFRESH KILLER: Setting storage flags to disable refresh...');
    
    localStorage.setItem('coffee_auto_refresh_enabled', 'false');
    localStorage.setItem('autoRefreshEnabled', 'false');
    localStorage.setItem('refreshDisabled', 'true');
    localStorage.setItem('disableRefresh', 'true');
    localStorage.setItem('noRefresh', 'true');
    localStorage.setItem('refresh_interval', '0');
    
    sessionStorage.setItem('refreshDisabled', 'true');
    sessionStorage.setItem('disableRefresh', 'true');
    sessionStorage.setItem('noRefresh', 'true');
    
    // Set global variables
    window.REFRESH_DISABLED = true;
    window.AUTO_REFRESH_ENABLED = false;
    window.refreshEnabled = false;
    window.refreshInterval = 0;
  }
  
  // Stop all animations and blinking
  function stopAnimations() {
    console.log('🛑 REFRESH KILLER: Stopping all animations and blinking...');
    
    // Create style to override all animations
    const style = document.createElement('style');
    style.textContent = `
      * {
        animation: none !important;
        -webkit-animation: none !important;
        animation-duration: 0s !important;
        -webkit-animation-duration: 0s !important;
        transition: none !important;
        -webkit-transition: none !important;
        transition-duration: 0s !important;
        -webkit-transition-duration: 0s !important;
      }
      
      @keyframes none {
        from { } to { }
      }
      
      @-webkit-keyframes none {
        from { } to { }
      }
      
      /* Specifically target blinking elements */
      .blink, [class*="blink"], [id*="blink"],
      .flash, [class*="flash"], [id*="flash"],
      .pulse, [class*="pulse"], [id*="pulse"] {
        animation: none !important;
        -webkit-animation: none !important;
        opacity: 1 !important;
        visibility: visible !important;
      }
    `;
    
    document.head.appendChild(style);
    
    // Also try to remove any existing animation styles
    try {
      const styleSheets = document.styleSheets;
      for (let i = 0; i < styleSheets.length; i++) {
        try {
          const rules = styleSheets[i].cssRules || styleSheets[i].rules;
          if (!rules) continue;
          
          for (let j = 0; j < rules.length; j++) {
            const rule = rules[j];
            
            // Look for keyframes or animation-related rules
            if (rule.type === CSSRule.KEYFRAMES_RULE || 
                (rule.type === CSSRule.STYLE_RULE && 
                 (rule.selectorText && (
                   rule.selectorText.includes('blink') || 
                   rule.selectorText.includes('flash') || 
                   rule.selectorText.includes('pulse')
                 ) || 
                 rule.style && (
                   rule.style.animation || 
                   rule.style.animationName ||
                   rule.style.WebkitAnimation
                 )))) {
              
              // Try to delete the rule
              try {
                styleSheets[i].deleteRule(j);
                j--; // Adjust for the removed rule
                console.log('🛑 REFRESH KILLER: Removed animation rule');
              } catch (e) {
                console.log('🛑 REFRESH KILLER: Could not remove rule:', e);
              }
            }
          }
        } catch (e) {
          console.log('🛑 REFRESH KILLER: Error accessing stylesheet:', e);
        }
      }
    } catch (e) {
      console.log('🛑 REFRESH KILLER: Error stopping animations:', e);
    }
  }
  
  // Monitor DOM for new blinking elements
  function monitorDOM() {
    console.log('🛑 REFRESH KILLER: Setting up DOM mutation observer...');
    
    const observer = new MutationObserver(function(mutations) {
      mutations.forEach(function(mutation) {
        if (mutation.addedNodes && mutation.addedNodes.length > 0) {
          for (let i = 0; i < mutation.addedNodes.length; i++) {
            const node = mutation.addedNodes[i];
            if (node.nodeType === 1) { // Element node
              // Check if it might be a blinking element
              if (node.className && (
                  node.className.includes('blink') || 
                  node.className.includes('flash') || 
                  node.className.includes('pulse')
                )) {
                // Remove animation styles
                node.style.animation = 'none';
                node.style.WebkitAnimation = 'none';
                node.style.opacity = '1';
                console.log('🛑 REFRESH KILLER: Fixed new blinking element:', node);
              }
              
              // Check for style attribute with animations
              if (node.style && (
                  node.style.animation || 
                  node.style.WebkitAnimation
                )) {
                node.style.animation = 'none';
                node.style.WebkitAnimation = 'none';
                console.log('🛑 REFRESH KILLER: Removed animation from new element:', node);
              }
            }
          }
        }
      });
    });
    
    // Start observing the document
    observer.observe(document, {
      childList: true,
      subtree: true
    });
  }
  
  // Patch React components that might cause refresh
  function patchReact() {
    console.log('🛑 REFRESH KILLER: Attempting to patch React components...');
    
    // Wait for React to be available
    const checkReact = setInterval(function() {
      // Check if we can find React in various places
      const reactRoot = document.getElementById('root');
      if (reactRoot && reactRoot._reactRootContainer) {
        clearInterval(checkReact);
        console.log('🛑 REFRESH KILLER: Found React, patching components...');
        
        try {
          // Try to find component instances using React DevTools format
          const reactInstance = reactRoot._reactRootContainer._internalRoot.current;
          
          // Recursive function to find and patch components
          function traverseAndPatch(fiber) {
            if (!fiber) return;
            
            // Check component name
            const name = fiber.type ? (fiber.type.name || fiber.type.displayName || '') : '';
            
            // If it's a refresh-related component, try to patch it
            if (name.includes('Refresh') || name.includes('Polling') || name.includes('Update') || name.includes('Interval')) {
              console.log(`🛑 REFRESH KILLER: Found React component that might refresh: ${name}`);
              
              // Try to disable its state or props
              if (fiber.memoizedProps) {
                if (fiber.memoizedProps.refreshInterval !== undefined) {
                  fiber.memoizedProps.refreshInterval = 0;
                }
                if (fiber.memoizedProps.interval !== undefined) {
                  fiber.memoizedProps.interval = 0;
                }
                if (fiber.memoizedProps.enabled !== undefined) {
                  fiber.memoizedProps.enabled = false;
                }
                if (fiber.memoizedProps.autoRefresh !== undefined) {
                  fiber.memoizedProps.autoRefresh = false;
                }
              }
              
              if (fiber.memoizedState) {
                // Try to find and clear refresh-related state
                Object.keys(fiber.memoizedState).forEach(key => {
                  if (typeof fiber.memoizedState[key] === 'number' && 
                      (key.includes('interval') || key.includes('timer'))) {
                    console.log(`🛑 REFRESH KILLER: Clearing React component state: ${key}`);
                    clearInterval(fiber.memoizedState[key]);
                    fiber.memoizedState[key] = 0;
                  }
                });
              }
            }
            
            // Continue traversing
            if (fiber.child) traverseAndPatch(fiber.child);
            if (fiber.sibling) traverseAndPatch(fiber.sibling);
          }
          
          traverseAndPatch(reactInstance);
          
        } catch (e) {
          console.log('🛑 REFRESH KILLER: Error patching React:', e);
        }
      }
    }, 1000);
    
    // Clear our own interval after 10 seconds to avoid irony
    setTimeout(function() {
      clearInterval(checkReact);
    }, 10000);
  }
  
  // Monitor for errors and fix them
  function monitorErrors() {
    console.log('🛑 REFRESH KILLER: Setting up error monitoring...');
    
    window.addEventListener('error', function(event) {
      console.log(`🛑 REFRESH KILLER: Caught error: ${event.message}`);
      
      // If it's a refresh-related error, apply fixes again
      if (event.message.includes('refresh') || 
          event.message.includes('interval')) {
        console.log('🛑 REFRESH KILLER: Refresh-related error detected, applying fixes again...');
        
        // Reapply all fixes
        killAllIntervals();
        killAllTimeouts();
        setRefreshFlags();
      }
    });
  }
  
  // Run all fixes
  function applyAllFixes() {
    killAllIntervals();
    killAllTimeouts();
    overrideIntervalFunctions();
    disableRefreshFunctions();
    setRefreshFlags();
    stopAnimations();
    monitorDOM();
    patchReact();
    monitorErrors();
    
    console.log('🛑 REFRESH KILLER: All fixes applied successfully!');
    console.log('🛑 REFRESH KILLER: The application should no longer auto-refresh or blink.');
  }
  
  // Run fixes immediately
  applyAllFixes();
  
  // Also run again after everything is loaded
  window.addEventListener('load', function() {
    console.log('🛑 REFRESH KILLER: Window loaded, reapplying fixes...');
    applyAllFixes();
  });
  
  // Run once more after a short delay to catch any missed refresh
  setTimeout(function() {
    console.log('🛑 REFRESH KILLER: Running delayed fix...');
    applyAllFixes();
  }, 2000);
  
  // Export functions to window for debugging
  window.refreshKiller = {
    killAllIntervals,
    killAllTimeouts,
    overrideIntervalFunctions,
    disableRefreshFunctions,
    setRefreshFlags,
    stopAnimations,
    monitorDOM,
    patchReact,
    monitorErrors,
    applyAllFixes
  };
})();