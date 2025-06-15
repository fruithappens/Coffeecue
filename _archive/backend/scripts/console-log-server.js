const http = require('http');
const fs = require('fs');
const path = require('path');

// Config
const PORT = 3033;
const LOG_FILE = process.argv[2] || path.join(__dirname, 'logs/live_test/console.log');

// Ensure log directory exists
const logDir = path.dirname(LOG_FILE);
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// Create or clear log file
fs.writeFileSync(LOG_FILE, '--- Console Log Capture Started ---\n');

// Create server
const server = http.createServer((req, res) => {
  // Set CORS headers for all responses
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
  if (req.method === 'POST' && req.url === '/log') {
    let body = '';
    
    req.on('data', chunk => {
      body += chunk.toString();
    });
    
    req.on('end', () => {
      try {
        const logData = JSON.parse(body);
        const logEntry = `[${logData.timestamp}] [${logData.level}] ${logData.message}\n`;
        
        // Write to log file
        fs.appendFileSync(LOG_FILE, logEntry);
        console.log(`Log entry: ${logData.level} - ${logData.message.substring(0, 100)}${logData.message.length > 100 ? '...' : ''}`);
        
        res.statusCode = 200;
        res.end('Log received');
      } catch (e) {
        console.error('Error processing log:', e);
        res.statusCode = 400;
        res.end('Error processing log');
      }
    });
  } 
  // Handle status check
  else if (req.method === 'GET' && req.url === '/status') {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ status: 'running', logFile: LOG_FILE }));
  }
  else {
    res.statusCode = 404;
    res.end('Not found');
  }
});

// Start server
server.listen(PORT, () => {
  console.log(`Console log capture server running at http://localhost:${PORT}`);
  console.log(`Logs are being written to: ${LOG_FILE}`);
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('Log server shutting down...');
  fs.appendFileSync(LOG_FILE, '--- Console Log Capture Ended ---\n');
  server.close(() => {
    console.log('Log server stopped');
    process.exit(0);
  });
});
