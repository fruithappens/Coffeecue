/**
 * Test Runner Module
 * Executes automated UI tests using Puppeteer
 */

const puppeteer = require('puppeteer');
const path = require('path');

class TestRunner {
    constructor(config) {
        this.config = config;
        this.browser = null;
        this.page = null;
        this.results = {
            timestamp: new Date().toISOString(),
            tests: [],
            summary: {
                total: 0,
                passed: 0,
                failed: 0
            }
        };
    }

    async initialize() {
        try {
            // Launch browser with proper config to avoid socket issues
            this.browser = await puppeteer.launch({
                headless: this.config.headless,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-web-security',
                    '--disable-features=IsolateOrigins,site-per-process',
                    '--disable-gpu',
                    '--disable-accelerated-2d-canvas'
                ],
                defaultViewport: {
                    width: 1280,
                    height: 800
                },
                ignoreHTTPSErrors: true,
                dumpio: false
            });

            this.page = await this.browser.newPage();
            
            // Set up console logging
            this.page.on('console', msg => {
                if (msg.type() === 'error') {
                    console.log('Browser console error:', msg.text());
                }
            });

            // Set up request interception for monitoring
            await this.page.setRequestInterception(true);
            this.page.on('request', request => {
                request.continue();
            });

            return true;
        } catch (error) {
            console.error('Failed to initialize browser:', error.message);
            return false;
        }
    }

    async runAllTests() {
        const initialized = await this.initialize();
        if (!initialized) {
            throw new Error('Failed to initialize test runner');
        }

        try {
            // Define test suites
            const testSuites = [
                { name: 'Authentication', fn: () => this.testAuthentication() },
                { name: 'Navigation', fn: () => this.testNavigation() },
                { name: 'Order Management', fn: () => this.testOrderManagement() },
                { name: 'Stock Management', fn: () => this.testStockManagement() },
                { name: 'Settings Persistence', fn: () => this.testSettings() },
                { name: 'Display Features', fn: () => this.testDisplayFeatures() },
                { name: 'Audio System', fn: () => this.testAudioSystem() }
            ];

            // Run each test suite
            for (const suite of testSuites) {
                await this.runTestSuite(suite.name, suite.fn);
            }

            // Calculate summary
            this.results.summary.total = this.results.tests.length;
            this.results.summary.passed = this.results.tests.filter(t => t.passed).length;
            this.results.summary.failed = this.results.summary.total - this.results.summary.passed;

            return this.results;

        } finally {
            await this.cleanup();
        }
    }

    async runTestSuite(suiteName, testFunction) {
        console.log(`Running ${suiteName} tests...`);
        
        try {
            const suiteResults = await testFunction();
            
            // Add suite results to overall results
            if (Array.isArray(suiteResults)) {
                suiteResults.forEach(result => {
                    this.results.tests.push({
                        suite: suiteName,
                        ...result,
                        timestamp: new Date().toISOString()
                    });
                });
            } else {
                this.results.tests.push({
                    suite: suiteName,
                    ...suiteResults,
                    timestamp: new Date().toISOString()
                });
            }
        } catch (error) {
            this.results.tests.push({
                suite: suiteName,
                name: 'Suite Execution',
                passed: false,
                error: error.message,
                timestamp: new Date().toISOString()
            });
            
            // Take screenshot on error
            await this.takeScreenshot(`error-${suiteName.toLowerCase().replace(/\s+/g, '-')}`);
        }
    }

    async testAuthentication() {
        const results = [];

        // Navigate to app
        await this.page.goto(this.config.baseUrl, { waitUntil: 'networkidle2' });

        // Check if already logged in
        const isLoggedIn = await this.isLoggedIn();
        
        if (isLoggedIn) {
            results.push({
                name: 'Login Status',
                passed: true,
                message: 'Already logged in'
            });
        } else {
            // Attempt login
            const loginResult = await this.performLogin();
            results.push(loginResult);
        }

        return results;
    }

    async isLoggedIn() {
        // Check for multiple indicators of being logged in
        const selectors = [
            'button:contains("Logout")',
            '[role="tab"]',
            '.barista-interface',
            '.order-list'
        ];

        for (const selector of selectors) {
            try {
                const element = await this.page.$(selector);
                if (element) return true;
            } catch (e) {
                // Continue checking
            }
        }

        return false;
    }

    async performLogin() {
        try {
            // Wait for login form
            await this.page.waitForSelector('input[type="text"], input[placeholder*="username" i]', { timeout: 5000 });
            
            // Fill credentials
            await this.page.type('input[type="text"], input[placeholder*="username" i]', 'barista');
            await this.page.type('input[type="password"]', 'barista123');
            
            // Click login button
            await this.page.click('button[type="submit"], button:contains("Login"), button:contains("Sign In")');
            
            // Wait for navigation
            await this.page.waitForNavigation({ waitUntil: 'networkidle2' });
            
            // Verify login succeeded
            const loggedIn = await this.isLoggedIn();
            
            return {
                name: 'Login',
                passed: loggedIn,
                message: loggedIn ? 'Successfully logged in' : 'Login failed'
            };
        } catch (error) {
            return {
                name: 'Login',
                passed: false,
                error: error.message
            };
        }
    }

    async testNavigation() {
        const results = [];

        try {
            // Find all tabs
            const tabs = await this.page.$$('[role="tab"], .tab, button[data-tab]');
            
            if (tabs.length === 0) {
                return [{
                    name: 'Tab Navigation',
                    passed: false,
                    message: 'No navigation tabs found'
                }];
            }

            // Click through tabs
            for (let i = 0; i < Math.min(tabs.length, 5); i++) {
                try {
                    const tabText = await tabs[i].evaluate(el => el.textContent);
                    await tabs[i].click();
                    await this.page.waitForTimeout(500);
                    
                    results.push({
                        name: `Navigate to ${tabText}`,
                        passed: true,
                        message: 'Tab clicked successfully'
                    });
                } catch (error) {
                    results.push({
                        name: `Navigate to Tab ${i + 1}`,
                        passed: false,
                        error: error.message
                    });
                }
            }
        } catch (error) {
            results.push({
                name: 'Tab Navigation',
                passed: false,
                error: error.message
            });
        }

        return results;
    }

    async testOrderManagement() {
        const results = [];

        try {
            // Navigate to Orders tab
            await this.clickTab('Orders');
            await this.page.waitForTimeout(1000);

            // Check for order elements
            const orderElements = await this.page.$$('.order-item, .order-card, [data-testid*="order"]');
            
            results.push({
                name: 'Order List Display',
                passed: orderElements.length > 0,
                message: `Found ${orderElements.length} order elements`
            });

            // Test walk-in order button if exists
            const walkInButton = await this.page.$('button:contains("Walk"), button:contains("walk")');
            if (walkInButton) {
                results.push({
                    name: 'Walk-in Order Button',
                    passed: true,
                    message: 'Walk-in order button found'
                });
            }

        } catch (error) {
            results.push({
                name: 'Order Management',
                passed: false,
                error: error.message
            });
        }

        return results;
    }

    async testStockManagement() {
        const results = [];

        try {
            // Navigate to Stock tab
            await this.clickTab('Stock');
            await this.page.waitForTimeout(1000);

            // Check for stock elements
            const stockElements = await this.page.$$('.stock-item, .inventory-item, [data-testid*="stock"]');
            
            results.push({
                name: 'Stock Display',
                passed: stockElements.length > 0,
                message: `Found ${stockElements.length} stock items`
            });

        } catch (error) {
            results.push({
                name: 'Stock Management',
                passed: false,
                error: error.message
            });
        }

        return results;
    }

    async testSettings() {
        const results = [];

        try {
            // Navigate to Settings tab
            await this.clickTab('Settings');
            await this.page.waitForTimeout(1000);

            // Find a toggle
            const toggle = await this.page.$('input[type="checkbox"], button[role="switch"]');
            
            if (toggle) {
                // Get initial state
                const initialState = await toggle.evaluate(el => el.checked);
                
                // Click toggle
                await toggle.click();
                await this.page.waitForTimeout(500);
                
                // Check if state changed
                const newState = await toggle.evaluate(el => el.checked);
                
                results.push({
                    name: 'Settings Toggle',
                    passed: newState !== initialState,
                    message: 'Settings toggle working'
                });

                // Check localStorage
                const hasSettings = await this.page.evaluate(() => {
                    return localStorage.getItem('coffee_cue_barista_settings') !== null ||
                           localStorage.getItem('balanceQueueEnabled') !== null;
                });

                results.push({
                    name: 'Settings Persistence',
                    passed: hasSettings,
                    message: hasSettings ? 'Settings saved to localStorage' : 'Settings not persisted'
                });
            } else {
                results.push({
                    name: 'Settings',
                    passed: false,
                    message: 'No settings toggles found'
                });
            }

        } catch (error) {
            results.push({
                name: 'Settings',
                passed: false,
                error: error.message
            });
        }

        return results;
    }

    async testDisplayFeatures() {
        const results = [];

        try {
            // Navigate to Display tab
            await this.clickTab('Display');
            await this.page.waitForTimeout(1000);

            // Check for QR codes
            const qrCodes = await this.page.$$('img[src*="qr"], img[alt*="QR"]');
            
            results.push({
                name: 'QR Code Display',
                passed: qrCodes.length > 0,
                message: `Found ${qrCodes.length} QR codes`
            });

            // Check for display settings
            const displaySettings = await this.page.$$('[class*="display"], [id*="display"]');
            
            results.push({
                name: 'Display Settings',
                passed: displaySettings.length > 0,
                message: `Found ${displaySettings.length} display elements`
            });

        } catch (error) {
            results.push({
                name: 'Display Features',
                passed: false,
                error: error.message
            });
        }

        return results;
    }

    async testAudioSystem() {
        const results = [];

        try {
            // Check if audio system is initialized
            const audioInitialized = await this.page.evaluate(() => {
                return window.CoffeeSounds && window.CoffeeSounds.initialized;
            });

            results.push({
                name: 'Audio System',
                passed: audioInitialized,
                message: audioInitialized ? 'Audio system initialized' : 'Audio system not found'
            });

        } catch (error) {
            results.push({
                name: 'Audio System',
                passed: false,
                error: error.message
            });
        }

        return results;
    }

    async clickTab(tabName) {
        // Try multiple selectors
        const selectors = [
            `[role="tab"]:contains("${tabName}")`,
            `button:contains("${tabName}")`,
            `.tab:contains("${tabName}")`,
            `[data-tab="${tabName.toLowerCase()}"]`
        ];

        for (const selector of selectors) {
            try {
                await this.page.click(selector);
                return true;
            } catch (e) {
                // Try next selector
            }
        }

        // If none work, try evaluating
        return await this.page.evaluate((name) => {
            const elements = document.querySelectorAll('[role="tab"], button, .tab');
            for (const el of elements) {
                if (el.textContent.includes(name)) {
                    el.click();
                    return true;
                }
            }
            return false;
        }, tabName);
    }

    async takeScreenshot(name) {
        try {
            const screenshotPath = path.join(this.config.screenshotDir, `${name}-${Date.now()}.png`);
            await this.page.screenshot({ path: screenshotPath, fullPage: true });
            console.log(`Screenshot saved: ${screenshotPath}`);
        } catch (error) {
            console.error('Failed to take screenshot:', error.message);
        }
    }

    async cleanup() {
        if (this.browser) {
            await this.browser.close();
        }
    }
}

module.exports = TestRunner;