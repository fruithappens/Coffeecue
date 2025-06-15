const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const config = require('../config/testConfig');

class MonitoringDashboard {
  constructor() {
    this.app = express();
    this.server = http.createServer(this.app);
    this.io = socketIo(this.server, {
      cors: {
        origin: "*",
        methods: ["GET", "POST"]
      }
    });

    this.setupMiddleware();
    this.setupRoutes();
    this.setupSocketHandlers();

    this.testData = {
      status: 'idle',
      currentTest: null,
      completedTests: [],
      consoleLogs: [],
      networkLogs: [],
      databaseQueries: [],
      errors: [],
      clickedButtons: [],
      testedInputs: [],
      screenshots: [],
      startTime: null,
      endTime: null
    };
  }

  setupMiddleware() {
    this.app.use(cors());
    this.app.use(express.json());
    this.app.use(express.static(path.join(__dirname, '../public')));
  }

  setupRoutes() {
    // Serve dashboard HTML
    this.app.get('/', (req, res) => {
      res.send(this.getDashboardHTML());
    });

    // API endpoints
    this.app.get('/api/status', (req, res) => {
      res.json(this.testData);
    });

    this.app.get('/api/logs/console', (req, res) => {
      res.json(this.testData.consoleLogs);
    });

    this.app.get('/api/logs/network', (req, res) => {
      res.json(this.testData.networkLogs);
    });

    this.app.get('/api/logs/database', (req, res) => {
      res.json(this.testData.databaseQueries);
    });

    this.app.get('/api/errors', (req, res) => {
      res.json(this.testData.errors);
    });
  }

  setupSocketHandlers() {
    this.io.on('connection', (socket) => {
      console.log('Dashboard client connected');
      
      // Send current state
      socket.emit('initial-state', this.testData);
      
      socket.on('disconnect', () => {
        console.log('Dashboard client disconnected');
      });
    });
  }

  getDashboardHTML() {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Coffee Cue Test Monitor</title>
    <script src="https://cdn.socket.io/4.5.4/socket.io.min.js"></script>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            margin: 0;
            padding: 0;
            background: #f5f5f5;
        }
        
