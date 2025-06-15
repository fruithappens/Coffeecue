#!/bin/bash

# Set colors for better readability
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}==================================================${NC}"
echo -e "${BLUE}     COFFEE CUE SYSTEM - LIVE TEST ENVIRONMENT    ${NC}"
echo -e "${BLUE}==================================================${NC}"

# Function to check if a process is running on a port
is_port_in_use() {
  lsof -i:"$1" >/dev/null 2>&1
  return $?
}

# Create logs directory if it doesn't exist
LOGS_DIR="/Users/stevewf/expresso/logs/live_test"
mkdir -p "$LOGS_DIR"

# Start console log capture
echo -e "${YELLOW}Setting up browser console log capture...${NC}"
CONSOLE_LOG_FILE="$LOGS_DIR/console-$(date +%Y%m%d-%H%M%S).log"
touch "$CONSOLE_LOG_FILE"
echo "Browser console logs will be saved to: $CONSOLE_LOG_FILE"

# Create a web console log capture script
CONSOLE_CAPTURE_FILE="/Users/stevewf/expresso/Barista Front End/public/console-capture.js"
cat > "$CONSOLE_CAPTURE_FILE" << 'EOF'
// Console log capture script
(function() {
  // Store original console methods
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;
  const originalInfo = console.info;
  
  // Function to send log to server
  function sendLogToServer(level, args) {
    try {
      const logData = {
        timestamp: new Date().toISOString(),
        level: level,
        message: Array.from(args).map(arg => {
          try {
            return typeof arg === 'object' ? JSON.stringify(arg) : String(arg);
          } catch (e) {
            return 'Unstringifiable value';
          }
        }).join(' '),
        url: window.location.href,
        userAgent: navigator.userAgent
      };
      
      // Send log to our log server
      fetch('http://localhost:3033/log', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(logData),
        // Use no-cors mode to avoid CORS issues during testing
        mode: 'no-cors'
      }).catch(e => {
        // If logging server is down, we don't want to create a loop
        originalLog('Failed to send log to server:', e);
      });
    } catch (e) {
      // Don't let logging break the application
      originalLog('Error in log capture:', e);
    }
  }
  
  // Override console methods
  console.log = function() {
    sendLogToServer('log', arguments);
    originalLog.apply(console, arguments);
  };
  
  console.error = function() {
    sendLogToServer('error', arguments);
    originalError.apply(console, arguments);
  };
  
  console.warn = function() {
    sendLogToServer('warn', arguments);
    originalWarn.apply(console, arguments);
  };
  
  console.info = function() {
    sendLogToServer('info', arguments);
    originalInfo.apply(console, arguments);
  };
  
  // Add to window.onerror to catch uncaught exceptions
  window.addEventListener('error', function(event) {
    sendLogToServer('uncaught', [
      'Uncaught error: ' + event.message,
      'at ' + event.filename + ':' + event.lineno + ':' + event.colno,
      event.error ? event.error.stack : 'No stack trace available'
    ]);
  });
  
  // Report successful setup
  console.log('Console log capture initialized. Logs will be sent to localhost:3033/log');
})();
EOF

# Create simple Node.js log server
LOG_SERVER_FILE="/Users/stevewf/expresso/console-log-server.js"
cat > "$LOG_SERVER_FILE" << 'EOF'
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
EOF

# Create API monitor script
API_MONITOR_FILE="/Users/stevewf/expresso/api-monitor.js"
cat > "$API_MONITOR_FILE" << 'EOF'
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
EOF

# Create a script to analyze and search for hardcoded names/data
DATA_ANALYZER_FILE="/Users/stevewf/expresso/data-analyzer.js"
cat > "$DATA_ANALYZER_FILE" << 'EOF'
const fs = require('fs');
const path = require('path');

// Configuration
const sourceDirs = [
  path.join(__dirname, 'Barista Front End/src'),
  path.join(__dirname, 'services'),
  path.join(__dirname, 'routes')
];
const outputFile = path.join(__dirname, 'logs/live_test/hardcoded-data-analysis.md');

