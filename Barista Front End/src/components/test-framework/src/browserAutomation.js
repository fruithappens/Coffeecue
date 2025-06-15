const puppeteer = require('puppeteer');
const EventEmitter = require('events');
const config = require('../config/testConfig');
const path = require('path');
const fs = require('fs').promises;

class BrowserAutomation extends EventEmitter {
  constructor() {
    super();
    this.browser = null;
    this.page = null;
    this.consoleLogs = [];
    this.networkLogs = [];
    this.errors = [];
    this.clickedElements = [];
    this.formInputs = [];
  }

  async launch() {
    this.browser = await puppeteer.launch({
      headless: config.testConfig.headless,
      slowMo: config.testConfig.slowMo,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      defaultViewport: config.testConfig.viewport
    });

    this.page = await this.browser.newPage();
    this.setupPageMonitoring();
    
    console.log('Browser launched');
    this.emit('browser-launched');
  }

  setupPageMonitoring() {
    // Monitor console logs
    this.page.on('console', message => {
      const log = {
        type: message.type(),
        text: message.text(),
        timestamp: new Date(),
        location: message.location()
      };
      this.consoleLogs.push(log);
      this.emit('console-log', log);
    });

    // Monitor page errors
    this.page.on('pageerror', error => {
      const errorLog = {
        message: error.message,
        stack: error.stack,
        timestamp: new Date()
      };
      this.errors.push(errorLog);
      this.emit('page-error', errorLog);
    });

    // Monitor network requests
    this.page.on('request', request => {
      const log = {
        url: request.url(),
        method: request.method(),
        headers: request.headers(),
        postData: request.postData(),
        timestamp: new Date(),
        type: 'request'
      };
      this.networkLogs.push(log);
      this.emit('network-request', log);
    });

    // Monitor network responses
    this.page.on('response', response => {
      const log = {
        url: response.url(),
        status: response.status(),
        statusText: response.statusText(),
        headers: response.headers(),
        timestamp: new Date(),
        type: 'response'
      };
      this.networkLogs.push(log);
      this.emit('network-response', log);
    });
  }

  async navigate(url) {
    try {
      await this.page.goto(url, { waitUntil: 'networkidle2' });
      this.emit('navigation', { url, success: true });
    } catch (error) {
      this.emit('navigation', { url, success: false, error: error.message });
      throw error;
    }
  }

  async clickAllButtons() {
    const buttons = await this.page.$$('button, [role="button"], input[type="submit"], input[type="button"]');
    const results = [];

    for (let i = 0; i < buttons.length; i++) {
      try {
        const button = buttons[i];
        const buttonInfo = await this.page.evaluate(el => {
          return {
            text: el.textContent.trim(),
            id: el.id,
            className: el.className,
            type: el.type || 'button',
            disabled: el.disabled,
            visible: el.offsetParent !== null
          };
        }, button);

        if (!buttonInfo.disabled && buttonInfo.visible) {
          // Take screenshot before click
          const screenshotBefore = await this.takeScreenshot(`button-${i}-before`);
          
          // Click the button
          await button.click();
          await this.page.waitForTimeout(1000); // Wait for any animations/updates
          
          // Take screenshot after click
          const screenshotAfter = await this.takeScreenshot(`button-${i}-after`);
          
          const result = {
            ...buttonInfo,
            clicked: true,
            screenshotBefore,
            screenshotAfter,
            timestamp: new Date()
          };
          
          results.push(result);
          this.clickedElements.push(result);
          this.emit('button-clicked', result);
        }
      } catch (error) {
        console.error(`Error clicking button ${i}:`, error);
        results.push({
          error: error.message,
          buttonIndex: i
        });
      }
    }

    return results;
  }

