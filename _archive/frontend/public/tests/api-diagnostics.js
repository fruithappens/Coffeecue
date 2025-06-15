// API Diagnostics Tool
// This script helps diagnose CORS and API connectivity issues

(function() {
  console.log('API Diagnostics Tool loaded');
  
  // Test endpoints
  const ENDPOINTS = [
    'http://localhost:5001/api/test',
    'http://localhost:5001/api/stations',
    'http://localhost:5001/api/settings',
    'http://localhost:5001/api/orders/pending'
  ];
  
  // Store results
  const results = {
    timestamp: new Date().toISOString(),
    tests: [],
    summary: {}
  };
  
  // Run tests
  async function runTests() {
    console.log('Starting API diagnostics...');
    document.getElementById('status').textContent = 'Running tests...';
    
    let successCount = 0;
    let failCount = 0;
    let corsIssues = 0;
    
    for (const endpoint of ENDPOINTS) {
      try {
        console.log(`Testing endpoint: ${endpoint}`);
        document.getElementById('current-test').textContent = endpoint;
        
        const result = await testEndpoint(endpoint);
        results.tests.push(result);
        
        if (result.success) {
          successCount++;
        } else {
          failCount++;
          if (result.error && result.error.includes('CORS')) {
            corsIssues++;
          }
        }
        
        // Update UI
        const resultsList = document.getElementById('results');
        const item = document.createElement('li');
        item.className = result.success ? 'success' : 'error';
        item.innerHTML = `
          <strong>${endpoint}</strong>: ${result.success ? 'SUCCESS' : 'FAILED'} 
          ${result.status ? `(Status: ${result.status})` : ''}
          ${result.error ? `<br><span class="error-details">${result.error}</span>` : ''}
          ${result.data ? `<br><pre>${JSON.stringify(result.data, null, 2)}</pre>` : ''}
        `;
        resultsList.appendChild(item);
        
      } catch (e) {
        console.error(`Error running test for ${endpoint}:`, e);
      }
    }
    
    // Update summary
    results.summary = {
      total: ENDPOINTS.length,
      success: successCount,
      failed: failCount,
      corsIssues: corsIssues
    };
    
    // Update UI
    document.getElementById('status').textContent = 'Tests completed';
    document.getElementById('current-test').textContent = '';
    document.getElementById('summary').textContent = 
      `Total: ${results.summary.total}, Successful: ${results.summary.success}, Failed: ${results.summary.failed}, CORS Issues: ${results.summary.corsIssues}`;
    
    console.log('API diagnostics complete:', results);
    
    // Show cors fix section if needed
    if (corsIssues > 0) {
      document.getElementById('cors-fix').style.display = 'block';
    }
  }
  
  async function testEndpoint(url) {
    const testResult = {
      url: url,
      timestamp: new Date().toISOString(),
      success: false,
      data: null,
      status: null,
      error: null
    };
    
    try {
      // First try a preflight OPTIONS request
      try {
        const preflightResponse = await fetch(url, {
          method: 'OPTIONS',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          }
        });
        
        testResult.preflight = {
          status: preflightResponse.status,
          headers: {
            'access-control-allow-origin': preflightResponse.headers.get('access-control-allow-origin'),
            'access-control-allow-methods': preflightResponse.headers.get('access-control-allow-methods'),
            'access-control-allow-headers': preflightResponse.headers.get('access-control-allow-headers')
          }
        };
      } catch (preflightError) {
        testResult.preflight = {
          error: preflightError.message
        };
      }
      
      // Now try the actual request
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        }
      });
      
      testResult.status = response.status;
      
      if (response.status >= 200 && response.status < 300) {
        testResult.success = true;
        testResult.data = await response.json();
      } else {
        try {
          testResult.data = await response.json();
        } catch (e) {
          testResult.error = await response.text();
        }
      }
    } catch (error) {
      testResult.error = error.toString();
      // Check for CORS errors
      if (error.message && error.message.includes('CORS')) {
        testResult.corsIssue = true;
      }
    }
    
    return testResult;
  }
  
  // Wait for DOM to be ready
  window.addEventListener('DOMContentLoaded', () => {
    const testButton = document.getElementById('run-tests');
    if (testButton) {
      testButton.addEventListener('click', runTests);
    }
    
    const copyButton = document.getElementById('copy-results');
    if (copyButton) {
      copyButton.addEventListener('click', () => {
        const resultsText = JSON.stringify(results, null, 2);
        navigator.clipboard.writeText(resultsText).then(() => {
          alert('Results copied to clipboard');
        });
      });
    }
  });
})();