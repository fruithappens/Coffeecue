/**
 * Expresso Test Injector - DELETE LATER
 *
 * This script injects the auto-tester into any page.
 * It's designed to be added via developer tools console or browser bookmark.
 * 
 * THIS SCRIPT IS FOR TESTING ONLY AND SHOULD BE REMOVED BEFORE PRODUCTION!
 */

(function() {
  console.log('%c[EXPRESSO TEST INJECTOR] Starting...', 'color: #e74c3c; font-weight: bold;');
  console.log('%c[WARNING] This tool is for testing only and should be deleted before deployment!', 'color: #e74c3c; font-weight: bold;');
  
  // Create loading indicator
  const loader = document.createElement('div');
  loader.style = `
    position: fixed;
    top: 10px;
    right: 10px;
    background: #e74c3c;
    color: white;
    padding: 10px;
    border-radius: 5px;
    font-family: sans-serif;
    font-size: 14px;
    z-index: 9999;
    box-shadow: 0 2px 4px rgba(0,0,0,0.2);
  `;
  loader.textContent = 'Loading Expresso Tester...';
  document.body.appendChild(loader);
  
  // Load auto-tester script
  function loadScript(url) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = url;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }
  
  // Start testing process
  async function startTesting() {
    try {
      // Load auto-tester script
      await loadScript('/auto-tester-DELETE_LATER.js');
      
      // Update loading indicator
      loader.textContent = 'Tester loaded, starting tests...';
      loader.style.background = '#3498db';
      
      // Wait for auto-tester to initialize
      if (!window.autoTester) {
        console.error('[EXPRESSO TEST INJECTOR] Auto-tester not available after loading script');
        loader.textContent = 'Error: Auto-tester not available';
        loader.style.background = '#e74c3c';
        return;
      }
      
      // Create UI and run tests
      window.autoTester.createUI();
      
      // Remove loading indicator
      document.body.removeChild(loader);
      
      // Auto run tests if URL parameter is present
      if (window.location.search.includes('auto_test=true') || window.location.hash === '#auto_test') {
        setTimeout(() => {
          console.log('[EXPRESSO TEST INJECTOR] Auto-running tests based on URL parameter');
          window.autoTester.runAllTests();
        }, 1000);
      }
    } catch (error) {
      console.error('[EXPRESSO TEST INJECTOR] Error loading auto-tester:', error);
      loader.textContent = `Error: ${error.message}`;
      loader.style.background = '#e74c3c';
    }
  }
  
  // Start the testing process
  startTesting();
})();

// Create a bookmarklet version that can be added to bookmarks
console.log('Add this as a bookmark to inject the tester on any page:');
console.log(`javascript:(function(){const s=document.createElement('script');s.src='/test-injector-DELETE_LATER.js';document.head.appendChild(s);})();`);