#!/usr/bin/env node
/**
 * Autonomous Browser Test
 * Uses the auto-test.js script already injected into the Coffee Cue app
 */

const http = require('http');
const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

class AutonomousBrowserTest {
    constructor(config = {}) {
        this.config = {
            maxRetries: config.maxRetries || 5,
            baseUrl: config.baseUrl || 'http://localhost:3000',
            apiUrl: config.apiUrl || 'http://localhost:5001',
            reportDir: config.reportDir || './test-results',
            ...config
        };
        
        this.results = {
            startTime: Date.now(),
            cycles: [],
            finalStatus: 'pending'
        };
    }

    log(message, level = 'info') {
        const timestamp = new Date().toISOString();
        const emoji = {
            info: 'ℹ️',
            success: '✅',
            error: '❌',
            warning: '⚠️'
        };
        console.log(`[${timestamp}] ${emoji[level] || '📝'} ${message}`);
    }

    async run() {
        console.log(`
╔════════════════════════════════════════════════╗
║  🤖 Coffee Cue Autonomous Browser Test System  ║
║           (Using injected auto-test)           ║
╚════════════════════════════════════════════════╝
        `);

        // Create report directory
        await fs.mkdir(this.config.reportDir, { recursive: true });

        // Check services
        const servicesOk = await this.checkServices();
        if (!servicesOk) {
            this.log('Services not running. Please start frontend and backend.', 'error');
            process.exit(1);
        }

        // Create test automation page
        const automationHtml = await this.createAutomationPage();
        this.log('Created automation control page', 'success');

        // Start local server for automation
        const server = await this.startAutomationServer(automationHtml);
        this.log('Automation server running on http://localhost:8084', 'success');

        // Open automation page
        this.log('Opening automation control page...', 'info');
        try {
            await execPromise('open http://localhost:8084');
        } catch (e) {
            this.log('Please open http://localhost:8084 in your browser', 'warning');
        }

        // Wait for results via polling
        this.log('Waiting for test results...', 'info');
        const results = await this.waitForResults();

        // Generate report
        const report = await this.generateReport(results);
        this.log(`Report generated: ${report}`, 'success');

        // Cleanup
        server.close();

        // Summary
        const passed = results.passed || 0;
        const total = results.total || 0;
        
        console.log(`
╔════════════════════════════════════════════════╗
║               Final Results                    ║
╚════════════════════════════════════════════════╝

Status: ${passed === total ? '✅ PASSED' : '❌ FAILED'}
Passed: ${passed}/${total}
Report: ${report}
        `);

        process.exit(passed === total ? 0 : 1);
    }

    async checkServices() {
        try {
            const [frontend, backend] = await Promise.all([
                fetch(this.config.baseUrl).then(r => r.ok).catch(() => false),
                fetch(`${this.config.apiUrl}/api/orders`).then(r => true).catch(() => false)
            ]);
            
            if (!frontend) this.log('Frontend not accessible', 'error');
            if (!backend) this.log('Backend not accessible', 'error');
            
            return frontend && backend;
        } catch (e) {
            return false;
        }
    }

