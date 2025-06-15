/**
 * Clean Interface Script
 * Removes debug elements and fixes content loading issues
 */
(function() {
  // Check if we should use clean interface
  const useCleanInterface = localStorage.getItem('use_clean_interface') === 'true';
  const hideDebugTools = localStorage.getItem('hide_debug_tools') === 'true';
  
  // Exit early if we're not using clean interface
  if (!useCleanInterface && !hideDebugTools) return;
  
  console.log('Clean interface mode activated');
  
  // Function to remove debug elements once DOM is loaded
  function removeDebugElements() {
    // Debug tools to remove (selectors)
    const debugSelectors = [
      'a[href*="debug.html"]',
      'a[href*="fix-resource-issue.html"]',
      'button:contains("Refresh Data")',
      '[data-testid="debug-panel"]',
      '[data-testid="api-debug"]',
      '.debug-tools',
      '#debug-link',
      '#fix-link'
    ];
    
    // Remove each debug element
    debugSelectors.forEach(selector => {
      try {
        // Handle jQuery-style :contains selector
        if (selector.includes(':contains(')) {
          const [elemType, textContent] = selector.split(':contains(');
          const text = textContent.replace(')', '').replace(/"/g, '');
          
          document.querySelectorAll(elemType).forEach(el => {
            if (el.textContent.includes(text)) {
              el.style.display = 'none';
              // Don't remove to avoid breaking event handlers
            }
          });
        } else {
          // Standard selector
          document.querySelectorAll(selector).forEach(el => {
            el.style.display = 'none';
            // Don't remove to avoid breaking event handlers
          });
        }
      } catch (e) {
        console.error(`Error removing debug element with selector ${selector}:`, e);
      }
    });
    
    // Also look for fixed position elements that might be debug tools
    document.querySelectorAll('button[style*="position: fixed"], a[style*="position: fixed"]').forEach(el => {
      // Only hide debug-looking elements (not critical UI controls)
      const debugTerms = ['debug', 'fix', 'refresh', 'reset', 'tools'];
      if (debugTerms.some(term => el.textContent.toLowerCase().includes(term))) {
        el.style.display = 'none';
      }
    });
    
    console.log('Removed debug elements from UI');
  }
  
  // Function to fix content loading issues
  function fixContentLoading() {
    // Check if we need to force a rerender
    const forceRerender = localStorage.getItem('force_barista_rerender') === 'true';
    if (!forceRerender) return;
    
    // Get the root element
    const root = document.getElementById('root');
    if (!root) return;
    
    // Force a reflow of the container elements
    const forceReflow = () => {
      // Try to find the main content containers
      const contentSelectors = [
        '.orders-container', '.stock-container', '.schedule-container',
        '.completed-container', '.display-container', '.settings-container'
      ];
      
      contentSelectors.forEach(selector => {
        const container = document.querySelector(selector);
        if (container) {
          // Force a reflow by accessing offsetHeight and temporarily modifying display
          const originalDisplay = container.style.display;
          container.style.display = 'none';
          container.offsetHeight; // Trigger reflow
          container.style.display = originalDisplay;
        }
      });
      
      // Clear the flag
      localStorage.removeItem('force_barista_rerender');
      console.log('Forced content container reflow');
    };
    
    // Wait a short while for React components to initialize
    setTimeout(forceReflow, 500);
  }
  
  // Register a MutationObserver to catch newly added debug elements
  function setupObserver() {
    // Create observer instance
    const observer = new MutationObserver(mutations => {
      mutations.forEach(mutation => {
        if (mutation.addedNodes.length) {
          // Check if we need to remove debug elements again
          removeDebugElements();
        }
      });
    });
    
    // Start observing the document body
    observer.observe(document.body, { childList: true, subtree: true });
    
    // Clean up on unload
    window.addEventListener('beforeunload', () => {
      observer.disconnect();
    });
  }
  
  // Execute when DOM is loaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      removeDebugElements();
      fixContentLoading();
      setupObserver();
    });
  } else {
    removeDebugElements();
    fixContentLoading();
    setupObserver();
  }
  
  // Add functionality to reload content when navigation events occur
  const originalPushState = window.history.pushState;
  window.history.pushState = function() {
    originalPushState.apply(this, arguments);
    
    // When navigation happens, reapply our fixes
    setTimeout(() => {
      removeDebugElements();
      fixContentLoading();
    }, 100);
  };
})();