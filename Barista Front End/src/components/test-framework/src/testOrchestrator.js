const BrowserAutomation = require('./browserAutomation');
const DatabaseMonitor = require('./databaseMonitor');
const MonitoringDashboard = require('./monitoringDashboard');
const TestSuites = require('./testSuites');
const ReportGenerator = require('./reportGenerator');
const config = require('../config/testConfig');

class TestOrchestrator {
  constructor() {
    this.browser = new BrowserAutomation();
    this.database = new DatabaseMonitor();
    this.dashboard = new MonitoringDashboard();
    this.reportGenerator = new ReportGenerator();
    this.testSuites = new TestSuites(this.browser, this.database);
    
    this.testResults = {
      startTime: null,
      endTime: null,
      totalTests: 0,
      passedTests: 0,
      failedTests: 0,
      errors: [],
      suites: {}
    };
  }

  async initialize() {
    console.log('Initializing test framework...');
    
    // Start monitoring dashboard
    this.dashboard.start();
    
    // Connect browser automation to dashboard
    this.browser.on('console-log', (log) => {
      this.dashboard.updateTestData('console-log', log);
    });
    
    this.browser.on('network-request', (log) => {
      this.dashboard.updateTestData('network-log', log);
    });
    
    this.browser.on('network-response', (log) => {
      this.dashboard.updateTestData('network-log', log);
    });
    
    this.browser.on('page-error', (error) => {
      this.dashboard.updateTestData('error', error);
    });
    
    this.browser.on('button-clicked', (data) => {
      this.dashboard.updateTestData('button-clicked', data);
    });
    
    this.browser.on('form-input-tested', (data) => {
      this.dashboard.updateTestData('input-tested', data);
    });
    
    // Connect database monitor to dashboard
    this.database.on('query', (query) => {
      this.dashboard.updateTestData('database-query', query);
    });
    
    // Launch browser and start database monitoring
    await this.browser.launch();
    await this.database.start();
    
    console.log('Test framework initialized');
  }

  async runAllTests() {
    this.testResults.startTime = new Date();
    this.dashboard.reset();
    
    console.log('Starting comprehensive test suite...');
    
    try {
      // Run authentication tests
      await this.runTestSuite('Authentication', async () => {
        await this.testSuites.runAuthenticationTests();
      });
      
      // Run barista interface tests
      await this.runTestSuite('Barista Interface', async () => {
        await this.testSuites.runBaristaInterfaceTests();
      });
      
      // Run order management tests
      await this.runTestSuite('Order Management', async () => {
        await this.testSuites.runOrderManagementTests();
      });
      
      // Run inventory tests
      await this.runTestSuite('Inventory Management', async () => {
        await this.testSuites.runInventoryTests();
      });
      
      // Run settings tests
      await this.runTestSuite('Settings', async () => {
        await this.testSuites.runSettingsTests();
      });
      
      // Run display screen tests
      await this.runTestSuite('Display Screens', async () => {
        await this.testSuites.runDisplayScreenTests();
      });
      
      // Run comprehensive UI tests
      await this.runTestSuite('Comprehensive UI', async () => {
        await this.testSuites.runComprehensiveUITests();
      });
      
      // Run API endpoint tests
      await this.runTestSuite('API Endpoints', async () => {
        await this.testSuites.runAPITests();
      });
      
    } catch (error) {
      console.error('Test execution failed:', error);
      this.testResults.errors.push({
        suite: 'General',
        error: error.message,
        stack: error.stack
      });
    } finally {
      this.testResults.endTime = new Date();
      await this.generateReports();
      await this.cleanup();
    }
  }

  async runTestSuite(suiteName, testFunction) {
    console.log(`\nRunning ${suiteName} tests...`);
    
    this.dashboard.updateTestData('test-started', { name: suiteName });
    
    const suiteResult = {
      name: suiteName,
      startTime: new Date(),
      endTime: null,
      tests: [],
      passed: 0,
      failed: 0,
      errors: []
    };
    
    try {
      await testFunction();
      suiteResult.passed++;
    } catch (error) {
      console.error(`${suiteName} tests failed:`, error);
      suiteResult.failed++;
      suiteResult.errors.push({
        message: error.message,
        stack: error.stack
      });
    }
    
    suiteResult.endTime = new Date();
    this.testResults.suites[suiteName] = suiteResult;
    
    this.dashboard.updateTestData('test-completed', {
      name: suiteName,
      success: suiteResult.failed === 0,
      duration: suiteResult.endTime - suiteResult.startTime,
      passed: suiteResult.passed,
      failed: suiteResult.failed
    });
    
    this.testResults.totalTests += suiteResult.passed + suiteResult.failed;
    this.testResults.passedTests += suiteResult.passed;
    this.testResults.failedTests += suiteResult.failed;
  }

  async generateReports() {
    console.log('\nGenerating test reports...');
    
    const reportData = {
      ...this.testResults,
      browserLogs: {
        console: this.browser.getConsoleLogs(),
        network: this.browser.getNetworkLogs(),
        errors: this.browser.getErrors()
      },
      interactions: {
        clickedButtons: this.browser.getClickedElements(),
        testedInputs: this.browser.getFormInputs()
      },
      database: {
        queries: this.database.getQueryHistory()
      }
    };
    
    // Generate reports in multiple formats
    await this.reportGenerator.generateHTML(reportData);
    await this.reportGenerator.generateJSON(reportData);
    await this.reportGenerator.generateMarkdown(reportData);
    await this.reportGenerator.generateClaudeSummary(reportData);
    
    console.log('Reports generated successfully');
  }

  async cleanup() {
    console.log('\nCleaning up...');
    
    try {
      await this.browser.close();
      await this.database.stop();
      console.log('Cleanup completed');
    } catch (error) {
      console.error('Cleanup error:', error);
    }
  }

  async runSpecificTest(testName) {
    await this.initialize();
    
    const testMap = {
      'auth': () => this.testSuites.runAuthenticationTests(),
      'barista': () => this.testSuites.runBaristaInterfaceTests(),
      'orders': () => this.testSuites.runOrderManagementTests(),
      'inventory': () => this.testSuites.runInventoryTests(),
      'settings': () => this.testSuites.runSettingsTests(),
      'display': () => this.testSuites.runDisplayScreenTests(),
      'ui': () => this.testSuites.runComprehensiveUITests(),
      'api': () => this.testSuites.runAPITests()
    };
    
    if (testMap[testName]) {
      await this.runTestSuite(testName, testMap[testName]);
      await this.generateReports();
      await this.cleanup();
    } else {
      console.error(`Unknown test: ${testName}`);
      console.log('Available tests:', Object.keys(testMap).join(', '));
    }
  }
}

// Main execution
if (require.main === module) {
  const orchestrator = new TestOrchestrator();
  const testName = process.argv[2];
  
  (async () => {
    try {
      await orchestrator.initialize();
      
      if (testName) {
        await orchestrator.runSpecificTest(testName);
      } else {
        await orchestrator.runAllTests();
      }
    } catch (error) {
      console.error('Fatal error:', error);
      process.exit(1);
    }
  })();
}

module.exports = TestOrchestrator;