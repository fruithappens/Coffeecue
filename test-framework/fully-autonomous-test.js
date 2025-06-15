#!/usr/bin/env node
/**
 * Fully Autonomous Test System
 * Runs completely without human intervention
 */

const http = require('http');
const https = require('https');
const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

class FullyAutonomousTest {
    constructor() {
        this.baseUrl = 'http://localhost:3000';
        this.apiUrl = 'http://localhost:5001';
        this.maxRetries = 5;
        this.currentCycle = 0;
        this.results = {
            startTime: Date.now(),
            cycles: [],
            allIssues: [],
            allFixes: []
        };
    }

    log(message, level = 'info') {
        const timestamp = new Date().toISOString();
        const symbols = {
            info: 'ℹ️ ',
            success: '✅',
            error: '❌',
            warning: '⚠️ ',
            fix: '🔧',
            test: '🧪'
        };
        console.log(`[${timestamp}] ${symbols[level]} ${message}`);
        
        // Also log to file
        const logEntry = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;
        fs.appendFile('autonomous-test.log', logEntry).catch(() => {});
    }

    async sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async makeRequest(url, options = {}) {
        return new Promise((resolve, reject) => {
            const urlObj = new URL(url);
            const client = urlObj.protocol === 'https:' ? https : http;
            
            const req = client.request(url, options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    resolve({
                        status: res.statusCode,
                        headers: res.headers,
                        data: data
                    });
                });
            });
            
            req.on('error', reject);
            
            if (options.body) {
                req.write(options.body);
            }
            