        .header {
            background: #2c3e50;
            color: white;
            padding: 1rem;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        
        .container {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 1rem;
            padding: 1rem;
            max-width: 1400px;
            margin: 0 auto;
        }
        
        .panel {
            background: white;
            border-radius: 8px;
            padding: 1rem;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        
        .panel h2 {
            margin-top: 0;
            color: #2c3e50;
            border-bottom: 2px solid #3498db;
            padding-bottom: 0.5rem;
        }
        
        .status-indicator {
            display: inline-block;
            width: 12px;
            height: 12px;
            border-radius: 50%;
            margin-right: 0.5rem;
        }
        
        .status-idle { background: #95a5a6; }
        .status-running { background: #3498db; animation: pulse 1s infinite; }
        .status-success { background: #2ecc71; }
        .status-error { background: #e74c3c; }
        
        @keyframes pulse {
            0% { opacity: 1; }
            50% { opacity: 0.5; }
            100% { opacity: 1; }
        }
        
        .log-entry {
            padding: 0.5rem;
            margin: 0.25rem 0;
            background: #f8f9fa;
            border-left: 3px solid #3498db;
            font-family: 'Courier New', monospace;
            font-size: 0.9em;
            word-wrap: break-word;
        }
        
        .log-error { border-left-color: #e74c3c; background: #fff5f5; }
        .log-warning { border-left-color: #f39c12; background: #fffaf0; }
        .log-success { border-left-color: #2ecc71; background: #f0fff4; }
        
        .metric {
            display: flex;
            justify-content: space-between;
            padding: 0.5rem 0;
            border-bottom: 1px solid #ecf0f1;
        }
        
        .metric-value {
            font-weight: bold;
            color: #2c3e50;
        }
        
        .progress-bar {
            width: 100%;
            height: 20px;
            background: #ecf0f1;
            border-radius: 10px;
            overflow: hidden;
            margin: 1rem 0;
        }
        
        .progress-fill {
            height: 100%;
            background: #3498db;
            transition: width 0.3s ease;
        }
        
        .log-container {
            max-height: 300px;
            overflow-y: auto;
            border: 1px solid #ecf0f1;
            border-radius: 4px;
            padding: 0.5rem;
        }
        
        .test-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
            gap: 0.5rem;
            margin-top: 1rem;
        }
        
        .test-item {
            padding: 0.5rem;
            background: #ecf0f1;
            border-radius: 4px;
            text-align: center;
        }
        
        .test-item.completed { background: #d4edda; }
        .test-item.failed { background: #f8d7da; }
        .test-item.running { background: #cce5ff; }
    </style>
</head>
<body>
    <div class="header">
        <h1>☕ Coffee Cue Test Monitor</h1>
        <div id="status">
            <span class="status-indicator status-idle"></span>
            <span id="status-text">Idle</span>
        </div>
    </div>

    <div class="container">
        <div class="panel">
            <h2>Test Progress</h2>
            <div class="progress-bar">
                <div class="progress-fill" id="progress" style="width: 0%"></div>
            </div>
            <div id="test-metrics">
                <div class="metric">
                    <span>Total Tests</span>
                    <span class="metric-value" id="total-tests">0</span>
                </div>
                <div class="metric">
                    <span>Completed</span>
                    <span class="metric-value" id="completed-tests">0</span>
                </div>
                <div class="metric">
                    <span>Errors</span>
                    <span class="metric-value" id="error-count">0</span>
                </div>
                <div class="metric">
                    <span>Duration</span>
                    <span class="metric-value" id="duration">0s</span>
                </div>
            </div>
        </div>

        <div class="panel">
            <h2>Current Activity</h2>
            <div id="current-test">No test running</div>
            <div class="test-grid" id="recent-actions"></div>
        </div>

        <div class="panel">
            <h2>Console Logs</h2>
            <div class="log-container" id="console-logs"></div>
        </div>

        <div class="panel">
            <h2>Network Activity</h2>
            <div class="log-container" id="network-logs"></div>
        </div>

        <div class="panel">
            <h2>Database Queries</h2>
            <div class="log-container" id="database-logs"></div>
        </div>

        <div class="panel">
            <h2>Errors & Warnings</h2>
            <div class="log-container" id="error-logs"></div>
        </div>
    </div>

    <script>
        const socket = io();
        let startTime = null;

        socket.on('initial-state', (data) => {
            updateDashboard(data);
        });

        socket.on('test-update', (data) => {
            updateDashboard(data);
        });

        socket.on('console-log', (log) => {
            addConsoleLog(log);
        });

        socket.on('network-log', (log) => {
            addNetworkLog(log);
        });

        socket.on('database-query', (query) => {
            addDatabaseQuery(query);
        });

        socket.on('error', (error) => {
            addError(error);
        });

        socket.on('test-started', (data) => {
            startTime = new Date();
            updateStatus('running', 'Running: ' + data.name);
        });

        socket.on('test-completed', (data) => {
            addCompletedTest(data);
        });

        function updateDashboard(data) {
            // Update metrics
            document.getElementById('total-tests').textContent = data.completedTests.length;
            document.getElementById('completed-tests').textContent = data.completedTests.filter(t => t.success).length;
            document.getElementById('error-count').textContent = data.errors.length;
            
            // Update progress
            const progress = data.completedTests.length > 0 ? 
                (data.completedTests.filter(t => t.success).length / data.completedTests.length) * 100 : 0;
            document.getElementById('progress').style.width = progress + '%';
            
            // Update status
            updateStatus(data.status, data.currentTest || 'Idle');
            
            // Update duration
            if (startTime) {
                const duration = Math.floor((new Date() - startTime) / 1000);
                document.getElementById('duration').textContent = duration + 's';
            }
        }

        function updateStatus(status, text) {
            const indicator = document.querySelector('.status-indicator');
            indicator.className = 'status-indicator status-' + status;
            document.getElementById('status-text').textContent = text;
        }

        function addConsoleLog(log) {
            const container = document.getElementById('console-logs');
            const entry = document.createElement('div');
            entry.className = 'log-entry log-' + log.type;
            entry.textContent = \`[\${new Date(log.timestamp).toLocaleTimeString()}] \${log.text}\`;
            container.appendChild(entry);
            container.scrollTop = container.scrollHeight;
        }

        function addNetworkLog(log) {
            const container = document.getElementById('network-logs');
            const entry = document.createElement('div');
            entry.className = 'log-entry';
            const status = log.status ? \` [\${log.status}]\` : '';
            entry.textContent = \`[\${new Date(log.timestamp).toLocaleTimeString()}] \${log.method || 'RESPONSE'} \${log.url}\${status}\`;
            container.appendChild(entry);
            container.scrollTop = container.scrollHeight;
        }

        function addDatabaseQuery(query) {
            const container = document.getElementById('database-logs');
            const entry = document.createElement('div');
            entry.className = 'log-entry ' + (query.success ? 'log-success' : 'log-error');
            entry.textContent = \`[\${new Date(query.timestamp).toLocaleTimeString()}] \${query.query} (\${query.duration}ms)\`;
            container.appendChild(entry);
            container.scrollTop = container.scrollHeight;
        }

        function addError(error) {
            const container = document.getElementById('error-logs');
            const entry = document.createElement('div');
            entry.className = 'log-entry log-error';
            entry.textContent = \`[\${new Date(error.timestamp).toLocaleTimeString()}] \${error.message}\`;
            container.appendChild(entry);
            container.scrollTop = container.scrollHeight;
        }

        function addCompletedTest(test) {
            const container = document.getElementById('recent-actions');
            const entry = document.createElement('div');
            entry.className = 'test-item ' + (test.success ? 'completed' : 'failed');
            entry.textContent = test.name;
            container.appendChild(entry);
        }

        // Auto-refresh metrics every second
        setInterval(() => {
            if (startTime) {
                const duration = Math.floor((new Date() - startTime) / 1000);
                document.getElementById('duration').textContent = duration + 's';
            }
        }, 1000);
    </script>
</body>
</html>
    `;
  }

  start() {
    const port = config.monitoring.dashboardPort;
    this.server.listen(port, () => {
      console.log(`Monitoring dashboard running at http://localhost:${port}`);
    });
  }

  updateTestData(type, data) {
    switch (type) {
      case 'test-started':
        this.testData.status = 'running';
        this.testData.currentTest = data.name;
        this.testData.startTime = new Date();
        break;
      
      case 'test-completed':
        this.testData.completedTests.push(data);
        break;
      
      case 'console-log':
        this.testData.consoleLogs.push(data);
        break;
      
      case 'network-log':
        this.testData.networkLogs.push(data);
        break;
      
      case 'database-query':
        this.testData.databaseQueries.push(data);
        break;
      
      case 'error':
        this.testData.errors.push(data);
        break;
      
      case 'button-clicked':
        this.testData.clickedButtons.push(data);
        break;
      
      case 'input-tested':
        this.testData.testedInputs.push(data);
        break;
    }

    // Emit update to all connected clients
    this.io.emit('test-update', this.testData);
    this.io.emit(type, data);
  }

  reset() {
    this.testData = {
      status: 'idle',
      currentTest: null,
      completedTests: [],
      consoleLogs: [],
      networkLogs: [],
      databaseQueries: [],
      errors: [],
      clickedButtons: [],
      testedInputs: [],
      screenshots: [],
      startTime: null,
      endTime: null
    };
    this.io.emit('test-update', this.testData);
  }
}

module.exports = MonitoringDashboard;