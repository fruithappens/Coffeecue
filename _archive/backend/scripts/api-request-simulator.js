const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

// Configuration
const CONFIG = {
  baseUrl: 'http://localhost:5001', // Backend API URL
  logFile: path.join(__dirname, 'logs/live_test/api-simulation.log'),
  intervalMs: 10000, // 10 seconds between batches of requests
  requestsPerBatch: 1,
  runTimeMinutes: 60 // Run for 60 minutes by default
};

// Ensure log directory exists
const logDir = path.dirname(CONFIG.logFile);
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// Create or clear log file
fs.writeFileSync(CONFIG.logFile, `--- API Simulation Started at ${new Date().toISOString()} ---\n\n`);

// API endpoints to test
const endpoints = [
  { method: 'GET', path: '/api/ping', description: 'Simple ping endpoint' },
  { method: 'GET', path: '/api/auth/check', description: 'Auth check endpoint' },
  { method: 'GET', path: '/api/settings/app', description: 'App settings' },
  { method: 'GET', path: '/api/stations/list', description: 'Stations list' }
];

// Helper function to make HTTP request
function makeRequest(method, path) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const url = `${CONFIG.baseUrl}${path}`;
    const options = {
      method: method,
      headers: {
        'User-Agent': 'API-Simulator/1.0',
        'Accept': 'application/json'
      }
    };
    
    const client = url.startsWith('https') ? https : http;
    const req = client.request(url, options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        const endTime = Date.now();
        const duration = endTime - startTime;
        
        let responseBody;
        try {
          responseBody = JSON.parse(data);
        } catch (e) {
          responseBody = data;
        }
        
        const result = {
          timestamp: new Date().toISOString(),
          method,
          path,
          statusCode: res.statusCode,
          duration: `${duration}ms`,
          responseBody
        };
        
        resolve(result);
      });
    });
    
    req.on('error', (error) => {
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      const result = {
        timestamp: new Date().toISOString(),
        method,
        path,
        error: error.message,
        duration: `${duration}ms`
      };
      
      resolve(result); // Still resolve, but with error info
    });
    
    req.end();
  });
}

// Function to run a batch of requests
async function runRequestBatch() {
  console.log(`Running batch of ${CONFIG.requestsPerBatch} request(s) at ${new Date().toISOString()}`);
  
  const batch = [];
  
  for (let i = 0; i < CONFIG.requestsPerBatch; i++) {
    // Select a random endpoint
    const endpoint = endpoints[Math.floor(Math.random() * endpoints.length)];
    batch.push(makeRequest(endpoint.method, endpoint.path));
  }
  
  const results = await Promise.all(batch);
  
  // Log results
  results.forEach(result => {
    const logEntry = `[${result.timestamp}] ${result.method} ${result.path} - ${result.statusCode || 'ERROR'} (${result.duration})\n`;
    fs.appendFileSync(CONFIG.logFile, logEntry);
    
    const resultStr = result.error 
      ? `Error: ${result.error}` 
      : `Status: ${result.statusCode}`;
      
    console.log(`${result.method} ${result.path} - ${resultStr} (${result.duration})`);
  });
}

// Main function to run the simulator
function run() {
  const startTime = Date.now();
  const endTime = startTime + (CONFIG.runTimeMinutes * 60 * 1000);
  
  console.log(`Starting API request simulator at ${new Date().toISOString()}`);
  console.log(`Will run for ${CONFIG.runTimeMinutes} minutes (until ${new Date(endTime).toISOString()})`);
  console.log(`Logging to ${CONFIG.logFile}`);
  
  // Run first batch immediately
  runRequestBatch();
  
  // Schedule regular batches
  const intervalId = setInterval(() => {
    const now = Date.now();
    
    if (now >= endTime) {
      clearInterval(intervalId);
      fs.appendFileSync(CONFIG.logFile, `\n--- API Simulation Completed at ${new Date().toISOString()} ---\n`);
      console.log(`API simulation completed at ${new Date().toISOString()}`);
      return;
    }
    
    runRequestBatch();
  }, CONFIG.intervalMs);
  
  // Handle graceful shutdown
  process.on('SIGINT', () => {
    clearInterval(intervalId);
    fs.appendFileSync(CONFIG.logFile, `\n--- API Simulation Interrupted at ${new Date().toISOString()} ---\n`);
    console.log(`API simulation interrupted at ${new Date().toISOString()}`);
    process.exit(0);
  });
}

// Start the simulator
run();
