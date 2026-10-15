const CoffeeCueUITester = require('./browser-automation');
const { spawn } = require('child_process');
const express = require('express');
const http = require('http');

class TestOrchestrator {
  constructor() {
    this.tester = new CoffeeCueUITester();
    this.backendProcess = null;
    this.frontendProcess = null;
    this.monitorServer = null;
  }

  async startFullTest() {
    console.log('🚀 Starting Coffee Cue Complete Test Suite\n');

    // 1. Start monitoring dashboard
    await this.startMonitoringDashboard();
    
    // 2. Start backend with monitoring
    await this.startBackendWithMonitoring();
    
    // 3. Wait for backend to be ready
    await this.waitForBackend();
    
    // 4. Start frontend
    await this.startFrontend();
    
    // 5. Wait for frontend to be ready
    await this.waitForFrontend();
    
    // 6. Initialize browser automation
    await this.tester.initialize();
    
    // 7. Run comprehensive tests
    await this.runComprehensiveTests();
    
    // 8. Generate report
    await this.tester.generateReport();
    
    console.log('\n✅ Testing complete! Check ./test-results/ for detailed reports');
  }

  async runComprehensiveTests() {
    const testSequence = [
      { name: 'Login Test', func: () => this.testLogin() },
      { name: 'Navigation Test', func: () => this.testNavigation() },
      { name: 'Button Click Test', func: () => this.tester.clickEveryButton() },
      { name: 'Form Field Test', func: () => this.tester.testEveryFormField() },
      { name: 'Database Verification', func: () => this.tester.verifyDatabaseConnections() },
      { name: 'Order Flow Test', func: () => this.testOrderFlow() },
      { name: 'Stock Management Test', func: () => this.testStockManagement() },
      { name: 'Settings Persistence Test', func: () => this.testSettingsPersistence() },
      { name: 'Error Handling Test', func: () => this.testErrorHandling() },
      { name: 'Performance Test', func: () => this.testPerformance() }
    ];

    for (const test of testSequence) {
      console.log(`\n🧪 Running: ${test.name}`);
      try {
        await test.func();
        console.log(`✅ ${test.name} completed`);
      } catch (error) {
        console.error(`❌ ${test.name} failed:`, error.message);
      }
    }
  }

  async testLogin() {
    await this.tester.page.goto('http://localhost:3000/login');
    
    // Test invalid login
    await this.tester.page.type('#username', 'invalid');
    await this.tester.page.type('#password', 'wrong');
    await this.tester.page.click('button[type="submit"]');
    await this.tester.page.waitForTimeout(1000);
    
    // Check for error message
    const errorVisible = await this.tester.page.$('.error-message');
    console.log('Invalid login error shown:', !!errorVisible);
    
    // Test valid login
    await this.tester.page.evaluate(() => {
      document.querySelector('#username').value = '';
      document.querySelector('#password').value = '';
    });
    
    await this.tester.page.type('#username', 'admin');
    await this.tester.page.type('#password', 'admin123');
    await this.tester.page.click('button[type="submit"]');
    
    // Wait for navigation
    await this.tester.page.waitForNavigation();
    console.log('Login successful, current URL:', this.tester.page.url());
  }

  async testNavigation() {
    // Click through all main navigation tabs
    const tabs = ['orders', 'stock', 'schedule', 'completed', 'display', 'settings'];
    
    for (const tab of tabs) {
      console.log(`Navigating to ${tab} tab...`);
      await this.tester.page.click(`button:contains("${tab.charAt(0).toUpperCase() + tab.slice(1)}")`);
      await this.tester.page.waitForTimeout(1000);
      
      // Take screenshot of each tab
      await this.tester.page.screenshot({
        path: `./test-results/screenshots/tab-${tab}.png`
      });
    }
  }

  async testOrderFlow() {
    // Complete end-to-end order flow
    console.log('Testing complete order flow...');
    
    // 1. Add walk-in order
    await this.tester.page.click('button:contains("Add Walk-in Order")');
    await this.tester.page.waitForTimeout(500);
    
    // Fill order details
    await this.tester.page.type('#customer-name', 'Test Customer');
    await this.tester.page.type('#phone-number', '+61412345678');
    await this.tester.page.select('#coffee-type', 'Latte');
    await this.tester.page.select('#milk-type', 'Oat');
    
    // Submit order
    await this.tester.page.click('button:contains("Add Order")');
    await this.tester.page.waitForTimeout(1000);
    
    // Start order processing
    const startButton = await this.tester.page.$('.pending-order button:contains("Start")');
    if (startButton) {
      await startButton.click();
      await this.tester.page.waitForTimeout(1000);
    }
    
    // Complete order
    const completeButton = await this.tester.page.$('button:contains("COMPLETE ORDER")');
    if (completeButton) {
      await completeButton.click();
      await this.tester.page.waitForTimeout(2000);
    }
  }

