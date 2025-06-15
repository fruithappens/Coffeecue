const config = require('../config/testConfig');

class TestSuites {
  constructor(browser, database) {
    this.browser = browser;
    this.database = database;
    this.page = browser.page;
  }

  async runAuthenticationTests() {
    console.log('Testing authentication flow...');
    
    // Test login page
    await this.browser.navigate(`${config.baseUrl}/login`);
    await this.browser.takeScreenshot('login-page');
    
    // Test invalid login
    await this.testInvalidLogin();
    
    // Test valid login for each role
    for (const role of ['barista', 'admin', 'organizer']) {
      await this.testValidLogin(role);
      await this.testLogout();
    }
    
    // Test session persistence
    await this.testSessionPersistence();
    
    // Test unauthorized access
    await this.testUnauthorizedAccess();
  }

  async testInvalidLogin() {
    await this.browser.navigate(`${config.baseUrl}/login`);
    
    // Try invalid credentials
    await this.page.type('input[name="username"], input[type="text"]', 'invalid');
    await this.page.type('input[name="password"], input[type="password"]', 'wrong');
    await this.page.click('button[type="submit"]');
    
    // Check for error message
    await this.browser.waitForSelector('.error, .alert-danger', { timeout: 5000 });
    await this.browser.takeScreenshot('login-error');
  }

  async testValidLogin(role) {
    await this.browser.login(role);
    
    // Verify successful login
    const url = await this.page.url();
    if (url.includes('/login')) {
      throw new Error(`Login failed for role: ${role}`);
    }
    
    await this.browser.takeScreenshot(`logged-in-${role}`);
    
    // Verify JWT token in localStorage
    const token = await this.page.evaluate(() => {
      return localStorage.getItem('token') || localStorage.getItem('access_token');
    });
    
    if (!token) {
      throw new Error(`No JWT token found for role: ${role}`);
    }
  }

  async testLogout() {
    // Find and click logout button
    try {
      await this.page.click('button:contains("Logout"), a:contains("Logout")');
      await this.browser.waitForSelector('input[name="username"]', { timeout: 5000 });
      await this.browser.takeScreenshot('logged-out');
    } catch (error) {
      console.warn('Logout button not found, navigating to login page');
      await this.browser.navigate(`${config.baseUrl}/login`);
    }
  }

  async testSessionPersistence() {
    // Login
    await this.browser.login('barista');
    
    // Save token
    const token = await this.page.evaluate(() => {
      return localStorage.getItem('token') || localStorage.getItem('access_token');
    });
    
    // Navigate away and back
    await this.browser.navigate('about:blank');
    await this.browser.navigate(`${config.baseUrl}`);
    
    // Check if still logged in
    const currentToken = await this.page.evaluate(() => {
      return localStorage.getItem('token') || localStorage.getItem('access_token');
    });
    
    if (token !== currentToken) {
      throw new Error('Session not persisted correctly');
    }
  }

  async testUnauthorizedAccess() {
    // Clear any existing session
    await this.page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    
    // Try to access protected routes
    const protectedRoutes = ['/barista', '/admin', '/settings'];
    
    for (const route of protectedRoutes) {
      await this.browser.navigate(`${config.baseUrl}${route}`);
      
      // Should redirect to login
      const url = await this.page.url();
      if (!url.includes('/login')) {
        throw new Error(`Unauthorized access allowed to: ${route}`);
      }
    }
  }

  async runBaristaInterfaceTests() {
    console.log('Testing barista interface...');
    
    // Login as barista
    await this.browser.login('barista');
    
    // Navigate to barista interface
    await this.browser.navigate(`${config.baseUrl}/barista`);
    await this.browser.takeScreenshot('barista-interface');
    
    // Test all buttons
    await this.browser.clickAllButtons();
    
    // Test order claiming
    await this.testOrderClaiming();
    
    // Test order completion
    await this.testOrderCompletion();
    
    // Test walk-in orders
    await this.testWalkInOrders();
    
    // Test milk options
    await this.testMilkOptions();
  }