  async testAllFormFields() {
    const inputs = await this.page.$$('input, textarea, select');
    const results = [];

    for (let i = 0; i < inputs.length; i++) {
      try {
        const input = inputs[i];
        const inputInfo = await this.page.evaluate(el => {
          return {
            type: el.type || 'text',
            name: el.name,
            id: el.id,
            placeholder: el.placeholder,
            required: el.required,
            value: el.value,
            tagName: el.tagName.toLowerCase()
          };
        }, input);

        const testValues = this.getTestValuesForInput(inputInfo.type);
        
        for (const testValue of testValues) {
          // Clear existing value
          await input.click({ clickCount: 3 });
          await input.press('Backspace');
          
          // Type new value
          if (inputInfo.tagName === 'select') {
            await input.select(testValue);
          } else {
            await input.type(testValue.toString());
          }
          
          const result = {
            ...inputInfo,
            testValue,
            timestamp: new Date()
          };
          
          results.push(result);
          this.formInputs.push(result);
          this.emit('form-input-tested', result);
        }
      } catch (error) {
        console.error(`Error testing input ${i}:`, error);
        results.push({
          error: error.message,
          inputIndex: i
        });
      }
    }

    return results;
  }

  getTestValuesForInput(type) {
    const testValues = {
      'text': ['Test Text', '123', 'Special!@#$%', ''],
      'email': ['test@example.com', 'invalid-email', ''],
      'password': ['password123', 'short', 'VeryLongPassword123!@#'],
      'number': ['123', '0', '-1', '999999'],
      'tel': ['1234567890', '123', '+1-555-555-5555'],
      'date': ['2024-01-01', '2024-12-31', ''],
      'default': ['Test Value', '']
    };

    return testValues[type] || testValues.default;
  }

  async takeScreenshot(name) {
    const timestamp = Date.now();
    const filename = `screenshot-${name}-${timestamp}.png`;
    const filepath = path.join(config.reports.outputDir, 'screenshots', filename);
    
    await fs.mkdir(path.dirname(filepath), { recursive: true });
    await this.page.screenshot({ path: filepath, fullPage: true });
    
    return filename;
  }

  async checkForErrors() {
    // Check for JavaScript errors
    const jsErrors = await this.page.evaluate(() => {
      const errors = [];
      if (window.console && window.console.error) {
        // This would need to be injected earlier to capture all errors
      }
      return errors;
    });

    // Check for React errors
    const reactErrors = await this.page.evaluate(() => {
      const errorElement = document.querySelector('.error-boundary-message');
      return errorElement ? errorElement.textContent : null;
    });

    return {
      jsErrors,
      reactErrors,
      pageErrors: this.errors,
      consoleErrors: this.consoleLogs.filter(log => log.type === 'error')
    };
  }

  async getApiCalls() {
    return this.networkLogs.filter(log => 
      log.url.includes('/api/') && log.type === 'request'
    );
  }

  async waitForSelector(selector, options = {}) {
    return await this.page.waitForSelector(selector, {
      timeout: config.testConfig.timeout,
      ...options
    });
  }

  async login(role = 'barista') {
    const credentials = config.credentials[role];
    if (!credentials) {
      throw new Error(`No credentials found for role: ${role}`);
    }

    await this.navigate(`${config.baseUrl}/login`);
    
    // Wait for login form
    await this.waitForSelector('input[name="username"], input[type="text"]');
    
    // Fill in credentials
    await this.page.type('input[name="username"], input[type="text"]', credentials.username);
    await this.page.type('input[name="password"], input[type="password"]', credentials.password);
    
    // Click login button
    await this.page.click('button[type="submit"], button:contains("Login")');
    
    // Wait for navigation
    await this.page.waitForNavigation({ waitUntil: 'networkidle2' });
    
    this.emit('login', { role, success: true });
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.emit('browser-closed');
    }
  }

  getConsoleLogs() {
    return this.consoleLogs;
  }

  getNetworkLogs() {
    return this.networkLogs;
  }

  getErrors() {
    return this.errors;
  }

  getClickedElements() {
    return this.clickedElements;
  }

  getFormInputs() {
    return this.formInputs;
  }
}

module.exports = BrowserAutomation;