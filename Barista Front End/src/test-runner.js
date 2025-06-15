/**
 * Test Runner for Coffee Cue
 * Executes automated UI tests using Puppeteer
 */

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs').promises;

class TestRunner {
  constructor(config) {
    this.config = config;
    this.browser = null;
    this.page = null;
    this.testSuites = [
      'authentication',
      'navigation',
      'orderManagement',
      'stockManagement',
      'settings',
      'walkInOrders',
      'messaging',
      'display'
    ];
  }

  async setup() {
    // Launch browser with proper configuration to avoid socket issues
    this.browser = await puppeteer.launch({
      headless: this.config.headless,
      slowMo: this.config.slowMo,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu'
      ],
      // Prevent socket issues
      pipe: true,
      dumpio: false
    });

    this.page = await this.browser.newPage();
    
    // Set viewport
    await this.page.setViewport({ width: 1280, height: 800 });
    
    // Set default navigation timeout
    await this.page.setDefaultNavigationTimeout(this.config.timeout);
    await this.page.setDefaultTimeout(this.config.timeout);
    
    // Add console log capture
    this.page.on('console', msg => {
      if (msg.type() === 'error') {
        console.log('Browser console error:', msg.text());
      }
    });
    
    // Add error handling
    this.page.on('pageerror', error => {
      console.log('Page error:', error.message);
    });
  }

  async teardown() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
    }
  }

  async runAll() {
    const results = {
      total: 0,
      passed: 0,
      failed: 0,
      failures: [],
      allPassed: false,
      timestamp: new Date().toISOString()
    };

    try {
      await this.setup();

      for (const suite of this.testSuites) {
        const suiteResults = await this.runSuite(suite);
        results.total += suiteResults.total;
        results.passed += suiteResults.passed;
        results.failed += suiteResults.failed;
        results.failures.push(...suiteResults.failures);
      }

      results.allPassed = results.failed === 0;

    } catch (error) {
      results.failures.push({
        testName: 'Test Setup',
        error: error.message,
        stack: error.stack
      });
      results.failed++;
      results.total++;
    } finally {
      await this.teardown();
    }

    return results;
  }

  async runSuite(suiteName) {
    const results = {
      suite: suiteName,
      total: 0,
      passed: 0,
      failed: 0,
      failures: []
    };

    try {
      switch (suiteName) {
        case 'authentication':
          return await this.testAuthentication();
        case 'navigation':
          return await this.testNavigation();
        case 'orderManagement':
          return await this.testOrderManagement();
        case 'stockManagement':
          return await this.testStockManagement();
        case 'settings':
          return await this.testSettings();
        case 'walkInOrders':
          return await this.testWalkInOrders();
        case 'messaging':
          return await this.testMessaging();
        case 'display':
          return await this.testDisplay();
        default:
          throw new Error(`Unknown test suite: ${suiteName}`);
      }
    } catch (error) {
      results.failures.push({
        testName: `${suiteName} Suite`,
        error: error.message,
        stack: error.stack
      });
      results.failed++;
      results.total++;
    }

    return results;
  }

  async testAuthentication() {
    const results = this.createSuiteResults('authentication');
    
    // Test 1: Login page loads
    await this.runTest(results, 'Login page loads', async () => {
      await this.page.goto(`${this.config.baseUrl}/login`);
      await this.page.waitForSelector('input[type="text"]', { timeout: 5000 });
      await this.page.waitForSelector('input[type="password"]', { timeout: 5000 });
    });

    // Test 2: Login with valid credentials
    await this.runTest(results, 'Login with valid credentials', async () => {
      await this.page.goto(`${this.config.baseUrl}/login`);
      await this.page.waitForSelector('input[type="text"]');
      
      // Clear and type username
      await this.page.click('input[type="text"]', { clickCount: 3 });
      await this.page.type('input[type="text"]', 'barista');
      
      // Clear and type password
      await this.page.click('input[type="password"]', { clickCount: 3 });
      await this.page.type('input[type="password"]', 'barista123');
      
      // Click login button
      await this.page.click('button[type="submit"]');
      
      // Wait for navigation or success indicator
      await this.page.waitForFunction(
        () => window.location.pathname !== '/login',
        { timeout: 10000 }
      );
    });

    // Test 3: Logout functionality
    await this.runTest(results, 'Logout functionality', async () => {
      // Ensure we're logged in
      const token = await this.page.evaluate(() => localStorage.getItem('token'));
      if (!token) {
        throw new Error('Not logged in');
      }
      
      // Look for logout button
      const logoutButton = await this.page.$('button:has-text("Logout"), button:has-text("Sign Out")');
      if (logoutButton) {
        await logoutButton.click();
        await this.page.waitForFunction(
          () => window.location.pathname === '/login',
          { timeout: 5000 }
        );
      }
    });

    return results;
  }

  async testNavigation() {
    const results = this.createSuiteResults('navigation');
    
    // Ensure we're logged in first
    await this.ensureLoggedIn();

    // Test 1: Navigate to Orders tab
    await this.runTest(results, 'Navigate to Orders tab', async () => {
      await this.clickTab('Orders');
      await this.page.waitForSelector('[data-testid="orders-tab"], .orders-section', { timeout: 5000 });
    });

    // Test 2: Navigate to Stock tab
    await this.runTest(results, 'Navigate to Stock tab', async () => {
      await this.clickTab('Stock');
      await this.page.waitForSelector('[data-testid="stock-tab"], .stock-section', { timeout: 5000 });
    });

    // Test 3: Navigate to Settings tab
    await this.runTest(results, 'Navigate to Settings tab', async () => {
      await this.clickTab('Settings');
      await this.page.waitForSelector('[data-testid="settings-tab"], .settings-section', { timeout: 5000 });
    });

    return results;
  }

  async testOrderManagement() {
    const results = this.createSuiteResults('orderManagement');
    
    await this.ensureLoggedIn();
    await this.clickTab('Orders');

    // Test 1: View pending orders
    await this.runTest(results, 'View pending orders', async () => {
      await this.page.waitForSelector('.pending-orders, [data-testid="pending-orders"]', { timeout: 5000 });
    });

    // Test 2: Claim an order
    await this.runTest(results, 'Claim an order', async () => {
      const claimButton = await this.page.$('button:has-text("Claim"), button:has-text("Start")');
      if (claimButton) {
        await claimButton.click();
        await this.page.waitForTimeout(1000);
        // Verify order moved to in-progress
        await this.page.waitForSelector('.in-progress-order, [data-testid="in-progress-order"]', { timeout: 5000 });
      } else {
        // No orders to claim - create a walk-in order first
        await this.createWalkInOrder();
        const newClaimButton = await this.page.$('button:has-text("Claim"), button:has-text("Start")');
        if (newClaimButton) {
          await newClaimButton.click();
        }
      }
    });

    // Test 3: Complete an order
    await this.runTest(results, 'Complete an order', async () => {
      const completeButton = await this.page.$('button:has-text("Complete"), button:has-text("Ready")');
      if (completeButton) {
        await completeButton.click();
        await this.page.waitForTimeout(1000);
      }
    });

    return results;
  }

  async testStockManagement() {
    const results = this.createSuiteResults('stockManagement');
    
    await this.ensureLoggedIn();
    await this.clickTab('Stock');

    // Test 1: View stock levels
    await this.runTest(results, 'View stock levels', async () => {
      await this.page.waitForSelector('.stock-item, [data-testid="stock-item"]', { timeout: 5000 });
    });

    // Test 2: Update stock level
    await this.runTest(results, 'Update stock level', async () => {
      const stockInput = await this.page.$('input[type="number"]');
      if (stockInput) {
        await stockInput.click({ clickCount: 3 });
        await stockInput.type('100');
        
        // Look for save/update button
        const saveButton = await this.page.$('button:has-text("Save"), button:has-text("Update")');
        if (saveButton) {
          await saveButton.click();
          await this.page.waitForTimeout(1000);
        }
      }
    });

    return results;
  }

  async testSettings() {
    const results = this.createSuiteResults('settings');
    
    await this.ensureLoggedIn();
    await this.clickTab('Settings');

    // Test 1: View settings
    await this.runTest(results, 'View settings', async () => {
      await this.page.waitForSelector('.settings-content, [data-testid="settings"]', { timeout: 5000 });
    });

    // Test 2: Toggle demo mode
    await this.runTest(results, 'Toggle demo mode', async () => {
      const demoToggle = await this.page.$('input[type="checkbox"][id*="demo"], label:has-text("Demo Mode")');
      if (demoToggle) {
        await demoToggle.click();
        await this.page.waitForTimeout(500);
      }
    });

    return results;
  }

  async testWalkInOrders() {
    const results = this.createSuiteResults('walkInOrders');
    
    await this.ensureLoggedIn();
    await this.clickTab('Orders');

    // Test 1: Open walk-in order dialog
    await this.runTest(results, 'Open walk-in order dialog', async () => {
      const walkInButton = await this.page.$('button:has-text("Walk-in"), button:has-text("New Order")');
      if (walkInButton) {
        await walkInButton.click();
        await this.page.waitForSelector('.modal, [role="dialog"], .walk-in-dialog', { timeout: 5000 });
      }
    });

    // Test 2: Create walk-in order
    await this.runTest(results, 'Create walk-in order', async () => {
      await this.createWalkInOrder();
    });

    return results;
  }

  async testMessaging() {
    const results = this.createSuiteResults('messaging');
    
    await this.ensureLoggedIn();

    // Test 1: View message history
    await this.runTest(results, 'View message history', async () => {
      const messageIcon = await this.page.$('[data-testid="messages"], button:has-text("Messages")');
      if (messageIcon) {
        await messageIcon.click();
        await this.page.waitForSelector('.message-history, [data-testid="message-list"]', { timeout: 5000 });
      }
    });

    return results;
  }

  async testDisplay() {
    const results = this.createSuiteResults('display');
    
    await this.ensureLoggedIn();
    await this.clickTab('Display');

    // Test 1: View display screen
    await this.runTest(results, 'View display screen', async () => {
      await this.page.waitForSelector('.display-screen, [data-testid="display"]', { timeout: 5000 });
    });

    return results;
  }

  // Helper methods
  async ensureLoggedIn() {
    const token = await this.page.evaluate(() => localStorage.getItem('token'));
    if (!token || this.page.url().includes('/login')) {
      await this.login();
    }
  }

  async login() {
    await this.page.goto(`${this.config.baseUrl}/login`);
    await this.page.waitForSelector('input[type="text"]');
    
    await this.page.click('input[type="text"]', { clickCount: 3 });
    await this.page.type('input[type="text"]', 'barista');
    
    await this.page.click('input[type="password"]', { clickCount: 3 });
    await this.page.type('input[type="password"]', 'barista123');
    
    await this.page.click('button[type="submit"]');
    
    await this.page.waitForFunction(
      () => window.location.pathname !== '/login',
      { timeout: 10000 }
    );
  }

  async clickTab(tabName) {
    // Try multiple selectors
    const selectors = [
      `button:has-text("${tabName}")`,
      `a:has-text("${tabName}")`,
      `[role="tab"]:has-text("${tabName}")`,
      `.tab:has-text("${tabName}")`
    ];

    for (const selector of selectors) {
      const element = await this.page.$(selector);
      if (element) {
        await element.click();
        await this.page.waitForTimeout(500);
        return;
      }
    }

    throw new Error(`Could not find tab: ${tabName}`);
  }

  async createWalkInOrder() {
    const walkInButton = await this.page.$('button:has-text("Walk-in"), button:has-text("New Order")');
    if (walkInButton) {
      await walkInButton.click();
      await this.page.waitForSelector('.modal, [role="dialog"]', { timeout: 5000 });
      
      // Fill in order details
      const nameInput = await this.page.$('input[placeholder*="name"], input[name="customerName"]');
      if (nameInput) {
        await nameInput.type('Test Customer');
      }
      
      // Select coffee type
      const coffeeSelect = await this.page.$('select[name="coffeeType"], input[name="coffeeType"]');
      if (coffeeSelect) {
        await coffeeSelect.select('latte');
      }
      
      // Submit order
      const submitButton = await this.page.$('button:has-text("Create"), button:has-text("Submit")');
      if (submitButton) {
        await submitButton.click();
        await this.page.waitForTimeout(1000);
      }
    }
  }

  async runTest(results, testName, testFn) {
    results.total++;
    try {
      await testFn();
      results.passed++;
      console.log(`  ✅ ${testName}`);
    } catch (error) {
      results.failed++;
      results.failures.push({
        testName,
        error: error.message,
        stack: error.stack,
        screenshot: await this.takeScreenshot(testName)
      });
      console.log(`  ❌ ${testName}: ${error.message}`);
    }
  }

  async takeScreenshot(testName) {
    try {
      const filename = `${testName.replace(/\s+/g, '-')}-${Date.now()}.png`;
      const filepath = path.join(this.config.screenshotsDir, filename);
      await this.page.screenshot({ path: filepath, fullPage: true });
      return filepath;
    } catch (error) {
      console.error('Failed to take screenshot:', error);
      return null;
    }
  }

  createSuiteResults(suiteName) {
    return {
      suite: suiteName,
      total: 0,
      passed: 0,
      failed: 0,
      failures: []
    };
  }
}

module.exports = { TestRunner };