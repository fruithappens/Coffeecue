#!/usr/bin/env node
const http = require('http');
const https = require('https');

class APITester {
    constructor() {
        this.baseUrl = 'http://localhost:5001';
        this.results = [];
        this.token = null;
    }

    async makeRequest(path, method = 'GET', data = null, headers = {}) {
        return new Promise((resolve, reject) => {
            const url = new URL(path, this.baseUrl);
            const options = {
                hostname: url.hostname,
                port: url.port,
                path: url.pathname + url.search,
                method: method,
                headers: {
                    'Content-Type': 'application/json',
                    ...headers
                }
            };

            if (this.token) {
                options.headers['Authorization'] = `Bearer ${this.token}`;
            }

            if (data) {
                const jsonData = JSON.stringify(data);
                options.headers['Content-Length'] = Buffer.byteLength(jsonData);
            }

            const req = http.request(options, (res) => {
                let responseData = '';
                res.on('data', chunk => responseData += chunk);
                res.on('end', () => {
                    try {
                        const parsed = responseData ? JSON.parse(responseData) : {};
                        resolve({
                            status: res.statusCode,
                            data: parsed,
                            headers: res.headers
                        });
                    } catch (e) {
                        resolve({
                            status: res.statusCode,
                            data: responseData,
                            headers: res.headers
                        });
                    }
                });
            });

            req.on('error', reject);

            if (data) {
                req.write(JSON.stringify(data));
            }

            req.end();
        });
    }

    async testEndpoint(name, path, expectedStatus = 200, method = 'GET', data = null) {
        console.log(`🧪 Testing ${name}...`);
        
        try {
            const response = await this.makeRequest(path, method, data);
            const success = response.status === expectedStatus;
            
            console.log(`${success ? '✅' : '❌'} ${name}: ${response.status} (expected ${expectedStatus})`);
            
            this.results.push({
                name,
                success,
                status: response.status,
                expectedStatus,
                data: response.data
            });
            
            return response;
            
        } catch (error) {
            console.log(`❌ ${name}: ${error.message}`);
            this.results.push({
                name,
                success: false,
                error: error.message
            });
            return null;
        }
    }

    async testLogin() {
        console.log('\n🔐 Testing Authentication...');
        
        const response = await this.testEndpoint(
            'Login with demo credentials',
            '/api/auth/login',
            200,
            'POST',
            { username: 'barista', password: 'barista123' }
        );
        
        if (response && response.data) {
            // Check for different token field names
            const token = response.data.access_token || response.data.token || response.data.accessToken;
            if (token) {
                this.token = token;
                console.log('✅ Token acquired successfully');
            } else {
                console.log('⚠️  No token received, testing without authentication');
                console.log('   Response data:', JSON.stringify(response.data).substring(0, 100) + '...');
            }
        } else {
            console.log('⚠️  No response data, testing without authentication');
        }
    }

    async testCoreEndpoints() {
        console.log('\n📋 Testing Core API Endpoints...');
        
        // Test basic endpoints
        await this.testEndpoint('Get orders', '/api/orders');
        await this.testEndpoint('Get stations', '/api/stations');
        await this.testEndpoint('Get inventory', '/api/inventory');
        await this.testEndpoint('Get settings', '/api/settings');
        
        // Test barista-specific endpoints
        await this.testEndpoint('Get barista orders', '/api/barista/orders');
        await this.testEndpoint('Get barista stations', '/api/barista/stations');
        
        // Test admin endpoints (might fail without admin token)
        await this.testEndpoint('Get admin settings', '/api/admin/settings', null);
        await this.testEndpoint('Get admin stations', '/api/admin/stations', null);
    }

    async testPostEndpoints() {
        console.log('\n📝 Testing POST Endpoints...');
        
        // Test creating a walk-in order
        const orderData = {
            items: [{ name: 'Cappuccino', milk: 'Oat' }],
            customer_name: 'Test Customer',
            order_type: 'walk_in'
        };
        
        await this.testEndpoint(
            'Create walk-in order',
            '/api/orders',
            201,
            'POST',
            orderData
        );
        
        // Test updating settings
        const settingsData = {
            queue_balance_enabled: true,
            ai_queue_management: false
        };
        
        await this.testEndpoint(
            'Update settings',
            '/api/settings',
            200,
            'PUT',
            settingsData
        );
    }

    generateReport() {
        console.log('\n📊 Test Summary:');
        console.log('='.repeat(50));
        
        const passed = this.results.filter(r => r.success).length;
        const failed = this.results.length - passed;
        
        console.log(`✅ Passed: ${passed}`);
        console.log(`❌ Failed: ${failed}`);
        console.log(`📋 Total: ${this.results.length}`);
        console.log(`📈 Success Rate: ${Math.round((passed / this.results.length) * 100)}%`);
        
        console.log('\n📋 Detailed Results:');
        this.results.forEach(result => {
            const status = result.success ? '✅' : '❌';
            const details = result.error || `${result.status} (expected ${result.expectedStatus})`;
            console.log(`${status} ${result.name}: ${details}`);
        });
        
        // Generate HTML report
        const htmlReport = `
<!DOCTYPE html>
<html>
<head>
    <title>Coffee Cue API Test Report</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .header { background: #2563eb; color: white; padding: 20px; border-radius: 8px; }
        .summary { display: flex; gap: 20px; margin: 20px 0; }
        .stat { background: #f3f4f6; padding: 15px; border-radius: 8px; text-align: center; }
        .test { border: 1px solid #e5e7eb; margin: 10px 0; padding: 15px; border-radius: 8px; }
        .passed { border-left: 4px solid #10b981; }
        .failed { border-left: 4px solid #ef4444; }
    </style>
</head>
<body>
    <div class="header">
        <h1>☕ Coffee Cue API Test Report</h1>
        <p>Generated: ${new Date().toLocaleString()}</p>
    </div>
    
    <div class="summary">
        <div class="stat">
            <h3>${this.results.length}</h3>
            <p>Total Tests</p>
        </div>
        <div class="stat">
            <h3>${passed}</h3>
            <p>Passed</p>
        </div>
        <div class="stat">
            <h3>${failed}</h3>
            <p>Failed</p>
        </div>
    </div>
    
    <h2>Test Results</h2>
    ${this.results.map(result => `
        <div class="test ${result.success ? 'passed' : 'failed'}">
            <h3>${result.name} ${result.success ? '✅' : '❌'}</h3>
            <p>${result.error || `Status: ${result.status} (expected ${result.expectedStatus})`}</p>
        </div>
    `).join('')}
</body>
</html>`;

        require('fs').writeFileSync('api-test-report.html', htmlReport);
        console.log('\n📄 HTML report generated: api-test-report.html');
    }

    async run() {
        console.log('🚀 Starting Coffee Cue API Tests...\n');
        
        try {
            await this.testLogin();
            await this.testCoreEndpoints();
            await this.testPostEndpoints();
            
            this.generateReport();
            
        } catch (error) {
            console.error('💥 Unexpected error:', error);
        }
    }
}

// Run the tests
if (require.main === module) {
    const tester = new APITester();
    tester.run().catch(console.error);
}

module.exports = APITester;