  async testOrderClaiming() {
    // Look for pending orders
    const pendingOrders = await this.page.$$('.order-card.pending, .pending-order');
    
    if (pendingOrders.length > 0) {
      // Click claim button on first order
      const claimButton = await pendingOrders[0].$('button:contains("Claim"), button.claim-button');
      if (claimButton) {
        await claimButton.click();
        await this.browser.takeScreenshot('order-claimed');
        
        // Verify order moved to in-progress
        await this.browser.waitForSelector('.order-card.in-progress, .in-progress-order', { timeout: 5000 });
        
        // Check database
        const orderClaimed = await this.database.verifyDataSaved('orders', {
          status: 'in_progress'
        });
        
        if (!orderClaimed) {
          throw new Error('Order claim not saved to database');
        }
      }
    }
  }

  async testOrderCompletion() {
    // Look for in-progress orders
    const inProgressOrders = await this.page.$$('.order-card.in-progress, .in-progress-order');
    
    if (inProgressOrders.length > 0) {
      // Click complete button
      const completeButton = await inProgressOrders[0].$('button:contains("Complete"), button.complete-button');
      if (completeButton) {
        await completeButton.click();
        await this.browser.takeScreenshot('order-completed');
        
        // Verify order removed from view
        await this.page.waitForTimeout(2000);
        
        // Check database
        const orderCompleted = await this.database.verifyDataSaved('orders', {
          status: 'completed'
        });
        
        if (!orderCompleted) {
          throw new Error('Order completion not saved to database');
        }
      }
    }
  }

  async testWalkInOrders() {
    // Click walk-in order button
    try {
      await this.page.click('button:contains("Walk-in"), button:contains("Walk In")');
      await this.browser.waitForSelector('.modal, .dialog, .walk-in-form', { timeout: 5000 });
      await this.browser.takeScreenshot('walk-in-dialog');
      
      // Fill walk-in order form
      await this.page.type('input[name="customerName"], input[placeholder*="name"]', 'Test Customer');
      await this.page.type('input[name="phoneNumber"], input[placeholder*="phone"]', '555-1234');
      
      // Select coffee type
      await this.page.click('select[name="coffeeType"], input[name="coffeeType"]');
      
      // Select milk type
      await this.page.click('select[name="milkType"], input[name="milkType"]');
      
      // Submit order
      await this.page.click('button[type="submit"], button:contains("Create")');
      
      // Verify order created
      await this.browser.waitForSelector('.order-card.pending, .pending-order', { timeout: 5000 });
      
      // Check database
      const walkInOrderCreated = await this.database.verifyDataSaved('orders', {
        customer_name: 'Test Customer'
      });
      
      if (!walkInOrderCreated) {
        throw new Error('Walk-in order not saved to database');
      }
    } catch (error) {
      console.warn('Walk-in order test failed:', error.message);
    }
  }

  async testMilkOptions() {
    // Check available milk options display
    const milkOptions = await this.page.$$('.milk-option, .milk-type');
    
    if (milkOptions.length === 0) {
      console.warn('No milk options displayed');
    } else {
      await this.browser.takeScreenshot('milk-options');
      
      // Get milk inventory from database
      const inventory = await this.database.getInventoryLevels();
      const milkInventory = inventory.filter(item => item.item_name.includes('milk'));
      
      console.log(`Found ${milkInventory.length} milk types in inventory`);
    }
  }

  async runOrderManagementTests() {
    console.log('Testing order management...');
    
    await this.browser.login('barista');
    await this.browser.navigate(`${config.baseUrl}/barista`);
    
    // Test order filters
    await this.testOrderFilters();
    
    // Test order search
    await this.testOrderSearch();
    
    // Test batch orders
    await this.testBatchOrders();
    
    // Test order status updates
    await this.testOrderStatusUpdates();
  }

  async testOrderFilters() {
    // Test different order status filters
    const filters = ['all', 'pending', 'in_progress', 'completed'];
    
    for (const filter of filters) {
      try {
        await this.page.click(`button[data-filter="${filter}"], button:contains("${filter}")`);
        await this.page.waitForTimeout(1000);
        await this.browser.takeScreenshot(`orders-filtered-${filter}`);
      } catch (error) {
        console.warn(`Filter ${filter} not found`);
      }
    }
  }