    async createAutomationPage() {
        return `
<!DOCTYPE html>
<html>
<head>
    <title>Coffee Cue Autonomous Test Controller</title>
    <style>
        body { font-family: Arial, sans-serif; padding: 40px; background: #f5f5f5; }
        .container { max-width: 800px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        h1 { color: #2563eb; text-align: center; }
        .status { padding: 20px; margin: 20px 0; border-radius: 8px; text-align: center; font-size: 18px; }
        .running { background: #fef3c7; color: #92400e; }
        .success { background: #d1fae5; color: #065f46; }
        .failed { background: #fee2e2; color: #991b1b; }
        .log { background: #1f2937; color: #fff; padding: 20px; border-radius: 8px; font-family: monospace; font-size: 12px; height: 400px; overflow-y: auto; }
        button { background: #3b82f6; color: white; padding: 12px 24px; border: none; border-radius: 6px; cursor: pointer; font-size: 16px; }
        button:hover { background: #2563eb; }
        .hidden { display: none; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🤖 Autonomous Test Controller</h1>
        
        <div id="status" class="status running">
            Initializing autonomous test system...
        </div>
        
        <div style="text-align: center; margin: 20px 0;">
            <button onclick="startTests()" id="startBtn">Start Autonomous Tests</button>
        </div>
        
        <div class="log" id="log"></div>
        
        <div id="results" class="hidden">
            <h2>Test Results</h2>
            <pre id="resultsContent"></pre>
        </div>
    </div>

    <script>
        let testWindow = null;
        let testResults = null;
        let checkInterval = null;

        function log(message, type = 'info') {
            const logDiv = document.getElementById('log');
            const time = new Date().toLocaleTimeString();
            const entry = document.createElement('div');
            entry.style.color = type === 'error' ? '#ef4444' : type === 'success' ? '#10b981' : '#94a3b8';
            entry.textContent = \`[\${time}] \${message}\`;
            logDiv.appendChild(entry);
            logDiv.scrollTop = logDiv.scrollHeight;
        }

        function updateStatus(message, type = 'running') {
            const status = document.getElementById('status');
            status.textContent = message;
            status.className = \`status \${type}\`;
        }

        async function startTests() {
            document.getElementById('startBtn').disabled = true;
            updateStatus('Opening Coffee Cue application...', 'running');
            log('Starting autonomous test sequence', 'info');

            // Open app with auto-test enabled
            testWindow = window.open('${this.config.baseUrl}?autotest=true', 'coffeeTest', 'width=1200,height=800');
            
            if (!testWindow) {
                log('Failed to open test window. Please allow popups.', 'error');
                updateStatus('Failed to open test window', 'failed');
                return;
            }

            log('Test window opened', 'success');
            log('Waiting for app to load...', 'info');

            // Monitor for results
            setTimeout(() => {
                log('Tests should be running in the Coffee Cue window', 'info');
                log('Monitoring for results...', 'info');
                startMonitoring();
            }, 5000);
        }

        function startMonitoring() {
            let attempts = 0;
            const maxAttempts = 60; // 1 minute timeout

            checkInterval = setInterval(async () => {
                attempts++;
                
                try {
                    // Try to get results from the test window
                    const results = testWindow.localStorage.getItem('coffee_auto_test_results');
                    
                    if (results) {
                        testResults = JSON.parse(results);
                        log('Test results received!', 'success');
                        processResults(testResults);
                        clearInterval(checkInterval);
                        return;
                    }
                } catch (e) {
                    // Cross-origin, try alternative method
                }

                if (attempts >= maxAttempts) {
                    log('Test timeout - no results received', 'error');
                    updateStatus('Test timeout', 'failed');
                    clearInterval(checkInterval);
                }
            }, 1000);
        }

        function processResults(results) {
            const passed = results.passed || 0;
            const total = results.total || 0;
            const failed = results.failed || 0;

            log(\`Tests complete: \${passed}/\${total} passed\`, passed === total ? 'success' : 'error');
            
            if (results.results) {
                results.results.forEach(r => {
                    if (r.type === 'success' || r.type === 'error') {
                        log(r.message, r.type);
                    }
                });
            }

            updateStatus(
                \`Tests Complete: \${passed}/\${total} passed\`,
                passed === total ? 'success' : 'failed'
            );

            // Send results to server
            fetch('/results', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(results)
            });

            // Show results
            document.getElementById('results').classList.remove('hidden');
            document.getElementById('resultsContent').textContent = JSON.stringify(results, null, 2);
        }

        // Auto-start on load
        window.onload = () => {
            log('Automation controller ready', 'success');
            log('Click "Start Autonomous Tests" to begin', 'info');
        };
    </script>
</body>
</html>`;
    }

    async startAutomationServer(html) {
        return new Promise((resolve) => {
            const server = http.createServer((req, res) => {
                if (req.url === '/') {
                    res.writeHead(200, { 'Content-Type': 'text/html' });
                    res.end(html);
                } else if (req.url === '/results' && req.method === 'POST') {
                    let body = '';
                    req.on('data', chunk => body += chunk);
                    req.on('end', () => {
                        this.testResults = JSON.parse(body);
                        res.writeHead(200);
                        res.end('OK');
                    });
                } else {
                    res.writeHead(404);
                    res.end('Not found');
                }
            });

            server.listen(8084, () => {
                resolve(server);
            });
        });
    }

    async waitForResults() {
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                resolve({ total: 0, passed: 0, failed: 0, timeout: true });
            }, 120000); // 2 minute timeout

            const checkInterval = setInterval(() => {
                if (this.testResults) {
                    clearTimeout(timeout);
                    clearInterval(checkInterval);
                    resolve(this.testResults);
                }
            }, 1000);
        });
    }

    async generateReport(results) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const reportPath = path.join(this.config.reportDir, `autonomous-browser-test-${timestamp}.html`);
        
        const html = `
<!DOCTYPE html>
<html>
<head>
    <title>Coffee Cue Test Report</title>
    <style>
        body { font-family: Arial, sans-serif; padding: 40px; max-width: 800px; margin: 0 auto; }
        .header { background: #2563eb; color: white; padding: 30px; border-radius: 10px; text-align: center; }
        .summary { display: flex; gap: 20px; margin: 30px 0; }
        .card { background: #f3f4f6; padding: 20px; border-radius: 8px; flex: 1; text-align: center; }
        .passed { color: #10b981; }
        .failed { color: #ef4444; }
        pre { background: #1f2937; color: white; padding: 20px; border-radius: 8px; overflow-x: auto; }
    </style>
</head>
<body>
    <div class="header">
        <h1>Coffee Cue Autonomous Test Report</h1>
        <p>${new Date().toLocaleString()}</p>
    </div>
    
    <div class="summary">
        <div class="card">
            <h2>${results.total || 0}</h2>
            <p>Total Tests</p>
        </div>
        <div class="card">
            <h2 class="passed">${results.passed || 0}</h2>
            <p>Passed</p>
        </div>
        <div class="card">
            <h2 class="failed">${results.failed || 0}</h2>
            <p>Failed</p>
        </div>
    </div>
    
    <h2>Test Details</h2>
    <pre>${JSON.stringify(results, null, 2)}</pre>
</body>
</html>`;

        await fs.writeFile(reportPath, html);
        
        // Also save JSON
        const jsonPath = reportPath.replace('.html', '.json');
        await fs.writeFile(jsonPath, JSON.stringify(results, null, 2));
        
        return reportPath;
    }
}

// Run if called directly
if (require.main === module) {
    const test = new AutonomousBrowserTest();
    test.run().catch(console.error);
}

module.exports = AutonomousBrowserTest;