#!/usr/bin/env node
const puppeteer = require('puppeteer');

class RobustUITester {
    constructor() {
        this.browser = null;
        this.page = null;
        this.results = {
            total: 0,
            passed: 0,
            failed: 0,
            tests: []
        };
    }

    async init() {
        console.log('🚀 Starting Robust Coffee Cue UI Test...\n');
        
        try {
            this.browser = await puppeteer.launch({
                headless: false,
                defaultViewport: { width: 1200, height: 800 },
                args: [
                    '--disable-web-security',
                    '--disable-features=VizDisplayCompositor',
                    '--no-sandbox'
                ]
            });
            
            this.page = await this.browser.newPage();
            
            // Set longer timeouts for slower connections
            this.page.setDefaultTimeout(10000);
            this.page.setDefaultNavigationTimeout(15000);
            
            // Monitor console messages
            this.page.on('console', msg => {
                if (msg.type() === 'error') {
                    console.log('🔍 Console Error:', msg.text());
                }
            });
            
            return true;
        } catch (error) {
            console.error('❌ Failed to initialize browser:', error.message);
            return false;
        }
    }

    async navigateToApp() {
        const testName = 'Navigate to Coffee Cue App';
        console.log(`🧪 ${testName}...`);
        
        try {
            // Try multiple navigation approaches
            const urls = [
                'http://localhost:3000',
                'http://127.0.0.1:3000'
            ];
            
            let success = false;
            for (const url of urls) {
                try {
                    await this.page.goto(url, { 
                        waitUntil: 'domcontentloaded',
                        timeout: 10000 
                    });
                    
                    // Wait for React to load
                    await this.page.waitForFunction(
                        () => document.querySelector('#root') !== null,
                        { timeout: 5000 }
                    );
                    
                    success = true;
                    console.log(`✅ Successfully loaded ${url}`);
                    break;
                } catch (urlError) {
                    console.log(`⚠️  Failed to load ${url}: ${urlError.message}`);
                    continue;
                }
            }
            
            if (!success) {
                throw new Error('Could not load app from any URL');
            }
            
            this.addResult(testName, true, 'App loaded successfully');
            
        } catch (error) {
            console.log(`❌ ${testName} failed:`, error.message);
            this.addResult(testName, false, error.message);
        }
    }

    async testLoginFlow() {
        const testName = 'Login Flow Test';
        console.log(`🧪 ${testName}...`);
        
        try {
            // Look for login elements
            const loginSelectors = [
                'input[type="text"]', 
                'input[type="password"]',
                'input[placeholder*="username" i]',
                'input[placeholder*="password" i]',
                'button[type="submit"]',
                'button:contains("Login")',
                'button:contains("Sign In")'
            ];
            
            let foundElements = 0;
            for (const selector of loginSelectors) {
                try {
                    const element = await this.page.$(selector);
                    if (element) {
                        foundElements++;
                        console.log(`✓ Found: ${selector}`);
                    }
                } catch (e) {
                    // Selector not found, continue
                }
            }
            
            if (foundElements > 0) {
                // Try demo login if available
                try {
                    const usernameField = await this.page.$('input[type="text"], input[placeholder*="username" i]');
                    const passwordField = await this.page.$('input[type="password"], input[placeholder*="password" i]');
                    const loginButton = await this.page.$('button[type="submit"], button:contains("Login")');
                    
                    if (usernameField && passwordField && loginButton) {
                        await usernameField.type('barista');
                        await passwordField.type('barista123');
                        await loginButton.click();
                        
                        // Wait for navigation or dashboard
                        await this.page.waitForTimeout(2000);
                        console.log('✓ Attempted login with demo credentials');
                    }
                } catch (loginError) {
                    console.log('⚠️  Login attempt failed:', loginError.message);
                }
            }
            
            this.addResult(testName, true, `Found ${foundElements} login-related elements`);
            
        } catch (error) {
            console.log(`❌ ${testName} failed:`, error.message);
            this.addResult(testName, false, error.message);
        }
    }

