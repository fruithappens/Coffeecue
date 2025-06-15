const http = require('http');
const fs = require('fs');
const path = require('path');

// Config
const PORT = 3034;
const API_LOG_FILE = process.argv[2] || path.join(__dirname, 'logs/live_test/api-traffic.log');

// Ensure log directory exists
const logDir = path.dirname(API_LOG_FILE);
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// Create or clear log file
fs.writeFileSync(API_LOG_FILE, '--- API Traffic Monitor Started ---\n');

// Create request logger
function logRequest(req, res, reqBody = '') {
  const startTime = Date.now();
  const originalEnd = res.end;
  let resBody = '';
  
  // Capture response body
  res.end = function(chunk) {
    if (chunk) {
      resBody += chunk.toString();
    }
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    // Format log entry
    const logEntry = {
      timestamp: new Date().toISOString(),
      method: req.method,
      url: req.url,
      requestHeaders: req.headers,
      requestBody: reqBody,
      responseStatus: res.statusCode,
      responseHeaders: res.getHeaders(),
      responseBody: resBody,
      duration: duration + 'ms'
    };
    
    // Write to log file
    fs.appendFileSync(API_LOG_FILE, JSON.stringify(logEntry, null, 2) + ',\n');
    console.log(`API call: ${req.method} ${req.url} - ${res.statusCode} (${duration}ms)`);
    
    originalEnd.apply(res, arguments);
  };
}

// Create server
const server = http.createServer((req, res) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.statusCode = 200;
    res.end();
    return;
  }
  
  // Handle log endpoint
  if (req.method === 'POST' && req.url === '/api-log') {
    let body = '';
    
    req.on('data', chunk => {
      body += chunk.toString();
    });
    
    req.on('end', () => {
      try {
        logRequest(req, res, body);
        res.statusCode = 200;
        res.end('API log received');
      } catch (e) {
        console.error('Error processing API log:', e);
        res.statusCode = 500;
        res.end('Error processing API log');
      }
    });
  }
  // Handle status endpoint
  else if (req.method === 'GET' && req.url === '/status') {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ status: 'running', logFile: API_LOG_FILE }));
  }
  else {
    res.statusCode = 404;
    res.end('Not found');
  }
});

// Start server
server.listen(PORT, () => {
  console.log(`API traffic monitor running at http://localhost:${PORT}`);
  console.log(`API logs are being written to: ${API_LOG_FILE}`);
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('API monitor shutting down...');
  fs.appendFileSync(API_LOG_FILE, '--- API Traffic Monitor Ended ---\n');
  server.close(() => {
    console.log('API monitor stopped');
    process.exit(0);
  });
});
