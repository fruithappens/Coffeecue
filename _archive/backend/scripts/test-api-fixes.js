/**
 * Test script to verify API fixes
 * Run with: node test-api-fixes.js
 */

// Simple ANSI color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m'
};

// Config
const API_BASE_URL = 'http://localhost:5001';
const TEST_ENDPOINTS = [
  { url: '/api/ping', method: 'GET', description: 'Basic ping endpoint' },
  { url: '/api/auth/check', method: 'GET', description: 'Auth check endpoint' },
  { url: '/api/settings/app', method: 'GET', description: 'App settings endpoint' },
  { url: '/api/orders/in-progress', method: 'GET', description: 'In-progress orders endpoint' },
  { url: '/api/orders/completed', method: 'GET', description: 'Completed orders endpoint' },
  { url: '/api/stations/list', method: 'GET', description: 'Stations list endpoint' }
];

// Simple HTTP client using Node.js native http/https modules
const http = require('http');
const https = require('https');
const url = require('url');

function fetchApi(requestUrl, options = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = url.parse(requestUrl);
    const client = parsedUrl.protocol === 'https:' ? https : http;
    
    const requestOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.path,
      method: options.method || 'GET',
      headers: options.headers || {
        'Accept': 'application/json'
      }
    };
    
    const req = client.request(requestOptions, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        let responseBody;
        try {
          responseBody = JSON.parse(data);
        } catch (e) {
          responseBody = data;
        }
        
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: responseBody
        });
      });
    });
    
    req.on('error', (error) => {
      reject(error);
    });
    
    if (options.body) {
      req.write(JSON.stringify(options.body));
    }
    
    req.end();
  });
}

// Test runner
async function runTests() {
  console.log(`${colors.blue}=== API Fixes Verification Test ====${colors.reset}`);
  console.log(`Testing against API server at: ${API_BASE_URL}\n`);
  
  let passCount = 0;
  let failCount = 0;
  
  // Test each endpoint
  for (const endpoint of TEST_ENDPOINTS) {
    const fullUrl = API_BASE_URL + endpoint.url;
    console.log(`${colors.yellow}Testing: ${endpoint.method} ${endpoint.url}${colors.reset}`);
    console.log(`Description: ${endpoint.description}`);
    
    try {
      const startTime = Date.now();
      const response = await fetchApi(fullUrl, { method: endpoint.method });
      const duration = Date.now() - startTime;
      
      // Check response status
      if (response.status === 200) {
        console.log(`${colors.green}✓ Success (${duration}ms)${colors.reset}`);
        passCount++;
      } else if (response.status === 401) {
        console.log(`${colors.yellow}⚠ Requires authentication (${response.status})${colors.reset}`);
        console.log('  This is expected for authenticated endpoints');
        passCount++; // Still count as pass for auth endpoints
      } else if (response.status === 404) {
        console.log(`${colors.red}× Endpoint not found (404)${colors.reset}`);
        failCount++;
      } else {
        console.log(`${colors.red}× Failed with status ${response.status}${colors.reset}`);
        failCount++;
      }
      
      // Show response preview
      console.log('  Response preview:');
      const preview = JSON.stringify(response.body).substring(0, 100);
      console.log(`  ${preview}${preview.length >= 100 ? '...' : ''}`);
    } catch (error) {
      console.log(`${colors.red}× Error: ${error.message}${colors.reset}`);
      failCount++;
    }
    
    console.log(''); // Add space between tests
  }
  
  // Output summary
  console.log(`${colors.blue}=== Test Summary ====${colors.reset}`);
  console.log(`Total Tests: ${TEST_ENDPOINTS.length}`);
  console.log(`${colors.green}Passed: ${passCount}${colors.reset}`);
  console.log(`${colors.red}Failed: ${failCount}${colors.reset}`);
  
  if (failCount === 0) {
    console.log(`\n${colors.green}All tests passed! The API fixes appear to be working.${colors.reset}`);
  } else {
    console.log(`\n${colors.yellow}Some tests failed. Further investigation may be needed.${colors.reset}`);
  }
}

// Run the tests
runTests().catch(error => {
  console.error(`${colors.red}Test runner error: ${error.message}${colors.reset}`);
});