            req.end();
        });
    }

    async checkServices() {
        this.log('Checking if services are running...', 'info');
        
        try {
            // Check frontend
            const frontendResponse = await this.makeRequest(this.baseUrl);
            if (frontendResponse.status !== 200) {
                throw new Error('Frontend not responding');
            }
            this.log('Frontend is running', 'success');
            
            // Check backend
            const backendResponse = await this.makeRequest(`${this.apiUrl}/api/orders`);
            if (backendResponse.status !== 200 && backendResponse.status !== 401) {
                throw new Error('Backend not responding');
            }
            this.log('Backend is running', 'success');
            
            return true;
        } catch (error) {
            this.log(`Services check failed: ${error.message}`, 'error');
            return false;
        }
    }

    async runTestCycle() {
        this.currentCycle++;
        this.log(`\n🔄 STARTING TEST CYCLE ${this.currentCycle}/${this.maxRetries}`, 'info');
        
        const cycle = {
            number: this.currentCycle,
            startTime: Date.now(),
            tests: [],
            issues: [],
            fixes: [],
            status: 'running'
        };

        // Run all tests
        const testSuites = [
            { name: 'API Authentication', fn: () => this.testAuthentication() },
            { name: 'API Endpoints', fn: () => this.testApiEndpoints() },
            { name: 'Frontend Loading', fn: () => this.testFrontendLoading() },
            { name: 'CORS Configuration', fn: () => this.testCors() },
            { name: 'Data Persistence', fn: () => this.testDataPersistence() }
        ];

        for (const suite of testSuites) {
            this.log(`Running ${suite.name} tests...`, 'test');
            const result = await suite.fn();
            cycle.tests.push(...result);
        }

        // Analyze results
        const failedTests = cycle.tests.filter(t => !t.passed);
        cycle.failedCount = failedTests.length;
        cycle.passedCount = cycle.tests.filter(t => t.passed).length;
        
        this.log(`Test Results: ${cycle.passedCount}/${cycle.tests.length} passed`, 
                 failedTests.length === 0 ? 'success' : 'warning');

        if (failedTests.length === 0) {
            cycle.status = 'passed';
            this.log('All tests passed! 🎉', 'success');
            return cycle;
        }

        // Analyze and fix issues
        this.log(`Analyzing ${failedTests.length} failures...`, 'info');
        cycle.issues = this.analyzeFailures(failedTests);
        
        if (cycle.issues.length > 0) {
            this.log(`Attempting to fix ${cycle.issues.length} issues...`, 'fix');
            cycle.fixes = await this.fixIssues(cycle.issues);
            
            const successfulFixes = cycle.fixes.filter(f => f.success).length;
            if (successfulFixes > 0) {
                this.log(`Successfully fixed ${successfulFixes}/${cycle.issues.length} issues`, 'success');
                cycle.status = 'fixed';
                await this.sleep(2000); // Wait before retry
            } else {
                cycle.status = 'failed';
            }
        } else {
            cycle.status = 'failed';
        }

        cycle.endTime = Date.now();
        cycle.duration = cycle.endTime - cycle.startTime;
        
        return cycle;
    }

    async testAuthentication() {
        const results = [];
        
        // Test login endpoint
        try {
            const loginData = JSON.stringify({
                username: 'barista',
                password: 'barista123'
            });
            
            const response = await this.makeRequest(`${this.apiUrl}/api/auth/login`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(loginData)
                },
                body: loginData
            });
            
            const success = response.status === 200;
            let token = null;
            
            if (success) {
                try {
                    const data = JSON.parse(response.data);
                    token = data.token || data.access_token;
                } catch (e) {
                    // Ignore parse errors
                }
            }
            
            results.push({
                name: 'Login with barista credentials',
                passed: success && token !== null,
                error: success ? null : `Status ${response.status}`,
                data: { hasToken: token !== null }
            });
            
            // Store token for other tests
            if (token) {
                this.authToken = token;
            }
            
        } catch (error) {
            results.push({
                name: 'Login with barista credentials',
                passed: false,
                error: error.message
            });
        }
        
        return results;
    }

    async testApiEndpoints() {
        const results = [];
        const endpoints = [
            { name: 'Orders', path: '/api/orders', requiresAuth: false },
            { name: 'Stations', path: '/api/stations', requiresAuth: true },
            { name: 'Inventory', path: '/api/inventory', requiresAuth: false },
            { name: 'Settings', path: '/api/settings', requiresAuth: true }
        ];
        
        for (const endpoint of endpoints) {
            try {
                const headers = {};
                if (endpoint.requiresAuth && this.authToken) {
                    headers['Authorization'] = `Bearer ${this.authToken}`;
                }
                
                const response = await this.makeRequest(`${this.apiUrl}${endpoint.path}`, {
                    headers
                });
                
                const success = response.status === 200;
                results.push({
                    name: `${endpoint.name} API endpoint`,
                    passed: success,
                    error: success ? null : `Status ${response.status}`
                });
                
            } catch (error) {
                results.push({
                    name: `${endpoint.name} API endpoint`,
                    passed: false,
                    error: error.message
                });
            }
        }
        
        return results;
    }

    async testFrontendLoading() {
        const results = [];
        
        try {
            const response = await this.makeRequest(this.baseUrl);
            const hasReactRoot = response.data.includes('id="root"');
            const hasReactScript = response.data.includes('static/js');
            
            results.push({
                name: 'Frontend HTML loads',
                passed: response.status === 200,
                error: response.status === 200 ? null : `Status ${response.status}`
            });
            
            results.push({
                name: 'React root element present',
                passed: hasReactRoot,
                error: hasReactRoot ? null : 'React root not found'
            });
            
            results.push({
                name: 'React scripts included',
                passed: hasReactScript,
                error: hasReactScript ? null : 'React scripts not found'
            });
            
        } catch (error) {
            results.push({
                name: 'Frontend loading',
                passed: false,
                error: error.message
            });
        }
        
        return results;
    }

    async testCors() {
        const results = [];
        
        try {
            // Test CORS preflight
            const response = await this.makeRequest(`${this.apiUrl}/api/auth/login`, {
                method: 'OPTIONS',
                headers: {
                    'Origin': this.baseUrl,
                    'Access-Control-Request-Method': 'POST'
                }
            });
            
            const hasAllowOrigin = response.headers['access-control-allow-origin'];
            const hasAllowMethods = response.headers['access-control-allow-methods'];
            
            results.push({
                name: 'CORS preflight request',
                passed: response.status === 200 || response.status === 204,
                error: response.status === 200 || response.status === 204 ? 
                       null : `Status ${response.status}`
            });
            
            results.push({
                name: 'CORS Allow-Origin header',
                passed: hasAllowOrigin !== undefined,
                error: hasAllowOrigin ? null : 'Missing Access-Control-Allow-Origin'
            });
            
        } catch (error) {
            results.push({
                name: 'CORS configuration',
                passed: false,
                error: error.message
            });
        }
        
        return results;
    }

    async testDataPersistence() {
        const results = [];
        
        // Test creating and retrieving data
        if (this.authToken) {
            try {
                // Create test order
                const orderData = JSON.stringify({
                    items: [{ name: 'Test Latte', milk: 'Oat' }],
                    customer_name: 'Auto Test User',
                    order_type: 'walk_in'
                });
                
                const createResponse = await this.makeRequest(`${this.apiUrl}/api/orders`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.authToken}`,
                        'Content-Length': Buffer.byteLength(orderData)
                    },
                    body: orderData
                });
                
                results.push({
                    name: 'Create test order',
                    passed: createResponse.status === 201 || createResponse.status === 200,
                    error: createResponse.status === 201 || createResponse.status === 200 ? 
                           null : `Status ${createResponse.status}`
                });
                
            } catch (error) {
                results.push({
                    name: 'Data persistence',
                    passed: false,
                    error: error.message
                });
            }
        } else {
            results.push({
                name: 'Data persistence',
                passed: false,
                error: 'No auth token available'
            });
        }
        
        return results;
    }

    analyzeFailures(failedTests) {
        const issues = [];
        
        // Group failures by type
        const authFailures = failedTests.filter(t => 
            t.name.toLowerCase().includes('login') || 
            t.name.toLowerCase().includes('auth')
        );
        
        const apiFailures = failedTests.filter(t => 
            t.name.includes('API') || 
            t.name.includes('endpoint')
        );
        
        const corsFailures = failedTests.filter(t => 
            t.name.includes('CORS')
        );
        
        if (authFailures.length > 0) {
            issues.push({
                type: 'authentication',
                severity: 'high',
                tests: authFailures,
                fixAction: 'reset_auth'
            });
        }
        
        if (apiFailures.length > 2) {
            issues.push({
                type: 'api_connection',
                severity: 'high',
                tests: apiFailures,
                fixAction: 'check_backend'
            });
        }
        
        if (corsFailures.length > 0) {
            issues.push({
                type: 'cors',
                severity: 'medium',
                tests: corsFailures,
                fixAction: 'fix_cors'
            });
        }
        
        return issues;
    }

    async fixIssues(issues) {
        const fixes = [];
        
        for (const issue of issues) {
            this.log(`Fixing ${issue.type} issue...`, 'fix');
            
            let fix = {
                issue: issue.type,
                action: issue.fixAction,
                success: false
            };
            
            try {
                switch (issue.fixAction) {
                    case 'reset_auth':
                        // Clear any cached auth data
                        this.authToken = null;
                        fix.success = true;
                        fix.details = 'Cleared authentication cache';
                        break;
                        
                    case 'check_backend':
                        // Verify backend is actually running
                        const backendOk = await this.checkServices();
                        fix.success = backendOk;
                        fix.details = backendOk ? 'Backend verified' : 'Backend down';
                        break;
                        
                    case 'fix_cors':
                        // Log CORS fix instructions
                        fix.success = false;
                        fix.details = 'CORS must be fixed on backend';
                        this.log('CORS fix required: Update backend CORS configuration', 'warning');
                        break;
                        
                    default:
                        fix.details = 'Unknown fix action';
                }
                
            } catch (error) {
                fix.error = error.message;
            }
            
            fixes.push(fix);
        }
        
        return fixes;
    }

    async generateReport() {
        const reportDir = './test-results';
        await fs.mkdir(reportDir, { recursive: true });
        
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const reportPath = path.join(reportDir, `autonomous-test-${timestamp}.html`);
        
        // Calculate summary
        const allTests = this.results.cycles.flatMap(c => c.tests);
        const totalTests = allTests.length;
        const passedTests = allTests.filter(t => t.passed).length;
        const failedTests = totalTests - passedTests;
        const passRate = totalTests > 0 ? (passedTests / totalTests * 100).toFixed(1) : 0;
        
        const html = `
<!DOCTYPE html>
<html>
<head>
    <title>Coffee Cue Autonomous Test Report</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 1200px; margin: 0 auto; padding: 20px; background: #f5f5f5; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 40px; border-radius: 10px; text-align: center; margin-bottom: 30px; }
        .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 30px; }
        .card { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); text-align: center; }
        .passed { color: #10b981; }
        .failed { color: #ef4444; }
        .cycle { background: white; padding: 20px; margin: 20px 0; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .test { padding: 10px; margin: 5px 0; border-radius: 4px; display: flex; justify-content: space-between; }
        .test.passed { background: #d1fae5; }
        .test.failed { background: #fee2e2; }
        pre { background: #1f2937; color: white; padding: 20px; border-radius: 8px; overflow-x: auto; }
    </style>
</head>
<body>
    <div class="header">
        <h1>🤖 Coffee Cue Autonomous Test Report</h1>
        <p>Generated: ${new Date().toLocaleString()}</p>
    </div>
    
    <div class="summary">
        <div class="card">
            <h2>${this.results.finalStatus || 'COMPLETED'}</h2>
            <p>Final Status</p>
        </div>
        <div class="card">
            <h2>${this.results.cycles.length}</h2>
            <p>Test Cycles</p>
        </div>
        <div class="card">
            <h2 class="passed">${passedTests}</h2>
            <p>Tests Passed</p>
        </div>
        <div class="card">
            <h2 class="failed">${failedTests}</h2>
            <p>Tests Failed</p>
        </div>
        <div class="card">
            <h2>${passRate}%</h2>
            <p>Pass Rate</p>
        </div>
        <div class="card">
            <h2>${Math.round((Date.now() - this.results.startTime) / 1000)}s</h2>
            <p>Total Duration</p>
        </div>
    </div>
    
    ${this.results.cycles.map(cycle => `
        <div class="cycle">
            <h2>Cycle ${cycle.number} - ${cycle.status.toUpperCase()}</h2>
            <p>Duration: ${Math.round(cycle.duration / 1000)}s | 
               Passed: ${cycle.passedCount} | 
               Failed: ${cycle.failedCount}</p>
            
            <h3>Test Results:</h3>
            ${cycle.tests.map(test => `
                <div class="test ${test.passed ? 'passed' : 'failed'}">
                    <span>${test.name}</span>
                    <span>${test.passed ? '✅ Passed' : '❌ Failed: ' + test.error}</span>
                </div>
            `).join('')}
            
            ${cycle.fixes && cycle.fixes.length > 0 ? `
                <h3>Fixes Applied:</h3>
                ${cycle.fixes.map(fix => `
                    <div class="test ${fix.success ? 'passed' : 'failed'}">
                        <span>${fix.issue} - ${fix.action}</span>
                        <span>${fix.success ? '✅ ' + fix.details : '❌ ' + (fix.error || fix.details)}</span>
                    </div>
                `).join('')}
            ` : ''}
        </div>
    `).join('')}
    
    <h2>Test Log:</h2>
    <pre>${await fs.readFile('autonomous-test.log', 'utf8').catch(() => 'Log not available')}</pre>
</body>
</html>`;
        
        await fs.writeFile(reportPath, html);
        
        // Also save JSON
        const jsonPath = reportPath.replace('.html', '.json');
        await fs.writeFile(jsonPath, JSON.stringify(this.results, null, 2));
        
        return reportPath;
    }

    async run() {
        console.log(`
╔════════════════════════════════════════════════╗
║    🤖 FULLY AUTONOMOUS TEST SYSTEM v2.0        ║
║         No Human Intervention Required         ║
╚════════════════════════════════════════════════╝
`);

        this.log('Starting fully autonomous test system', 'info');
        
        // Clear previous log
        await fs.writeFile('autonomous-test.log', '').catch(() => {});
        
        // Check services first
        const servicesOk = await this.checkServices();
        if (!servicesOk) {
            this.log('Cannot proceed without running services', 'error');
            process.exit(1);
        }
        
        // Run test cycles
        let allPassed = false;
        
        while (this.currentCycle < this.maxRetries && !allPassed) {
            const cycle = await this.runTestCycle();
            this.results.cycles.push(cycle);
            
            if (cycle.status === 'passed') {
                allPassed = true;
                this.results.finalStatus = 'PASSED';
            } else if (cycle.status === 'fixed') {
                this.log('Retrying after fixes...', 'info');
                await this.sleep(1000);
            } else {
                this.log('Unable to fix all issues in this cycle', 'warning');
            }
        }
        
        if (!allPassed) {
            this.results.finalStatus = 'FAILED';
        }
        
        // Generate report
        this.log('Generating report...', 'info');
        const reportPath = await this.generateReport();
        
        // Final summary
        console.log(`
╔════════════════════════════════════════════════╗
║              FINAL RESULTS                     ║
╚════════════════════════════════════════════════╝

Status: ${this.results.finalStatus === 'PASSED' ? '✅ PASSED' : '❌ FAILED'}
Cycles: ${this.results.cycles.length}
Report: ${reportPath}

Opening report...
`);

        // Try to open report
        try {
            await execPromise(`open "${reportPath}"`);
        } catch (e) {
            this.log('Please open the report manually', 'info');
        }
        
        process.exit(allPassed ? 0 : 1);
    }
}

// Run immediately when script is executed
if (require.main === module) {
    const test = new FullyAutonomousTest();
    test.run().catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}

module.exports = FullyAutonomousTest;