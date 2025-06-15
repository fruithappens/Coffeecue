const puppeteer = require('puppeteer');
const fs = require('fs');
const WebSocket = require('ws');

class CoffeeCueUITester {
  constructor() {
    this.browser = null;
    this.page = null;
    this.consoleLog = [];
    this.networkLog = [];
    this.errorLog = [];
    this.dbQueries = [];
    this.wsServer = null;
    this.testResults = {
      timestamp: new Date().toISOString(),
      elementsClicked: [],
      formsSubmitted: [],
      dbVerifications: [],
      consoleWarnings: [],
      consoleErrors: [],
      networkFailures: [],
      fieldValidations: []
    };
  }

  async initialize() {
    // Start WebSocket server to receive backend logs
    this.wsServer = new WebSocket.Server({ port: 8081 });
    this.wsServer.on('connection', (ws) => {
      ws.on('message', (message) => {
        const log = JSON.parse(message);
        if (log.type === 'db_query') {
          this.dbQueries.push(log);
        }
      });
    });

    // Launch browser with console monitoring
    this.browser = await puppeteer.launch({
      headless: false, // Set to true for automated runs
      devtools: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    this.page = await this.browser.newPage();

    // Capture ALL console output
    this.page.on('console', msg => {
      const logEntry = {
        type: msg.type(),
        text: msg.text(),
        timestamp: new Date().toISOString(),
        location: msg.location()
      };

      this.consoleLog.push(logEntry);

      if (msg.type() === 'warning') {
        this.testResults.consoleWarnings.push(logEntry);
      } else if (msg.type() === 'error') {
        this.testResults.consoleErrors.push(logEntry);
      }

      // Real-time log streaming
      this.streamLog('console', logEntry);
    });

    // Capture page errors
    this.page.on('pageerror', error => {
      const errorEntry = {
        message: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString()
      };
      this.errorLog.push(errorEntry);
      this.streamLog('error', errorEntry);
    });

    // Monitor all network requests
    this.page.on('request', request => {
      this.networkLog.push({
        type: 'request',
        url: request.url(),
        method: request.method(),
        headers: request.headers(),
        postData: request.postData(),
        timestamp: new Date().toISOString()
      });
    });

    this.page.on('response', response => {
      const entry = {
        type: 'response',
        url: response.url(),
        status: response.status(),
        headers: response.headers(),
        timestamp: new Date().toISOString()
      };

      if (response.status() >= 400) {
        this.testResults.networkFailures.push(entry);
      }

      this.networkLog.push(entry);
    });

    // Inject monitoring script into page
    await this.page.evaluateOnNewDocument(() => {
      // Override localStorage to monitor all storage operations
      const originalSetItem = localStorage.setItem;
      const originalGetItem = localStorage.getItem;
      
      localStorage.setItem = function(key, value) {
        console.log(`[STORAGE-SET] ${key} = ${value}`);
        window.postMessage({
          type: 'storage-operation',
          operation: 'set',
          key,
          value
        }, '*');
        return originalSetItem.apply(this, arguments);
      };

      localStorage.getItem = function(key) {
        const value = originalGetItem.apply(this, arguments);
        console.log(`[STORAGE-GET] ${key} = ${value}`);
        return value;
      };

      // Monitor all API calls
      const originalFetch = window.fetch;
      window.fetch = async function(...args) {
        console.log(`[API-CALL] ${args[0]}`, args[1]);
        const response = await originalFetch.apply(this, args);
        const clonedResponse = response.clone();
        
        try {
          const data = await clonedResponse.json();
          console.log(`[API-RESPONSE] ${args[0]}`, data);
        } catch (e) {
          console.log(`[API-RESPONSE] ${args[0]} (non-JSON)`);
        }
        
        return response;
      };
    });
  }

  streamLog(type, data) {
    // Send to monitoring dashboard
    if (this.wsServer) {
      this.wsServer.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ type, data }));
        }
      });
    }

    // Append to log file
    fs.appendFileSync(
      `./test-results/realtime-${type}.log`,
      JSON.stringify(data) + '\n'
    );
  }

  async clickEveryButton() {
    console.log('🔍 Finding and clicking all buttons...');
    
    const buttons = await this.page.$$('button');
    
    for (let i = 0; i < buttons.length; i++) {
      try {
        const button = buttons[i];
        const buttonInfo = await this.page.evaluate(el => {
          return {
            text: el.textContent,
            id: el.id,
            classes: el.className,
            disabled: el.disabled,
            visible: el.offsetParent !== null
          };
        }, button);

        if (!buttonInfo.visible || buttonInfo.disabled) {
          console.log(`⏭️  Skipping button: ${buttonInfo.text} (disabled/hidden)`);
          continue;
        }

        console.log(`🖱️  Clicking button: ${buttonInfo.text}`);
        
        // Take screenshot before click
        await this.page.screenshot({
          path: `./test-results/screenshots/before-click-${i}.png`
        });

        // Record network activity before click
        const networkBefore = this.networkLog.length;
        const consoleBefore = this.consoleLog.length;

        // Click the button
        await button.click();
        
        // Wait for any reactions
        await this.page.waitForTimeout(1000);

        // Check what happened
        const networkAfter = this.networkLog.length;
        const consoleAfter = this.consoleLog.length;

        const clickResult = {
          button: buttonInfo,
          timestamp: new Date().toISOString(),
          networkCalls: this.networkLog.slice(networkBefore, networkAfter),
          consoleLogs: this.consoleLog.slice(consoleBefore, consoleAfter),
          screenshot: `before-click-${i}.png`
        };

        this.testResults.elementsClicked.push(clickResult);

        // Check if any modals/dialogs opened
        const hasModal = await this.page.evaluate(() => {
          return document.querySelector('.modal, [role="dialog"], .dialog') !== null;
        });

        if (hasModal) {
          console.log('📋 Modal detected, attempting to close...');
          await this.closeModals();
        }

      } catch (error) {
        console.error(`❌ Error clicking button ${i}:`, error.message);
      }
    }
  }

  async testEveryFormField() {
    console.log('📝 Testing all form fields...');
    
    const inputs = await this.page.$$('input, textarea, select');
    
    for (let i = 0; i < inputs.length; i++) {
      const input = inputs[i];
      const fieldInfo = await this.page.evaluate(el => {
        return {
          type: el.type || el.tagName.toLowerCase(),
          name: el.name,
          id: el.id,
          value: el.value,
          placeholder: el.placeholder,
          required: el.required,
          pattern: el.pattern,
          min: el.min,
          max: el.max
        };
      }, input);

      console.log(`📝 Testing field: ${fieldInfo.name || fieldInfo.id || fieldInfo.type}`);

      // Test various inputs based on field type
      const testCases = this.getTestCasesForField(fieldInfo);
      
      for (const testCase of testCases) {
        try {
          // Clear existing value
          await input.click({ clickCount: 3 });
          await input.type(String(testCase.value));

          // Try to submit or blur to trigger validation
          await this.page.keyboard.press('Tab');
          await this.page.waitForTimeout(500);

          // Check for validation messages
          const validationMessage = await this.page.evaluate(el => {
            return el.validationMessage || '';
          }, input);

          // Check if the value was actually saved
          const dbQueryBefore = this.dbQueries.length;
          
          // Try to save (look for save buttons nearby)
          const saveButton = await this.findNearestSaveButton(input);
          if (saveButton) {
            await saveButton.click();
            await this.page.waitForTimeout(1000);
          }

          const dbQueryAfter = this.dbQueries.length;
          const dbActivity = dbQueryAfter > dbQueryBefore;

          this.testResults.fieldValidations.push({
            field: fieldInfo,
            testCase: testCase,
            validationMessage,
            dbActivity,
            queries: this.dbQueries.slice(dbQueryBefore, dbQueryAfter)
          });

        } catch (error) {
          console.error(`❌ Error testing field:`, error.message);
        }
      }
    }
  }

  getTestCasesForField(fieldInfo) {
    const testCases = [];

    switch (fieldInfo.type) {
      case 'email':
        testCases.push(
          { value: 'test@example.com', expected: 'valid' },
          { value: 'invalid-email', expected: 'invalid' },
          { value: '', expected: fieldInfo.required ? 'invalid' : 'valid' }
        );
        break;
      
      case 'number':
        testCases.push(
          { value: '123', expected: 'valid' },
          { value: '-1', expected: fieldInfo.min && -1 < fieldInfo.min ? 'invalid' : 'valid' },
          { value: '999999', expected: fieldInfo.max && 999999 > fieldInfo.max ? 'invalid' : 'valid' },
          { value: 'abc', expected: 'invalid' }
        );
        break;
      
      case 'tel':
        testCases.push(
          { value: '+61412345678', expected: 'valid' },
          { value: '0412345678', expected: 'valid' },
          { value: '123', expected: 'invalid' }
        );
        break;
      
      default:
        testCases.push(
          { value: 'Test Value 123', expected: 'valid' },
          { value: '<script>alert("xss")</script>', expected: 'valid' }, // Should be escaped
          { value: '', expected: fieldInfo.required ? 'invalid' : 'valid' },
          { value: 'A'.repeat(1000), expected: 'valid' } // Long input
        );
    }

    return testCases;
  }

  async findNearestSaveButton(element) {
    return await this.page.evaluateHandle(el => {
      // Look for save buttons in the same form or nearby
      const form = el.closest('form');
      if (form) {
        const saveButton = form.querySelector('button[type="submit"], button:contains("Save"), button:contains("Update")');
        if (saveButton) return saveButton;
      }
      
      // Look in parent containers
      let parent = el.parentElement;
      let depth = 0;
      while (parent && depth < 5) {
        const saveButton = parent.querySelector('button:contains("Save"), button:contains("Update"), button:contains("Submit")');
        if (saveButton) return saveButton;
        parent = parent.parentElement;
        depth++;
      }
      
      return null;
    }, element);
  }

  async verifyDatabaseConnections() {
    console.log('🔍 Verifying database connections...');
    
    // Check each API endpoint
    const endpoints = [
      '/api/orders/pending',
      '/api/stations',
      '/api/inventory',
      '/api/settings',
      '/api/schedule/today'
    ];

    for (const endpoint of endpoints) {
      const response = await this.page.evaluate(async (url) => {
        try {
          const response = await fetch(url);
          const data = await response.json();
          return {
            status: response.status,
            hasData: Array.isArray(data) ? data.length > 0 : Object.keys(data).length > 0,
            error: null
          };
        } catch (error) {
          return {
            status: 0,
            hasData: false,
            error: error.message
          };
        }
      }, `http://localhost:3000${endpoint}`);

      this.testResults.dbVerifications.push({
        endpoint,
        ...response,
        timestamp: new Date().toISOString()
      });
    }
  }

  async closeModals() {
    // Try various ways to close modals
    const closeSelectors = [
      'button[aria-label="Close"]',
      'button:contains("Close")',
      'button:contains("Cancel")',
      '.modal-close',
      '[data-dismiss="modal"]'
    ];

    for (const selector of closeSelectors) {
      try {
        const closeButton = await this.page.$(selector);
        if (closeButton) {
          await closeButton.click();
          return;
        }
      } catch (e) {
        // Continue trying other selectors
      }
    }

    // Last resort: press Escape
    await this.page.keyboard.press('Escape');
  }

  async generateReport() {
    const report = {
      ...this.testResults,
      summary: {
        totalButtonsClicked: this.testResults.elementsClicked.length,
        totalFieldsTested: this.testResults.fieldValidations.length,
        consoleWarnings: this.testResults.consoleWarnings.length,
        consoleErrors: this.testResults.consoleErrors.length,
        networkFailures: this.testResults.networkFailures.length,
        dbConnections: this.testResults.dbVerifications.filter(v => v.hasData).length
      }
    };

    fs.writeFileSync(
      './test-results/ui-test-report.json',
      JSON.stringify(report, null, 2)
    );

    // Generate HTML report
    const html = this.generateHTMLReport(report);
    fs.writeFileSync('./test-results/ui-test-report.html', html);
  }

  generateHTMLReport(report) {
    return `
<!DOCTYPE html>
<html>
<head>
  <title>Coffee Cue UI Test Report</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; }
    .summary { background: #f0f0f0; padding: 20px; border-radius: 5px; margin-bottom: 20px; }
    .section { margin: 20px 0; }
    .error { background: #fee; padding: 10px; margin: 5px 0; border-left: 3px solid #f00; }
    .warning { background: #ffe; padding: 10px; margin: 5px 0; border-left: 3px solid #fa0; }
    .success { background: #efe; padding: 10px; margin: 5px 0; border-left: 3px solid #0a0; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    th { background: #f5f5f5; }
    .field-test { margin: 10px 0; padding: 10px; background: #f9f9f9; }
    .db-active { color: green; font-weight: bold; }
    .db-inactive { color: red; }
  </style>
</head>
<body>
  <h1>☕ Coffee Cue UI Test Report</h1>
  <p>Generated: ${new Date().toISOString()}</p>
  
  <div class="summary">
    <h2>Summary</h2>
    <p>✓ Buttons Clicked: ${report.summary.totalButtonsClicked}</p>
    <p>✓ Form Fields Tested: ${report.summary.totalFieldsTested}</p>
    <p>${report.summary.consoleErrors > 0 ? '⚠️' : '✓'} Console Errors: ${report.summary.consoleErrors}</p>
    <p>${report.summary.consoleWarnings > 0 ? '⚠️' : '✓'} Console Warnings: ${report.summary.consoleWarnings}</p>
    <p>${report.summary.networkFailures > 0 ? '❌' : '✓'} Network Failures: ${report.summary.networkFailures}</p>
    <p>✓ Database Connections: ${report.summary.dbConnections}</p>
  </div>

  <div class="section">
    <h2>Console Errors</h2>
    ${report.consoleErrors.map(error => `
      <div class="error">
        <strong>${error.timestamp}</strong><br>
        ${error.text}<br>
        <small>${error.location.url}:${error.location.lineNumber}</small>
      </div>
    `).join('')}
  </div>

  <div class="section">
    <h2>Form Field Validation Results</h2>
    ${report.fieldValidations.map(test => `
      <div class="field-test">
        <h4>${test.field.name || test.field.id || test.field.type}</h4>
        <p>Type: ${test.field.type}</p>
        <p>Test Value: "${test.testCase.value}"</p>
        <p>Validation: ${test.validationMessage || 'No validation message'}</p>
        <p class="${test.dbActivity ? 'db-active' : 'db-inactive'}">
          Database Activity: ${test.dbActivity ? 'YES' : 'NO'}
        </p>
        ${test.queries.length > 0 ? `
          <p>Queries:</p>
          <pre>${JSON.stringify(test.queries, null, 2)}</pre>
        ` : ''}
      </div>
    `).join('')}
  </div>

  <div class="section">
    <h2>Button Click Analysis</h2>
    <table>
      <tr>
        <th>Button</th>
        <th>Network Calls</th>
        <th>Console Output</th>
        <th>Result</th>
      </tr>
      ${report.elementsClicked.map(click => `
        <tr>
          <td>${click.button.text}</td>
          <td>${click.networkCalls.length}</td>
          <td>${click.consoleLogs.length}</td>
          <td>${click.networkCalls.length > 0 ? '✓ Active' : '⚠️ No action'}</td>
        </tr>
      `).join('')}
    </table>
  </div>

  <div class="section">
    <h2>Database Connection Verification</h2>
    <table>
      <tr>
        <th>Endpoint</th>
        <th>Status</th>
        <th>Has Data</th>
        <th>Error</th>
      </tr>
      ${report.dbVerifications.map(db => `
        <tr>
          <td>${db.endpoint}</td>
          <td>${db.status}</td>
          <td class="${db.hasData ? 'db-active' : 'db-inactive'}">${db.hasData ? 'YES' : 'NO'}</td>
          <td>${db.error || '-'}</td>
        </tr>
      `).join('')}
    </table>
  </div>
</body>
</html>
    `;
  }
}

module.exports = CoffeeCueUITester;