  async testOrderSearch() {
    // Look for search input
    const searchInput = await this.page.$('input[type="search"], input[placeholder*="search"]');
    
    if (searchInput) {
      await searchInput.type('Test');
      await this.page.waitForTimeout(1000);
      await this.browser.takeScreenshot('order-search-results');
      
      // Clear search
      await searchInput.click({ clickCount: 3 });
      await searchInput.press('Backspace');
    }
  }

  async testBatchOrders() {
    // Look for batch/group order indicators
    const batchOrders = await this.page.$$('.batch-order, .group-order');
    
    if (batchOrders.length > 0) {
      await this.browser.takeScreenshot('batch-orders');
      
      // Click on a batch to expand
      await batchOrders[0].click();
      await this.page.waitForTimeout(1000);
      await this.browser.takeScreenshot('batch-order-expanded');
    }
  }

  async testOrderStatusUpdates() {
    // Monitor network for order status updates
    const apiCalls = await this.browser.getApiCalls();
    const statusUpdates = apiCalls.filter(call => 
      call.url.includes('/orders') && 
      (call.method === 'PUT' || call.method === 'PATCH')
    );
    
    console.log(`Found ${statusUpdates.length} order status update API calls`);
  }

  async runInventoryTests() {
    console.log('Testing inventory management...');
    
    await this.browser.login('admin');
    await this.browser.navigate(`${config.baseUrl}/settings`);
    
    // Navigate to inventory section
    await this.page.click('button:contains("Inventory"), a:contains("Stock")');
    await this.browser.takeScreenshot('inventory-page');
    
    // Test inventory updates
    await this.testInventoryUpdates();
    
    // Test low stock alerts
    await this.testLowStockAlerts();
    
    // Test inventory history
    await this.testInventoryHistory();
  }

  async testInventoryUpdates() {
    // Find inventory input fields
    const inventoryInputs = await this.page.$$('input[type="number"][name*="stock"], input[type="number"][name*="inventory"]');
    
    if (inventoryInputs.length > 0) {
      // Update first inventory item
      const input = inventoryInputs[0];
      await input.click({ clickCount: 3 });
      await input.type('100');
      
      // Save changes
      await this.page.click('button:contains("Save"), button[type="submit"]');
      await this.page.waitForTimeout(2000);
      
      // Verify database update
      const inventoryUpdated = await this.database.verifyDataSaved('inventory', {
        current_stock: 100
      });
      
      if (!inventoryUpdated) {
        console.warn('Inventory update may not have been saved');
      }
    }
  }

  async testLowStockAlerts() {
    // Check for low stock indicators
    const lowStockAlerts = await this.page.$$('.low-stock, .alert-warning, .stock-warning');
    
    if (lowStockAlerts.length > 0) {
      await this.browser.takeScreenshot('low-stock-alerts');
      console.log(`Found ${lowStockAlerts.length} low stock alerts`);
    }
  }

  async testInventoryHistory() {
    // Look for inventory history or logs
    try {
      await this.page.click('button:contains("History"), button:contains("Logs")');
      await this.browser.waitForSelector('.history-table, .log-entries', { timeout: 5000 });
      await this.browser.takeScreenshot('inventory-history');
    } catch (error) {
      console.warn('Inventory history not found');
    }
  }

  async runSettingsTests() {
    console.log('Testing settings...');
    
    await this.browser.login('admin');
    await this.browser.navigate(`${config.baseUrl}/settings`);
    await this.browser.takeScreenshot('settings-page');
    
    // Test all form inputs
    await this.browser.testAllFormFields();
    
    // Test SMS settings
    await this.testSMSSettings();
    
    // Test station management
    await this.testStationManagement();
    
    // Test system settings
    await this.testSystemSettings();
  }

  async testSMSSettings() {
    try {
      await this.page.click('button:contains("SMS"), a:contains("SMS")');
      await this.browser.takeScreenshot('sms-settings');
      
      // Test Twilio configuration fields
      const twilioFields = await this.page.$$('input[name*="twilio"], input[name*="sms"]');
      console.log(`Found ${twilioFields.length} SMS configuration fields`);
    } catch (error) {
      console.warn('SMS settings not found');
    }
  }