  async testStockManagement() {
    // Navigate to stock tab
    await this.tester.page.click('button:contains("Stock")');
    await this.tester.page.waitForTimeout(1000);
    
    // Test stock adjustment
    const decreaseButton = await this.tester.page.$('button:contains("-")');
    if (decreaseButton) {
      const stockBefore = await this.tester.page.$eval('.stock-amount', el => el.textContent);
      await decreaseButton.click();
      await this.tester.page.waitForTimeout(500);
      const stockAfter = await this.tester.page.$eval('.stock-amount', el => el.textContent);
      console.log(`Stock changed from ${stockBefore} to ${stockAfter}`);
    }
  }

  async testSettingsPersistence() {
    // Navigate to settings
    await this.tester.page.click('button:contains("Settings")');
    await this.tester.page.waitForTimeout(1000);
    
    // Change a setting
    const testValue = `Test Station ${Date.now()}`;
    await this.tester.page.evaluate((value) => {
      const input = document.querySelector('input[name="stationName"]');
      if (input) {
        input.value = '';
        input.value = value;
      }
    }, testValue);
    
    // Save settings
    await this.tester.page.click('button:contains("Save")');
    await this.tester.page.waitForTimeout(1000);
    
    // Reload page
    await this.tester.page.reload();
    await this.tester.page.waitForTimeout(1000);
    
    // Check if setting persisted
    const savedValue = await this.tester.page.$eval('input[name="stationName"]', el => el.value);
    console.log(`Setting persistence test: ${savedValue === testValue ? 'PASSED' : 'FAILED'}`);
  }

  async testErrorHandling() {
    // Test various error scenarios
    console.log('Testing error handling...');
    
    // 1. Test network failure
    await this.tester.page.setOfflineMode(true);
    await this.tester.page.click('button:contains("Refresh")');
    await this.tester.page.waitForTimeout(1000);
    
    const offlineIndicator = await this.tester.page.$('.offline-indicator');
    console.log('Offline indicator shown:', !!offlineIndicator);
    
    await this.tester.page.setOfflineMode(false);
  }

  async testPerformance() {
    console.log('Running performance tests...');
    
    // Measure page load time
    const startTime = Date.now();
    await this.tester.page.reload();
    await this.tester.page.waitForLoadState('networkidle');
    const loadTime = Date.now() - startTime;
    
    console.log(`Page load time: ${loadTime}ms`);
    
    // Check for memory leaks
    const metrics1 = await this.tester.page.metrics();
    
    // Perform heavy operations
    for (let i = 0; i < 10; i++) {
      await this.tester.page.click('button:contains("Refresh")');
      await this.tester.page.waitForTimeout(500);
    }
    
    const metrics2 = await this.tester.page.metrics();
    const memoryIncrease = metrics2.JSHeapUsedSize - metrics1.JSHeapUsedSize;
    console.log(`Memory increase after operations: ${(memoryIncrease / 1024 / 1024).toFixed(2)}MB`);
  }

  async startMonitoringDashboard() {
    const app = express();
    app.use(express.static('test-framework'));
    this.monitorServer = http.createServer(app);
    this.monitorServer.listen(8082);
    console.log('📊 Monitoring dashboard available at http://localhost:8082/monitor-dashboard.html');
  }

  async startBackendWithMonitoring() {
    console.log('Starting backend with monitoring...');
    this.backendProcess = spawn('python', [
      '-c',
      `
import sys
sys.path.insert(0, 'test-framework')
from backend_monitor import BackendMonitor
from app import app

monitor = BackendMonitor(app)
app.run(port=5001, debug=True)
      `
    ]);
  }

  async waitForBackend() {
    console.log('Waiting for backend to be ready...');
    // Implementation to check if backend is responding
  }

  async startFrontend() {
    console.log('Starting frontend...');
    this.frontendProcess = spawn('npm', ['start'], {
      cwd: './Barista Front End'
    });
  }

  async waitForFrontend() {
    console.log('Waiting for frontend to be ready...');
    // Implementation to check if frontend is responding
  }
}

// Run the orchestrator
if (require.main === module) {
  const orchestrator = new TestOrchestrator();
  orchestrator.startFullTest().catch(console.error);
}

module.exports = TestOrchestrator;