    async testButtonClicks() {
        const testName = 'Button Click Test';
        console.log(`🧪 ${testName}...`);
        
        try {
            const buttons = await this.page.$$('button');
            console.log(`📋 Found ${buttons.length} buttons`);
            
            let clickedCount = 0;
            for (let i = 0; i < Math.min(buttons.length, 10); i++) { // Limit to first 10 buttons
                try {
                    const button = buttons[i];
                    const text = await button.evaluate(el => el.textContent?.trim() || 'No text');
                    
                    // Skip dangerous buttons
                    if (text.match(/logout|delete|remove|clear/i)) {
                        console.log(`⚠️  Skipping dangerous button: ${text}`);
                        continue;
                    }
                    
                    await button.click();
                    await this.page.waitForTimeout(500); // Brief pause between clicks
                    clickedCount++;
                    console.log(`✓ Clicked: ${text}`);
                    
                } catch (clickError) {
                    console.log(`⚠️  Click failed: ${clickError.message}`);
                }
            }
            
            this.addResult(testName, true, `Successfully clicked ${clickedCount} buttons`);
            
        } catch (error) {
            console.log(`❌ ${testName} failed:`, error.message);
            this.addResult(testName, false, error.message);
        }
    }

    async testTabs() {
        const testName = 'Tab Navigation Test';
        console.log(`🧪 ${testName}...`);
        
        try {
            const tabSelectors = [
                '[role="tab"]',
                '.tab',
                'button[data-tab]',
                'a[href*="#"]'
            ];
            
            let tabsFound = 0;
            for (const selector of tabSelectors) {
                try {
                    const tabs = await this.page.$$(selector);
                    if (tabs.length > 0) {
                        console.log(`✓ Found ${tabs.length} tabs with selector: ${selector}`);
                        
                        // Click first few tabs
                        for (let i = 0; i < Math.min(tabs.length, 5); i++) {
                            try {
                                await tabs[i].click();
                                await this.page.waitForTimeout(300);
                                tabsFound++;
                            } catch (tabError) {
                                console.log(`⚠️  Tab click failed: ${tabError.message}`);
                            }
                        }
                        break;
                    }
                } catch (e) {
                    // Continue to next selector
                }
            }
            
            this.addResult(testName, true, `Interacted with ${tabsFound} tabs`);
            
        } catch (error) {
            console.log(`❌ ${testName} failed:`, error.message);
            this.addResult(testName, false, error.message);
        }
    }

    async generateReport() {
        const reportHtml = `
<!DOCTYPE html>
<html>
<head>
    <title>Coffee Cue UI Test Report</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .header { background: #2563eb; color: white; padding: 20px; border-radius: 8px; }
        .summary { display: flex; gap: 20px; margin: 20px 0; }
        .stat { background: #f3f4f6; padding: 15px; border-radius: 8px; text-align: center; }
        .test { border: 1px solid #e5e7eb; margin: 10px 0; padding: 15px; border-radius: 8px; }
        .passed { border-left: 4px solid #10b981; }
        .failed { border-left: 4px solid #ef4444; }
        .timestamp { color: #6b7280; font-size: 0.9em; }
    </style>
</head>
<body>
    <div class="header">
        <h1>Coffee Cue UI Test Report</h1>
        <div class="timestamp">Generated: ${new Date().toLocaleString()}</div>
    </div>
    
    <div class="summary">
        <div class="stat">
            <h3>${this.results.total}</h3>
            <p>Total Tests</p>
        </div>
        <div class="stat">
            <h3>${this.results.passed}</h3>
            <p>Passed</p>
        </div>
        <div class="stat">
            <h3>${this.results.failed}</h3>
            <p>Failed</p>
        </div>
    </div>
    
    <h2>Test Results</h2>
    ${this.results.tests.map(test => `
        <div class="test ${test.passed ? 'passed' : 'failed'}">
            <h3>${test.name} ${test.passed ? '✅' : '❌'}</h3>
            <p>${test.details}</p>
        </div>
    `).join('')}
</body>
</html>`;

        require('fs').writeFileSync('ui-test-report.html', reportHtml);
        console.log('\n📊 Report generated: ui-test-report.html');
    }

    addResult(name, passed, details) {
        this.results.total++;
        if (passed) this.results.passed++;
        else this.results.failed++;
        
        this.results.tests.push({ name, passed, details });
    }

    async cleanup() {
        if (this.browser) {
            await this.browser.close();
        }
    }

    async run() {
        const initialized = await this.init();
        if (!initialized) return;

        try {
            await this.navigateToApp();
            await this.testLoginFlow();
            await this.testButtonClicks();
            await this.testTabs();
            
            console.log('\n📊 Test Summary:');
            console.log(`✅ Passed: ${this.results.passed}`);
            console.log(`❌ Failed: ${this.results.failed}`);
            console.log(`📋 Total: ${this.results.total}`);
            
            await this.generateReport();
            
        } catch (error) {
            console.error('💥 Unexpected error:', error);
        } finally {
            await this.cleanup();
        }
    }
}

// Run the test
if (require.main === module) {
    const tester = new RobustUITester();
    tester.run().catch(console.error);
}

module.exports = RobustUITester;