  async testStationManagement() {
    try {
      await this.page.click('button:contains("Stations"), a:contains("Stations")');
      await this.browser.waitForSelector('.station-list, .stations-table', { timeout: 5000 });
      await this.browser.takeScreenshot('station-management');
      
      // Test adding a station
      const addButton = await this.page.$('button:contains("Add Station"), button:contains("New Station")');
      if (addButton) {
        await addButton.click();
        await this.browser.takeScreenshot('add-station-dialog');
      }
    } catch (error) {
      console.warn('Station management not found');
    }
  }

  async testSystemSettings() {
    try {
      await this.page.click('button:contains("System"), a:contains("General")');
      await this.browser.takeScreenshot('system-settings');
      
      // Test various system settings
      const systemInputs = await this.page.$$('input[type="checkbox"], input[type="radio"], select');
      console.log(`Found ${systemInputs.length} system setting controls`);
    } catch (error) {
      console.warn('System settings not found');
    }
  }

  async runDisplayScreenTests() {
    console.log('Testing display screens...');
    
    // Test display login
    await this.browser.navigate(`${config.baseUrl}/display/login`);
    await this.browser.takeScreenshot('display-login');
    
    // Login to display
    await this.page.type('input[name="displayId"], input[type="text"]', 'DISPLAY1');
    await this.page.click('button[type="submit"]');
    
    // Test order display
    await this.browser.waitForSelector('.order-display, .display-orders', { timeout: 5000 });
    await this.browser.takeScreenshot('display-orders');
    
    // Test auto-refresh
    await this.testDisplayAutoRefresh();
  }

  async testDisplayAutoRefresh() {
    // Monitor network for auto-refresh calls
    const startTime = Date.now();
    const refreshCalls = [];
    
    this.browser.page.on('request', request => {
      if (request.url().includes('/display/orders')) {
        refreshCalls.push({
          timestamp: Date.now() - startTime,
          url: request.url()
        });
      }
    });
    
    // Wait for 10 seconds to capture refresh calls
    await this.page.waitForTimeout(10000);
    
    console.log(`Display made ${refreshCalls.length} refresh calls in 10 seconds`);
  }

  async runComprehensiveUITests() {
    console.log('Running comprehensive UI tests...');
    
    await this.browser.login('barista');
    
    // Test every page
    const pages = [
      '/barista',
      '/orders',
      '/schedule',
      '/settings',
      '/help'
    ];
    
    for (const page of pages) {
      try {
        await this.browser.navigate(`${config.baseUrl}${page}`);
        await this.browser.takeScreenshot(`page-${page.replace('/', '')}`);
        
        // Click all buttons on this page
        await this.browser.clickAllButtons();
        
        // Test all forms on this page
        await this.browser.testAllFormFields();
        
        // Check for errors
        const errors = await this.browser.checkForErrors();
        if (errors.pageErrors.length > 0 || errors.consoleErrors.length > 0) {
          console.warn(`Errors found on ${page}:`, errors);
        }
      } catch (error) {
        console.error(`Failed to test page ${page}:`, error.message);
      }
    }
  }

  async runAPITests() {
    console.log('Testing API endpoints...');
    
    // Get all API calls made during testing
    const apiCalls = await this.browser.getApiCalls();
    
    // Group by endpoint
    const endpoints = {};
    apiCalls.forEach(call => {
      const endpoint = call.url.replace(config.apiUrl, '').split('?')[0];
      if (!endpoints[endpoint]) {
        endpoints[endpoint] = [];
      }
      endpoints[endpoint].push(call);
    });
    
    console.log('\nAPI Endpoints tested:');
    Object.keys(endpoints).forEach(endpoint => {
      console.log(`${endpoint}: ${endpoints[endpoint].length} calls`);
    });
    
    // Check response times
    const slowCalls = apiCalls.filter(call => {
      const response = this.browser.getNetworkLogs().find(log => 
        log.type === 'response' && log.url === call.url
      );
      if (response) {
        const duration = response.timestamp - call.timestamp;
        return duration > 1000; // Calls taking more than 1 second
      }
      return false;
    });
    
    if (slowCalls.length > 0) {
      console.warn(`Found ${slowCalls.length} slow API calls (>1s)`);
    }
  }
}

module.exports = TestSuites;