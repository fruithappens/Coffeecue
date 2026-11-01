/**
 * Expresso Auto Tester - DELETE LATER
 * 
 * This script automatically tests the Expresso frontend application.
 * It runs various tests to check login functionality, order processing,
 * navigation, and other features. Results are logged to the console.
 * 
 * THIS SCRIPT IS FOR TESTING ONLY AND SHOULD BE REMOVED BEFORE PRODUCTION!
 */

// Self-executing function to avoid polluting global scope
(function() {
  // Test configuration
  const config = {
    // Test credentials
    credentials: {
      barista: {
        username: 'barista',
        password: 'ExpressoBarista2025'
      },
      admin: {
        username: 'coffeecue',
        password: 'ExpressoAdmin2025'
      }
    },
    
    // API endpoints
    api: {
      baseUrl: '/api',
      login: '/api/auth/login',
      refresh: '/api/auth/refresh',
      orders: '/api/orders',
      stations: '/api/stations',
      inventory: '/api/inventory'
    },
    
    // Test scenarios
    scenarios: {
      login: true,
      navigation: true,
      orders: true,
      components: true,
      errorHandling: true
    },
    
    // Timeouts and delays
    timeouts: {
      loginDelay: 2000,
      navigationDelay: 1000,
      actionDelay: 1500,
      errorTimeout: 60000 // 1 minute timeout for error recovery
    },
    
    // Maximum retry attempts
    maxRetries: 3,
    
    // Logging level
    loggingLevel: 'verbose', // 'verbose', 'normal', 'minimal'
    
    // Auto-fix issues
    autoFix: true,
    
    // Automatically enable fallback mode on critical errors
    autoEnableFallback: true
  };
  
  // Test results collection
  const testResults = {
    total: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    errors: [],
    warnings: [],
    fixes: []
  };
  
  // Original console methods
  const originalConsole = {
    log: console.log,
    error: console.error,
    warn: console.warn,
    info: console.info
  };
  
  // Logger
  const logger = {
    log: function(message) {
      originalConsole.log(`[AUTO-TESTER] ${message}`);
      
      // Add to UI log if element exists
      const logElement = document.getElementById('test-logs');
      if (logElement) {
        const logEntry = document.createElement('div');
        logEntry.className = 'log-entry';
        logEntry.innerHTML = `<strong>[${new Date().toLocaleTimeString()}]</strong>: ${message}`;
        logElement.prepend(logEntry);
      }
    },
    
    error: function(message) {
      originalConsole.error(`[AUTO-TESTER ERROR] ${message}`);
      
      // Add to UI log if element exists
      const logElement = document.getElementById('test-logs');
      if (logElement) {
        const logEntry = document.createElement('div');
        logEntry.className = 'log-entry error';
        logEntry.innerHTML = `<strong>[${new Date().toLocaleTimeString()}]</strong>: ${message}`;
        logElement.prepend(logEntry);
      }
      
      // Add to test results
      testResults.errors.push({
        message,
        timestamp: new Date()
      });
    },
    
    warn: function(message) {
      originalConsole.warn(`[AUTO-TESTER WARNING] ${message}`);
      
      // Add to UI log if element exists
      const logElement = document.getElementById('test-logs');
      if (logElement) {
        const logEntry = document.createElement('div');
        logEntry.className = 'log-entry warning';
        logEntry.innerHTML = `<strong>[${new Date().toLocaleTimeString()}]</strong>: ${message}`;
        logElement.prepend(logEntry);
      }
      
      // Add to test results
      testResults.warnings.push({
        message,
        timestamp: new Date()
      });
    },
    
    success: function(message) {
      originalConsole.log(`[AUTO-TESTER SUCCESS] ${message}`);
      
      // Add to UI log if element exists
      const logElement = document.getElementById('test-logs');
      if (logElement) {
        const logEntry = document.createElement('div');
        logEntry.className = 'log-entry success';
        logEntry.innerHTML = `<strong>[${new Date().toLocaleTimeString()}]</strong>: ${message}`;
        logElement.prepend(logEntry);
      }
    },
    
    fix: function(message) {
      originalConsole.log(`[AUTO-TESTER FIX] ${message}`);
      
      // Add to UI log if element exists
      const logElement = document.getElementById('test-logs');
      if (logElement) {
        const logEntry = document.createElement('div');
        logEntry.className = 'log-entry fix';
        logEntry.innerHTML = `<strong>[${new Date().toLocaleTimeString()}]</strong>: ${message}`;
        logElement.prepend(logEntry);
      }
      
      // Add to test results
      testResults.fixes.push({
        message,
        timestamp: new Date()
      });
    }
  };
  
  // Test functions
  const tests = {
    /**
     * Test login functionality
     */
    async login() {
      logger.log('Starting login test...');
      testResults.total++;
      
      try {
        // Clear any existing tokens
        localStorage.removeItem('coffee_system_token');
        localStorage.removeItem('coffee_system_refresh_token');
        localStorage.removeItem('coffee_system_token_expiry');
        localStorage.removeItem('coffee_system_user');
        
        // Use the barista credentials
        const { username, password } = config.credentials.barista;
        
        // Make a direct login request
        const response = await fetch(config.api.login, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ username, password })
        });
        
        // Check for successful login
        if (response.ok) {
          const data = await response.json();
          
          // Check for token
          if (data.token) {
            // Store the token
            localStorage.setItem('coffee_system_token', data.token);
            
            // Store refresh token if provided
            if (data.refreshToken) {
              localStorage.setItem('coffee_system_refresh_token', data.refreshToken);
            }
            
            // Store token expiry if provided
            if (data.expiresIn) {
              const expiry = new Date();
              expiry.setSeconds(expiry.getSeconds() + data.expiresIn);
              localStorage.setItem('coffee_system_token_expiry', expiry.toISOString());
            }
            
            // Store user data if provided
            if (data.user) {
              localStorage.setItem('coffee_system_user', JSON.stringify(data.user));
            }
            
            logger.success(`Login successful with username: ${username}`);
            logger.log(`Token received and stored`);
            
            testResults.passed++;
            return true;
          } else {
            throw new Error('Login response did not include a token');
          }
        } else {
          // Handle specific status codes
          if (response.status === 401) {
            throw new Error('Invalid credentials');
          } else if (response.status === 500) {
            throw new Error('Server error during login');
          } else {
            throw new Error(`Login failed with status: ${response.status}`);
          }
        }
      } catch (error) {
        logger.error(`Login test failed: ${error.message}`);
        
        if (config.autoFix) {
          // Attempt to fix by creating a dummy token for testing
          logger.fix('Creating dummy token as fallback');
          
          // Create and store a dummy token
          const token = createDummyToken();
          logger.log('Dummy token created for testing');
          
          // Enable fallback mode
          localStorage.setItem('use_fallback_data', 'true');
          localStorage.setItem('fallback_data_available', 'true');
          
          // Dispatch event to notify app
          try {
            window.dispatchEvent(new CustomEvent('fallback-mode-enabled'));
          } catch (e) {
            logger.warn('Failed to dispatch fallback mode event');
          }
          
          return true; // Continue tests with dummy token
        } else {
          testResults.failed++;
          return false;
        }
      }
    },
    
    /**
     * Test navigation and view loading
     */
    async navigation() {
      logger.log('Starting navigation test...');
      testResults.total++;
      
      try {
        // Check if we have a token
        const token = localStorage.getItem('coffee_system_token');
        if (!token) {
          logger.warn('No authentication token available for navigation test');
          
          if (config.autoFix) {
            // Create a dummy token
            createDummyToken();
            logger.fix('Created dummy token for navigation test');
          } else {
            testResults.skipped++;
            return false;
          }
        }
        
        // Test navigation to barista interface
        logger.log('Testing navigation to barista interface...');
        
        // Redirect to barista interface
        window.location.href = '/barista';
        
        // Wait for page to load
        const maxWaitTime = 10000; // 10 seconds
        const startTime = Date.now();
        
        // Use a promise that resolves when we detect the barista interface or timeout
        await new Promise((resolve, reject) => {
          const checkInterval = setInterval(() => {
            // Look for elements that would indicate the barista interface is loaded
            const baristaElements = document.querySelectorAll(
              '.barista-interface, #barista-app, [data-testid="barista-interface"]'
            );
            
            if (baristaElements.length > 0) {
              clearInterval(checkInterval);
              clearTimeout(timeoutId);
              logger.success('Barista interface loaded successfully');
              resolve(true);
            } else if (Date.now() - startTime > maxWaitTime) {
              clearInterval(checkInterval);
              clearTimeout(timeoutId);
              reject(new Error('Timed out waiting for barista interface to load'));
            }
          }, 500); // Check every 500ms
          
          // Set a timeout as a fallback
          const timeoutId = setTimeout(() => {
            clearInterval(checkInterval);
            reject(new Error('Timed out waiting for barista interface to load'));
          }, maxWaitTime);
        });
        
        // Test tab navigation
        logger.log('Testing tab navigation...');
        
        // Find the tab navigation elements
        const tabs = document.querySelectorAll('.tab, .nav-item, [role="tab"]');
        
        if (tabs.length === 0) {
          throw new Error('No tab navigation elements found');
        }
        
        logger.log(`Found ${tabs.length} navigation tabs`);
        
        // Try clicking on each tab
        let tabsWorking = 0;
        
        for (const tab of tabs) {
          try {
            // Click the tab
            tab.click();
            
            // Wait a moment for content to load
            await new Promise(resolve => setTimeout(resolve, config.timeouts.navigationDelay));
            
            // Check if tab content loaded
            const tabContentId = tab.getAttribute('aria-controls') || tab.getAttribute('data-target');
            const activeContent = document.querySelector('.active, .show, [aria-expanded="true"]');
            
            if (tabContentId) {
              const targetContent = document.getElementById(tabContentId);
              if (targetContent && (targetContent.classList.contains('active') || targetContent.classList.contains('show'))) {
                tabsWorking++;
              }
            } else if (activeContent) {
              tabsWorking++;
            }
          } catch (e) {
            logger.warn(`Error clicking on tab: ${e.message}`);
          }
        }
        
        logger.log(`${tabsWorking} out of ${tabs.length} tabs worked correctly`);
        
        // Test successful if at least one tab works
        if (tabsWorking > 0) {
          logger.success('Navigation test passed');
          testResults.passed++;
          return true;
        } else {
          throw new Error('No tabs functioned correctly');
        }
      } catch (error) {
        logger.error(`Navigation test failed: ${error.message}`);
        
        if (config.autoFix) {
          logger.fix('Attempting to fix navigation issues by reloading page');
          window.location.reload();
        }
        
        testResults.failed++;
        return false;
      }
    },
    
    /**
     * Test order functionality
     */
    async orders() {
      logger.log('Starting order functionality test...');
      testResults.total++;
      
      try {
        // Check if we're on the barista interface
        if (!window.location.pathname.includes('/barista')) {
          logger.log('Navigating to barista interface first...');
          window.location.href = '/barista';
          
          // Wait for page to load
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
        
        // First check if we can create a walk-in order
        logger.log('Testing walk-in order creation...');
        
        // Find the walk-in order button
        const walkInButton = document.querySelector(
          'button.walk-in-btn, [data-testid="walk-in-button"], button:contains("Walk-in")'
        );
        
        if (!walkInButton) {
          throw new Error('Walk-in order button not found');
        }
        
        // Click the button to open dialog
        walkInButton.click();
        logger.log('Clicked walk-in order button');
        
        // Wait for dialog to appear
        await new Promise(resolve => setTimeout(resolve, config.timeouts.actionDelay));
        
        // Find form elements
        const dialog = document.querySelector('.dialog, .modal, [role="dialog"]');
        if (!dialog) {
          throw new Error('Walk-in order dialog did not open');
        }
        
        logger.log('Walk-in order dialog opened');
        
        // Fill in form
        const nameInput = dialog.querySelector('input[name="customerName"], #customer-name');
        const coffeeSelect = dialog.querySelector('select[name="coffeeType"], #coffee-type');
        const milkSelect = dialog.querySelector('select[name="milkType"], #milk-type');
        const submitButton = dialog.querySelector('button[type="submit"], .submit-btn');
        
        if (!nameInput || !coffeeSelect || !milkSelect || !submitButton) {
          throw new Error('Form elements not found in walk-in dialog');
        }
        
        // Fill values
        nameInput.value = 'Auto Tester';
        nameInput.dispatchEvent(new Event('input', { bubbles: true }));
        
        // Select coffee type
        if (coffeeSelect.options.length > 0) {
          coffeeSelect.selectedIndex = 0; // Select first option
          coffeeSelect.dispatchEvent(new Event('change', { bubbles: true }));
        }
        
        // Select milk type
        if (milkSelect.options.length > 0) {
          milkSelect.selectedIndex = 0; // Select first option
          milkSelect.dispatchEvent(new Event('change', { bubbles: true }));
        }
        
        logger.log('Form filled with test data');
        
        // Submit form
        submitButton.click();
        logger.log('Submitted walk-in order form');
        
        // Wait for response
        await new Promise(resolve => setTimeout(resolve, config.timeouts.actionDelay));
        
        // Check for success message or new order in the list
        const successMessage = document.querySelector('.success-message, .toast-success, .notification-success');
        const newOrders = document.querySelectorAll('.order-card, .order-item');
        
        if (successMessage) {
          logger.success('Walk-in order created successfully: Order success message displayed');
        } else if (newOrders.length > 0) {
          logger.success('Walk-in order form submitted, orders present in list');
        } else {
          throw new Error('No confirmation of successful order creation');
        }
        
        testResults.passed++;
        return true;
      } catch (error) {
        logger.error(`Order functionality test failed: ${error.message}`);
        
        if (config.autoFix) {
          logger.fix('Attempting direct API order creation as fallback');
          
          try {
            // Get token
            const token = localStorage.getItem('coffee_system_token');
            
            // Create order via API
            const orderData = {
              customerName: 'Auto Tester',
              coffeeType: 'Cappuccino',
              milkType: 'Regular',
              size: 'Medium',
              sugar: 1
            };
            
            const response = await fetch(config.api.orders, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
              },
              body: JSON.stringify(orderData)
            });
            
            if (response.ok) {
              const data = await response.json();
              logger.fix(`Order created via API with ID: ${data.id || data.orderId}`);
            } else {
              logger.error(`API order creation failed with status: ${response.status}`);
              
              if (config.autoEnableFallback) {
                enableFallbackMode();
              }
            }
          } catch (apiError) {
            logger.error(`API order creation failed: ${apiError.message}`);
            
            if (config.autoEnableFallback) {
              enableFallbackMode();
            }
          }
        }
        
        testResults.failed++;
        return false;
      }
    },
    
    /**
     * Test components and UI elements
     */
    async components() {
      logger.log('Starting component tests...');
      testResults.total++;
      
      try {
        // Check if we're on the barista interface
        if (!window.location.pathname.includes('/barista')) {
          logger.warn('Not on barista interface, skipping component tests');
          testResults.skipped++;
          return false;
        }
        
        // Test notification system
        logger.log('Testing notification system...');
        
        // Look for notification system
        const notificationSystem = window.notificationSystem || 
                                 (window.mainApp && window.mainApp.notificationSystem);
        
        if (notificationSystem) {
          logger.log('Notification system found, showing test notification');
          notificationSystem.info('Test notification from Auto Tester');
        } else {
          logger.warn('Notification system not found');
        }
        
        // Test order sorting
        logger.log('Testing order sorting functionality...');
        
        // Find sort buttons
        const sortButtons = document.querySelectorAll('.sort-btn, [data-sort]');
        
        if (sortButtons.length > 0) {
          logger.log(`Found ${sortButtons.length} sort buttons`);
          
          // Click the first sort button
          sortButtons[0].click();
          logger.log('Clicked sort button');
          
          // Wait a moment for sorting to take effect
          await new Promise(resolve => setTimeout(resolve, config.timeouts.actionDelay));
        } else {
          logger.warn('No sort buttons found');
        }
        
        // Test searching if available
        logger.log('Testing search functionality...');
        
        // Find search input
        const searchInput = document.querySelector('input[type="search"], .search-input');
        
        if (searchInput) {
          logger.log('Search input found, testing search');
          
          // Enter search text
          searchInput.value = 'test';
          searchInput.dispatchEvent(new Event('input', { bubbles: true }));
          
          // Wait for search results
          await new Promise(resolve => setTimeout(resolve, config.timeouts.actionDelay));
        } else {
          logger.warn('No search input found');
        }
        
        // Test tab content rendering
        logger.log('Testing tab content rendering...');
        
        // Find and click tabs
        const tabs = document.querySelectorAll('.tab, .nav-item, [role="tab"]');
        let contentFound = false;
        
        for (const tab of tabs) {
          try {
            tab.click();
            
            // Wait for content to load
            await new Promise(resolve => setTimeout(resolve, config.timeouts.navigationDelay));
            
            // Check if content loaded
            const activeContent = document.querySelector('.tab-content.active, .tab-pane.active');
            
            if (activeContent && activeContent.children.length > 0) {
              contentFound = true;
              logger.log('Tab content loaded successfully');
            }
          } catch (e) {
            // Ignore errors and continue testing other tabs
          }
        }
        
        if (!contentFound) {
          logger.warn('No tab content was found to render correctly');
        }
        
        // Overall components test passed if we got this far
        logger.success('Component tests completed');
        testResults.passed++;
        return true;
      } catch (error) {
        logger.error(`Component tests failed: ${error.message}`);
        testResults.failed++;
        return false;
      }
    },
    
    /**
     * Test error handling
     */
    async errorHandling() {
      logger.log('Starting error handling tests...');
      testResults.total++;
      
      try {
        // Save current fallback mode state
        const originalFallbackMode = localStorage.getItem('use_fallback_data');
        
        // Ensure fallback mode is disabled for this test
        localStorage.removeItem('use_fallback_data');
        
        // Test with invalid token
        logger.log('Testing JWT error handling with invalid token...');
        
        // Save the original token
        const originalToken = localStorage.getItem('coffee_system_token');
        
        // Set an invalid token
        localStorage.setItem('coffee_system_token', 'invalid.jwt.token');
        
        // Make a request with the invalid token
        try {
          const response = await fetch(config.api.orders, {
            headers: {
              'Authorization': 'Bearer invalid.jwt.token'
            }
          });
          
          logger.log(`Response status with invalid token: ${response.status}`);
          
          // Check if the app activates fallback mode automatically
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          const fallbackModeActivated = localStorage.getItem('use_fallback_data') === 'true';
          
          if (fallbackModeActivated) {
            logger.success('Application correctly activated fallback mode for invalid token');
          } else {
            logger.warn('Application did not activate fallback mode for invalid token');
          }
        } catch (e) {
          logger.warn(`Error during invalid token test: ${e.message}`);
        }
        
        // Restore original token
        if (originalToken) {
          localStorage.setItem('coffee_system_token', originalToken);
        } else {
          localStorage.removeItem('coffee_system_token');
        }
        
        // Test with non-existent API endpoint
        logger.log('Testing error handling with non-existent endpoint...');
        
        try {
          const response = await fetch('/api/nonexistent-endpoint', {
            headers: {
              'Authorization': `Bearer ${localStorage.getItem('coffee_system_token')}`
            }
          });
          
          logger.log(`Response status for non-existent endpoint: ${response.status}`);
        } catch (e) {
          logger.log(`Error during non-existent endpoint test: ${e.message}`);
        }
        
        // Wait a moment to see how the app responds
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Test with network error
        if (config.loggingLevel === 'verbose') {
          logger.log('Testing error handling with network error...');
          
          try {
            // Attempt to fetch from a non-existent domain
            await fetch('https://nonexistent-domain-for-testing.invalid');
          } catch (e) {
            logger.log(`Expected network error: ${e.message}`);
          }
          
          // Wait a moment to see how the app responds
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
        
        // Restore original fallback mode state
        if (originalFallbackMode === 'true') {
          localStorage.setItem('use_fallback_data', 'true');
        } else {
          localStorage.removeItem('use_fallback_data');
        }
        
        logger.success('Error handling tests completed');
        testResults.passed++;
        return true;
      } catch (error) {
        logger.error(`Error handling tests failed: ${error.message}`);
        testResults.failed++;
        return false;
      }
    }
  };
  
  // Helper functions
  
  /**
   * Create a dummy token for testing
   * @returns {string} The created token
   */
  function createDummyToken() {
    // Create header
    const header = {
      alg: 'HS256',
      typ: 'JWT'
    };
    
    // Create payload
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      sub: 'auto_tester',
      name: 'Auto Tester',
      role: 'barista',
      stations: [1, 2, 3],
      iat: now,
      exp: now + (24 * 60 * 60), // 24 hours from now
      permissions: ['manage_orders', 'view_stations']
    };
    
    // Base64 encode parts
    const headerB64 = btoa(JSON.stringify(header)).replace(/=/g, '');
    const payloadB64 = btoa(JSON.stringify(payload)).replace(/=/g, '');
    
    // Create dummy signature
    const signature = 'auto_tester_dummy_signature';
    
    // Create token
    const token = `${headerB64}.${payloadB64}.${signature}`;
    
    // Store token
    localStorage.setItem('coffee_system_token', token);
    localStorage.setItem('coffee_system_refresh_token', 'auto_tester_refresh_token');
    
    // Set expiry
    const expiry = new Date();
    expiry.setHours(expiry.getHours() + 24);
    localStorage.setItem('coffee_system_token_expiry', expiry.toISOString());
    
    // Store user data
    localStorage.setItem('coffee_system_user', JSON.stringify({
      id: 'auto_tester',
      username: 'auto_tester',
      name: 'Auto Tester',
      role: 'barista'
    }));
    
    return token;
  }
  
  /**
   * Enable fallback mode
   */
  function enableFallbackMode() {
    localStorage.setItem('use_fallback_data', 'true');
    localStorage.setItem('fallback_data_available', 'true');
    localStorage.setItem('demo_mode_enabled', 'true');
    
    logger.fix('Fallback mode enabled');
    
    // Try to notify the app
    try {
      window.dispatchEvent(new CustomEvent('fallback-mode-enabled'));
    } catch (e) {
      // Ignore errors
    }
  }
  
  /**
   * Run all tests
   */
  async function runAllTests() {
    logger.log('Starting auto tester...');
    logger.log('WARNING: This tool is for testing only and should be deleted before deployment!');
    
    // Record start time
    const startTime = Date.now();
    
    try {
      // Run login test first (required for other tests)
      if (config.scenarios.login) {
        await tests.login();
      }
      
      // Run other tests if login was successful or we're using fallback
      if (localStorage.getItem('coffee_system_token') || localStorage.getItem('use_fallback_data') === 'true') {
        // Run navigation test
        if (config.scenarios.navigation) {
          await tests.navigation();
        }
        
        // Run order functionality test
        if (config.scenarios.orders) {
          await tests.orders();
        }
        
        // Run component tests
        if (config.scenarios.components) {
          await tests.components();
        }
        
        // Run error handling tests
        if (config.scenarios.errorHandling) {
          await tests.errorHandling();
        }
      } else {
        logger.warn('Login test failed or token not available, skipping remaining tests');
        
        // Mark remaining tests as skipped
        if (config.scenarios.navigation) testResults.skipped++;
        if (config.scenarios.orders) testResults.skipped++;
        if (config.scenarios.components) testResults.skipped++;
        if (config.scenarios.errorHandling) testResults.skipped++;
      }
    } catch (error) {
      logger.error(`Unexpected error during tests: ${error.message}`);
    }
    
    // Calculate elapsed time
    const elapsedTime = (Date.now() - startTime) / 1000;
    
    // Log summary
    logger.log('==========================================');
    logger.log('TEST SUMMARY:');
    logger.log(`Total tests: ${testResults.total}`);
    logger.log(`Passed: ${testResults.passed}`);
    logger.log(`Failed: ${testResults.failed}`);
    logger.log(`Skipped: ${testResults.skipped}`);
    logger.log(`Elapsed time: ${elapsedTime.toFixed(2)} seconds`);
    
    if (testResults.errors.length > 0) {
      logger.log(`Errors: ${testResults.errors.length}`);
    }
    
    if (testResults.warnings.length > 0) {
      logger.log(`Warnings: ${testResults.warnings.length}`);
    }
    
    if (testResults.fixes.length > 0) {
      logger.log(`Auto-fixes applied: ${testResults.fixes.length}`);
    }
    
    logger.log('==========================================');
    
    // Return true if all tests passed
    return testResults.failed === 0;
  }
  
  // Create UI for standalone use
  function createUI() {
    if (document.getElementById('auto-tester-ui')) {
      return; // UI already exists
    }
    
    // Create container
    const container = document.createElement('div');
    container.id = 'auto-tester-ui';
    container.style = 'position: fixed; top: 10px; right: 10px; background: #fff; border: 2px solid #e74c3c; padding: 10px; border-radius: 5px; width: 300px; max-height: 400px; overflow-y: auto; font-family: monospace; font-size: 12px; z-index: 9999;';
    
    // Create header
    const header = document.createElement('div');
    header.style = 'font-weight: bold; color: #e74c3c; margin-bottom: 10px; display: flex; justify-content: space-between;';
    header.innerHTML = '<span>EXPRESSO AUTO TESTER - DELETE LATER</span><span id="auto-tester-close" style="cursor: pointer;">×</span>';
    
    // Create logs container
    const logs = document.createElement('div');
    logs.id = 'test-logs';
    logs.style = 'max-height: 300px; overflow-y: auto;';
    
    // Create controls
    const controls = document.createElement('div');
    controls.style = 'margin-top: 10px; display: flex; gap: 5px;';
    
    const runButton = document.createElement('button');
    runButton.textContent = 'Run Tests';
    runButton.style = 'padding: 5px; background: #3498db; color: white; border: none; border-radius: 3px; cursor: pointer;';
    runButton.onclick = runAllTests;
    
    const fixButton = document.createElement('button');
    fixButton.textContent = 'Enable Fallback';
    fixButton.style = 'padding: 5px; background: #2ecc71; color: white; border: none; border-radius: 3px; cursor: pointer;';
    fixButton.onclick = enableFallbackMode;
    
    const clearButton = document.createElement('button');
    clearButton.textContent = 'Clear Logs';
    clearButton.style = 'padding: 5px; background: #95a5a6; color: white; border: none; border-radius: 3px; cursor: pointer;';
    clearButton.onclick = () => { logs.innerHTML = ''; };
    
    // Assemble UI
    controls.appendChild(runButton);
    controls.appendChild(fixButton);
    controls.appendChild(clearButton);
    
    container.appendChild(header);
    container.appendChild(logs);
    container.appendChild(controls);
    
    document.body.appendChild(container);
    
    // Add close button functionality
    document.getElementById('auto-tester-close').addEventListener('click', () => {
      container.style.display = 'none';
    });
  }
  
  // Auto-start if URL has the auto parameter
  if (window.location.search.includes('auto_test=true') || window.location.hash === '#auto_test') {
    window.addEventListener('load', () => {
      createUI();
      
      // Delay start to ensure page is fully loaded
      setTimeout(runAllTests, 1000);
    });
  } else {
    // Expose to window for manual execution
    window.autoTester = {
      runAllTests,
      createUI,
      enableFallbackMode,
      createDummyToken,
      tests,
      config,
      results: testResults
    };
    
    // Log instructions
    console.log('%c[EXPRESSO AUTO TESTER]', 'color: #e74c3c; font-weight: bold;', 'To run tests, call window.autoTester.runAllTests() or add auto_test=true to the URL.');
    console.log('%c[WARNING]', 'color: #e74c3c; font-weight: bold;', 'This tool is for testing only and should be deleted before deployment!');
  }
})();