// Common name patterns to check for
const namePatterns = [
  /\b[A-Z][a-z]+ [A-Z][a-z]+\b/g,  // Basic First Last name pattern
  /\b[A-Z][a-z]+\b/g,              // First names
  /['"]name['"]\s*:\s*['"][A-Z][a-z]+['"]/g, // name: "Name" in JSON/objects
  /customerName\s*[:=]\s*['"][A-Z][a-z]+['"]/g, // customerName: "Name"
  /userName\s*[:=]\s*['"][A-Z][a-z]+['"]/g, // userName: "Name"
  /\bemail\s*[:=]\s*['"][^@]+@[^@]+\.[^@]+['"]/g, // email matches
  /\bphone\s*[:=]\s*['"][\d\s\-\(\)]+['"]/g, // phone number matches
];

// Ignore patterns (common false positives or legitimate uses)
const ignorePatterns = [
  /import/,  // Ignore import statements
  /from ['"]react['"]/,  // Ignore react imports
  /PropTypes\./,  // Ignore PropType definitions
  /\.defaultProps/,  // Ignore default props
  /\bif\s*\(/,  // Ignore if statements
  /\/\//,  // Ignore comments
  /\* /,  // Ignore JSDoc or multi-line comments
  /README/i,  // Ignore README files
  /CHANGELOG/i,  // Ignore CHANGELOG files
  /LICENSE/i,  // Ignore LICENSE files
  /console\.log\(/,  // Ignore console logs
  /Demo/,  // Ignore Demo data that's explicitly marked
  /Sample/,  // Ignore Sample data that's explicitly marked
  /Test/i,  // Ignore test-related content
  /Mock/i,  // Ignore mock data
  /placeholder/i,  // Ignore placeholders
  /example/i,  // Ignore examples
];

// Function to check if a line should be ignored
function shouldIgnore(line) {
  return ignorePatterns.some(pattern => pattern.test(line));
}

// Function to analyze a file for potential hardcoded data
function analyzeFile(filePath) {
  const fileContent = fs.readFileSync(filePath, 'utf8');
  const lines = fileContent.split('\n');
  const findings = [];

  lines.forEach((line, index) => {
    // Skip if line matches ignore patterns
    if (shouldIgnore(line)) return;

    // Check for potential names or personal data
    namePatterns.forEach(pattern => {
      const matches = line.match(pattern);
      if (matches) {
        matches.forEach(match => {
          findings.push({
            file: filePath,
            line: index + 1,
            content: line.trim(),
            match: match,
            pattern: pattern.toString()
          });
        });
      }
    });
  });

  return findings;
}

// Function to recursively scan directory
function scanDirectory(dir) {
  let findings = [];
  const files = fs.readdirSync(dir);

  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stats = fs.statSync(filePath);

    if (stats.isDirectory()) {
      // Skip node_modules and build directories
      if (file !== 'node_modules' && file !== 'build' && file !== 'dist' && !file.startsWith('.')) {
        findings = findings.concat(scanDirectory(filePath));
      }
    } else if (stats.isFile()) {
      // Only analyze JavaScript, JSX, TS, TSX, and Python files
      if (/\.(js|jsx|ts|tsx|py)$/.test(file)) {
        findings = findings.concat(analyzeFile(filePath));
      }
    }
  });

  return findings;
}

// Main function
function main() {
  console.log('Starting scan for potentially hardcoded data...');
  
  let allFindings = [];
  
  // Scan each source directory
  sourceDirs.forEach(dir => {
    if (fs.existsSync(dir)) {
      console.log(`Scanning ${dir}...`);
      const findings = scanDirectory(dir);
      allFindings = allFindings.concat(findings);
      console.log(`Found ${findings.length} potential issues in ${dir}`);
    } else {
      console.log(`Directory ${dir} does not exist, skipping`);
    }
  });
  
  // Create output directory if it doesn't exist
  const outputDir = path.dirname(outputFile);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  // Generate report
  let report = `# Hardcoded Data Analysis Report

## Summary
Total potential issues found: ${allFindings.length}

## Findings

`;

  // Group findings by file
  const fileGroups = {};
  allFindings.forEach(finding => {
    if (!fileGroups[finding.file]) {
      fileGroups[finding.file] = [];
    }
    fileGroups[finding.file].push(finding);
  });

  // Add findings to report
  Object.keys(fileGroups).forEach(file => {
    const relativePath = path.relative(__dirname, file);
    report += `### ${relativePath}\n\n`;
    
    fileGroups[file].forEach(finding => {
      report += `- Line ${finding.line}: \`${finding.match}\` in \`${finding.content}\`\n`;
    });
    
    report += '\n';
  });

  // Write report to file
  fs.writeFileSync(outputFile, report);
  console.log(`Analysis complete. Report written to ${outputFile}`);
}

// Run the analysis
main();
EOF

# Create database data analyser
DB_DATA_CHECKER_FILE="/Users/stevewf/expresso/db-data-checker.py"
cat > "$DB_DATA_CHECKER_FILE" << 'EOF'
#!/usr/bin/env python3

import os
import sys
import json
import sqlite3
import datetime
import re

# Configure paths
DB_PATH = None  # Will be detected automatically
OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "logs", "live_test")
OUTPUT_FILE = os.path.join(OUTPUT_DIR, "database-analysis.md")

def find_database_file():
    """Find SQLite database files in the current directory and subdirectories"""
    db_files = []
    
    # Start with the current directory
    base_dir = os.path.dirname(os.path.abspath(__file__))
    
    for root, dirs, files in os.walk(base_dir):
        for file in files:
            if file.endswith('.db') or file.endswith('.sqlite') or file.endswith('.sqlite3'):
                full_path = os.path.join(root, file)
                db_files.append(full_path)
    
    return db_files

def is_valid_sqlite_db(db_path):
    """Check if the file is a valid SQLite database"""
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        cursor.execute("SELECT sqlite_version();")
        conn.close()
        return True
    except sqlite3.Error:
        return False

def get_table_names(conn):
    """Get all table names from the database"""
    cursor = conn.cursor()
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
    return [row[0] for row in cursor.fetchall()]

def get_table_structure(conn, table_name):
    """Get the column structure for a table"""
    cursor = conn.cursor()
    cursor.execute(f"PRAGMA table_info({table_name});")
    return cursor.fetchall()

def get_table_data(conn, table_name, limit=100):
    """Get sample data from a table"""
    cursor = conn.cursor()
    try:
        cursor.execute(f"SELECT * FROM {table_name} LIMIT {limit};")
        return cursor.fetchall()
    except sqlite3.Error as e:
        return [f"Error retrieving data: {e}"]

def analyze_data_for_patterns(rows, column_names):
    """Analyze table data for patterns indicating real vs. demo data"""
    analysis = {
        "total_rows": len(rows),
        "columns_with_names": [],
        "columns_with_emails": [],
        "columns_with_phones": [],
        "patterns": {}
    }
    
    # Regular expressions for common data types
    email_pattern = re.compile(r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}')
    phone_pattern = re.compile(r'\d{3}[-.\s]?\d{3}[-.\s]?\d{4}')
    name_pattern = re.compile(r'\b[A-Z][a-z]+ [A-Z][a-z]+\b')
    
    # Demo data indicators
    demo_indicators = ['test', 'demo', 'sample', 'example', 'fake', 'dummy']
    
    for col_idx, col_name in enumerate(column_names):
        # Skip id columns and timestamps for pattern analysis
        if col_name.lower() == 'id' or 'id' in col_name.lower() or 'time' in col_name.lower() or 'date' in col_name.lower():
            continue
        
        col_values = [str(row[col_idx]) if col_idx < len(row) else "" for row in rows]
        
        # Check for emails
        emails = [val for val in col_values if email_pattern.search(str(val))]
        if emails:
            analysis["columns_with_emails"].append({
                "column": col_name,
                "examples": emails[:5]
            })
        
        # Check for phone numbers
        phones = [val for val in col_values if phone_pattern.search(str(val))]
        if phones:
            analysis["columns_with_phones"].append({
                "column": col_name,
                "examples": phones[:5]
            })
        
        # Check for names
        names = [val for val in col_values if name_pattern.search(str(val))]
        if names:
            analysis["columns_with_names"].append({
                "column": col_name,
                "examples": names[:5]
            })
        
        # Check for demo data indicators
        for indicator in demo_indicators:
            indicator_matches = [val for val in col_values if indicator.lower() in str(val).lower()]
            if indicator_matches:
                if indicator not in analysis["patterns"]:
                    analysis["patterns"][indicator] = []
                
                analysis["patterns"][indicator].append({
                    "column": col_name,
                    "examples": indicator_matches[:5]
                })
    
    return analysis

def analyze_database(db_path):
    """Analyze the database for potential real vs. demo data"""
    results = {
        "database_path": db_path,
        "analysis_time": datetime.datetime.now().isoformat(),
        "tables": {}
    }
    
    try:
        conn = sqlite3.connect(db_path)
        table_names = get_table_names(conn)
        
        for table_name in table_names:
            # Skip SQLite internal tables
            if table_name.startswith('sqlite_'):
                continue
                
            table_structure = get_table_structure(conn, table_name)
            column_names = [col[1] for col in table_structure]
            table_data = get_table_data(conn, table_name)
            
            data_analysis = analyze_data_for_patterns(table_data, column_names)
            
            results["tables"][table_name] = {
                "column_count": len(column_names),
                "columns": column_names,
                "row_count": data_analysis["total_rows"],
                "data_analysis": data_analysis
            }
        
        conn.close()
        return results
    
    except sqlite3.Error as e:
        return {
            "database_path": db_path,
            "error": str(e)
        }

def format_report_as_markdown(analysis_results):
    """Format the analysis results as a Markdown report"""
    report = f"# Database Analysis Report\n\n"
    report += f"**Analysis Time:** {analysis_results['analysis_time']}\n"
    report += f"**Database Path:** {analysis_results['database_path']}\n\n"
    
    report += "## Summary of Findings\n\n"
    
    potential_real_data = []
    demo_data_indicators = []
    
    # Collect findings across all tables
    for table_name, table_info in analysis_results["tables"].items():
        analysis = table_info["data_analysis"]
        
        # Check for potential real data
        if analysis["columns_with_names"] or analysis["columns_with_emails"] or analysis["columns_with_phones"]:
            potential_real_data.append(table_name)
        
        # Check for demo data indicators
        if analysis["patterns"]:
            demo_data_indicators.append(table_name)
    
    # Report summary findings
    if potential_real_data:
        report += "### Potential Real Data Detected\n\n"
        report += "The following tables contain patterns that might indicate real personal data:\n\n"
        for table in potential_real_data:
            report += f"- {table}\n"
        report += "\n"
    
    if demo_data_indicators:
        report += "### Demo Data Indicators\n\n"
        report += "The following tables contain indicators of demo/test data:\n\n"
        for table in demo_data_indicators:
            report += f"- {table}\n"
        report += "\n"
    
    # Detailed analysis per table
    report += "## Detailed Table Analysis\n\n"
    
    for table_name, table_info in analysis_results["tables"].items():
        report += f"### Table: {table_name}\n\n"
        report += f"**Columns:** {', '.join(table_info['columns'])}\n"
        report += f"**Row Count:** {table_info['row_count']}\n\n"
        
        analysis = table_info["data_analysis"]
        
        if analysis["columns_with_names"]:
            report += "#### Columns With Name Patterns\n\n"
            for col_info in analysis["columns_with_names"]:
                report += f"- **{col_info['column']}**: Examples: {', '.join(col_info['examples'])}\n"
            report += "\n"
        
        if analysis["columns_with_emails"]:
            report += "#### Columns With Email Patterns\n\n"
            for col_info in analysis["columns_with_emails"]:
                report += f"- **{col_info['column']}**: Examples: {', '.join(col_info['examples'])}\n"
            report += "\n"
        
        if analysis["columns_with_phones"]:
            report += "#### Columns With Phone Number Patterns\n\n"
            for col_info in analysis["columns_with_phones"]:
                report += f"- **{col_info['column']}**: Examples: {', '.join(col_info['examples'])}\n"
            report += "\n"
        
        if analysis["patterns"]:
            report += "#### Demo/Test Data Indicators\n\n"
            for pattern, pattern_infos in analysis["patterns"].items():
                report += f"**Pattern '{pattern}'**:\n\n"
                for info in pattern_infos:
                    report += f"- **{info['column']}**: Examples: {', '.join(info['examples'])}\n"
                report += "\n"
        
        report += "\n"
    
    return report

def main():
    print("Starting database analysis...")
    
    # Create output directory if it doesn't exist
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    
    # Find database files
    db_files = find_database_file()
    
    if not db_files:
        print("No database files found.")
        with open(OUTPUT_FILE, 'w') as f:
            f.write("# Database Analysis Report\n\nNo SQLite database files were found in the project directory.\n")
        return
    
    print(f"Found {len(db_files)} potential database files.")
    
    # Analyze each valid database
    valid_dbs = []
    for db_path in db_files:
        if is_valid_sqlite_db(db_path):
            valid_dbs.append(db_path)
            print(f"Valid SQLite database found: {db_path}")
    
    if not valid_dbs:
        print("No valid SQLite databases found.")
        with open(OUTPUT_FILE, 'w') as f:
            f.write("# Database Analysis Report\n\nNo valid SQLite database files were found in the project directory.\n")
        return
    
    # Analyze each database and generate a combined report
    combined_report = "# Combined Database Analysis Report\n\n"
    
    for db_path in valid_dbs:
        print(f"Analyzing database: {db_path}")
        analysis_results = analyze_database(db_path)
        report = format_report_as_markdown(analysis_results)
        
        # Save individual report
        db_name = os.path.basename(db_path)
        individual_report_path = os.path.join(OUTPUT_DIR, f"db-analysis-{db_name}.md")
        with open(individual_report_path, 'w') as f:
            f.write(report)
        print(f"Saved analysis for {db_name} to {individual_report_path}")
        
        # Add to combined report
        combined_report += f"# Analysis for {db_name}\n\n"
        combined_report += report
        combined_report += "\n---\n\n"
    
    # Save combined report
    with open(OUTPUT_FILE, 'w') as f:
        f.write(combined_report)
    
    print(f"Database analysis complete. Combined report saved to {OUTPUT_FILE}")

if __name__ == "__main__":
    main()
EOF

chmod +x "$DB_DATA_CHECKER_FILE"

# Create injector script for the frontend
INJECT_SCRIPT_FILE="/Users/stevewf/expresso/inject-monitoring.js"
cat > "$INJECT_SCRIPT_FILE" << 'EOF'
const fs = require('fs');
const path = require('path');

// Path to index.html
const indexHtmlPath = path.join(__dirname, 'Barista Front End/public/index.html');

// Check if index.html exists
if (!fs.existsSync(indexHtmlPath)) {
  console.error(`File not found: ${indexHtmlPath}`);
  process.exit(1);
}

// Read the file
console.log(`Reading ${indexHtmlPath}...`);
let indexHtmlContent = fs.readFileSync(indexHtmlPath, 'utf8');

// Check if monitoring script is already injected
if (indexHtmlContent.includes('console-capture.js')) {
  console.log('Monitoring script is already injected.');
  process.exit(0);
}

// Inject the monitoring script reference right before the closing </head> tag
const injectedScript = `  <script src="/console-capture.js"></script>
</head>`;
indexHtmlContent = indexHtmlContent.replace('</head>', injectedScript);

// Write the modified file
console.log(`Writing modified ${indexHtmlPath}...`);
fs.writeFileSync(indexHtmlPath, indexHtmlContent);

console.log('Successfully injected monitoring script into index.html');
EOF

# Create a timed API request simulator to test backend during user interaction
API_SIMULATOR_FILE="/Users/stevewf/expresso/api-request-simulator.js"
cat > "$API_SIMULATOR_FILE" << 'EOF'
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
EOF

# Main script continues here
echo -e "${YELLOW}Starting monitoring services...${NC}"

# Function to start a service
start_service() {
  local script=$1
  local description=$2
  local log_file=$3
  local port=$4
  
  echo -e "${YELLOW}Starting $description...${NC}"
  node "$script" "$log_file" > /tmp/$(basename "$script").log 2>&1 &
  local pid=$!
  echo "PID: $pid"
  
  # Wait a moment to see if the service starts
  sleep 2
  if is_port_in_use "$port"; then
    echo -e "${GREEN}✓ $description started successfully on port $port${NC}"
  else
    echo -e "${RED}× $description may not have started correctly${NC}"
  fi
  
  return 0
}

# Check backend API status
echo -e "${YELLOW}Checking backend API status...${NC}"
if is_port_in_use 5001; then
  echo -e "${GREEN}✓ Backend API is running on port 5001${NC}"
else
  echo -e "${RED}× Backend API is not running on port 5001${NC}"
  echo "Please start the backend server first"
  exit 1
fi

# Check frontend status
echo -e "${YELLOW}Checking frontend status...${NC}"
if is_port_in_use 3001; then
  echo -e "${GREEN}✓ Frontend is running on port 3001${NC}"
else
  echo -e "${RED}× Frontend is not running on port 3001${NC}"
  echo "Please start the React frontend first"
  exit 1
fi

# Inject monitoring script
echo -e "${YELLOW}Injecting console monitoring script...${NC}"
node "$INJECT_SCRIPT_FILE" || {
  echo -e "${RED}Failed to inject monitoring script${NC}"
}

# Start console log server
start_service "$LOG_SERVER_FILE" "Console log server" "$CONSOLE_LOG_FILE" 3033

# Start API monitor
start_service "$API_MONITOR_FILE" "API monitor" "$LOGS_DIR/api-traffic.log" 3034

# Run hardcoded data analyzer
echo -e "${YELLOW}Running hardcoded data analysis...${NC}"
node "$DATA_ANALYZER_FILE" > /tmp/data-analyzer.log 2>&1 &
DATA_ANALYZER_PID=$!
echo "Data analyzer PID: $DATA_ANALYZER_PID"

# Run database data analyzer
echo -e "${YELLOW}Running database data analysis...${NC}"
python3 "$DB_DATA_CHECKER_FILE" > /tmp/db-data-checker.log 2>&1 &
DB_CHECKER_PID=$!
echo "Database checker PID: $DB_CHECKER_PID"

# Start API request simulator
echo -e "${YELLOW}Starting API request simulator...${NC}"
node "$API_SIMULATOR_FILE" > /tmp/api-simulator.log 2>&1 &
API_SIMULATOR_PID=$!
echo "API simulator PID: $API_SIMULATOR_PID"

echo -e "${GREEN}==================================================${NC}"
echo -e "${GREEN}   COFFEE CUE SYSTEM - LIVE TESTING ENVIRONMENT   ${NC}"
echo -e "${GREEN}==================================================${NC}"
echo ""
echo -e "${BLUE}The system is now fully monitored for testing:${NC}"
echo ""
echo -e "${YELLOW}Access the frontend:${NC} http://localhost:3001"
echo -e "${YELLOW}Access the backend:${NC} http://localhost:5001"
echo ""
echo -e "${YELLOW}Monitoring services:${NC}"
echo "- Console log capture: http://localhost:3033/status"
echo "- API traffic monitor: http://localhost:3034/status"
echo ""
echo -e "${YELLOW}Real-time logs:${NC}"
echo "- Console logs: $CONSOLE_LOG_FILE"
echo "- API traffic: $LOGS_DIR/api-traffic.log"
echo ""
echo -e "${YELLOW}Analysis reports:${NC}"
echo "- Hardcoded data: $LOGS_DIR/hardcoded-data-analysis.md"
echo "- Database data: $LOGS_DIR/database-analysis.md"
echo ""
echo -e "${RED}To stop testing and monitoring, press Ctrl+C${NC}"