// Simplified test runner that checks current functionality
const http = require('http');
const fs = require('fs');

class SimpleTester {
  constructor() {
    this.results = {
      timestamp: new Date().toISOString(),
      endpoints: [],
      errors: [],
      warnings: []
    };
  }

  async testEndpoint(url, method = 'GET', data = null) {
    return new Promise((resolve) => {
      const options = {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJkZW1vX3VzZXIiLCJyb2xlIjoiYWRtaW4iLCJleHAiOjk5OTk5OTk5OTl9.valid_signature_for_offline_demo_mode'
        }
      };

      const req = http.request(url, options, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          resolve({
            url,
            status: res.statusCode,
            headers: res.headers,
            body: body
          });
        });
      });

      req.on('error', (err) => {
        resolve({
          url,
          status: 0,
          error: err.message
        });
      });

      if (data) {
        req.write(JSON.stringify(data));
      }
      req.end();
    });
  }

  async runTests() {
    console.log('🧪 Running Coffee Cue API Tests...\n');

    // Test API endpoints
    const endpoints = [
      { url: 'http://localhost:5001/api/orders', name: 'Orders' },
      { url: 'http://localhost:5001/api/stations', name: 'Stations' },
      { url: 'http://localhost:5001/api/inventory', name: 'Inventory' },
      { url: 'http://localhost:5001/api/settings', name: 'Settings' },
      { url: 'http://localhost:5001/api/schedule/today', name: 'Schedule' }
    ];

    for (const endpoint of endpoints) {
      const result = await this.testEndpoint(endpoint.url);
      console.log(`Testing ${endpoint.name}: ${result.status === 200 ? '✅' : '❌'} (${result.status})`);
      
      this.results.endpoints.push({
        name: endpoint.name,
        url: endpoint.url,
        status: result.status,
        hasData: result.body && result.body.length > 10,
        error: result.error
      });

      if (result.status !== 200) {
        this.results.errors.push(`${endpoint.name} returned ${result.status}`);
      }
    }

    // Generate report
    this.generateReport();
  }

  generateReport() {
    const report = {
      ...this.results,
      summary: {
        totalEndpoints: this.results.endpoints.length,
        successfulEndpoints: this.results.endpoints.filter(e => e.status === 200).length,
        failedEndpoints: this.results.endpoints.filter(e => e.status !== 200).length,
        errors: this.results.errors.length
      }
    };

    fs.writeFileSync('./test-results/simple-test-report.json', JSON.stringify(report, null, 2));

    console.log('\n📊 Test Summary:');
    console.log(`- Total Endpoints: ${report.summary.totalEndpoints}`);
    console.log(`- Successful: ${report.summary.successfulEndpoints}`);
    console.log(`- Failed: ${report.summary.failedEndpoints}`);
    console.log(`- Errors: ${report.summary.errors}`);

    if (report.summary.errors > 0) {
      console.log('\n❌ Errors found:');
      report.errors.forEach(err => console.log(`  - ${err}`));
    }
  }
}

// Run tests
const tester = new SimpleTester();
tester.runTests().catch(console.error);