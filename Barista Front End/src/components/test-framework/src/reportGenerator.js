const fs = require('fs').promises;
const path = require('path');
const config = require('../config/testConfig');

class ReportGenerator {
  constructor() {
    this.reportDir = config.reports.outputDir;
  }

  async ensureReportDirectory() {
    await fs.mkdir(this.reportDir, { recursive: true });
    await fs.mkdir(path.join(this.reportDir, 'screenshots'), { recursive: true });
  }

  async generateHTML(data) {
    await this.ensureReportDirectory();
    
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Coffee Cue Test Report - ${new Date().toLocaleString()}</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
            background: #f5f5f5;
        }
        
        .header {
            background: #2c3e50;
            color: white;
            padding: 2rem;
            border-radius: 8px;
            margin-bottom: 2rem;
        }
        
        .summary {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 1rem;
            margin-bottom: 2rem;
        }
        
        .summary-card {
            background: white;
            padding: 1.5rem;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        
        .summary-card h3 {
            margin-top: 0;
            color: #2c3e50;
        }
        
        .summary-card .value {
            font-size: 2rem;
            font-weight: bold;
            color: #3498db;
        }
        
        .success { color: #2ecc71 !important; }
        .error { color: #e74c3c !important; }
        .warning { color: #f39c12 !important; }
        
        .section {
            background: white;
            padding: 2rem;
            margin-bottom: 2rem;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        
        .section h2 {
            margin-top: 0;
            color: #2c3e50;
            border-bottom: 2px solid #3498db;
            padding-bottom: 0.5rem;
        }
        
        table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 1rem;
        }
        
        th, td {
            padding: 0.75rem;
            text-align: left;
            border-bottom: 1px solid #ddd;
        }
        
        th {
            background: #f8f9fa;
            font-weight: 600;
        }
        
        tr:hover {
            background: #f8f9fa;
        }
        
        .log-entry {
            padding: 0.5rem;
            margin: 0.25rem 0;
            background: #f8f9fa;
            border-left: 3px solid #3498db;
            font-family: monospace;
            font-size: 0.9em;
        }
        
        .log-error { border-left-color: #e74c3c; background: #fff5f5; }
        .log-warning { border-left-color: #f39c12; background: #fffaf0; }
        
        .screenshot {
            max-width: 100%;
            border: 1px solid #ddd;
            border-radius: 4px;
            margin: 1rem 0;
        }
        
        details {
            margin: 1rem 0;
            padding: 1rem;
            background: #f8f9fa;
            border-radius: 4px;
        }
        
        summary {
            cursor: pointer;
            font-weight: 600;
            color: #2c3e50;
        }
        
        .timeline {
            position: relative;
            padding-left: 30px;
        }
        
        .timeline-item {
            position: relative;
            padding-bottom: 1rem;
            border-left: 2px solid #3498db;
            padding-left: 20px;
        }
        
        .timeline-item::before {
            content: '';
            position: absolute;
            left: -7px;
            top: 0;
            width: 12px;
            height: 12px;
            border-radius: 50%;
            background: #3498db;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>☕ Coffee Cue Comprehensive Test Report</h1>
        <p>Generated: ${new Date().toLocaleString()}</p>
        <p>Duration: ${this.calculateDuration(data.startTime, data.endTime)}</p>
    </div>
    
    <div class="summary">
        <div class="summary-card">
            <h3>Total Tests</h3>
            <div class="value">${data.totalTests}</div>
        </div>
        <div class="summary-card">
            <h3>Passed</h3>
            <div class="value success">${data.passedTests}</div>
        </div>
        <div class="summary-card">
            <h3>Failed</h3>
            <div class="value error">${data.failedTests}</div>
        </div>
        <div class="summary-card">
            <h3>Success Rate</h3>
            <div class="value">${this.calculateSuccessRate(data)}%</div>
        </div>
    </div>
    
    ${this.generateTestSuitesSection(data.suites)}
    ${this.generateInteractionsSection(data.interactions)}
    ${this.generateErrorsSection(data.browserLogs.errors, data.errors)}
    ${this.generateConsoleLogsSection(data.browserLogs.console)}
    ${this.generateNetworkSection(data.browserLogs.network)}
    ${this.generateDatabaseSection(data.database)}
    
</body>
</html>
    `;
    
    await fs.writeFile(path.join(this.reportDir, 'report.html'), html);
  }

  generateTestSuitesSection(suites) {
    let html = '<div class="section"><h2>Test Suites</h2>';
    
    for (const [name, suite] of Object.entries(suites)) {
      const successRate = suite.passed / (suite.passed + suite.failed) * 100;
      html += `
        <details>
            <summary>${name} - ${successRate.toFixed(1)}% Success</summary>
            <table>
                <tr>
                    <th>Metric</th>
                    <th>Value</th>
                </tr>
                <tr>
                    <td>Duration</td>
                    <td>${this.calculateDuration(suite.startTime, suite.endTime)}</td>
                </tr>
                <tr>
                    <td>Passed</td>
                    <td class="success">${suite.passed}</td>
                </tr>
                <tr>
                    <td>Failed</td>
                    <td class="error">${suite.failed}</td>
                </tr>
            </table>
            ${suite.errors.length > 0 ? this.generateErrorsList(suite.errors) : ''}
        </details>
      `;
    }
    
    html += '</div>';
    return html;
  }

  generateInteractionsSection(interactions) {
    return `
    <div class="section">
        <h2>UI Interactions</h2>
        
        <h3>Clicked Buttons (${interactions.clickedButtons.length})</h3>
        <div class="timeline">
            ${interactions.clickedButtons.slice(0, 10).map(button => `
                <div class="timeline-item">
                    <strong>${button.text || button.id || 'Button'}</strong>
                    ${button.className ? `<br>Class: ${button.className}` : ''}
                </div>
            `).join('')}
            ${interactions.clickedButtons.length > 10 ? `<p>...and ${interactions.clickedButtons.length - 10} more</p>` : ''}
        </div>
        
        <h3>Tested Form Fields (${interactions.testedInputs.length})</h3>
        <table>
            <tr>
                <th>Field</th>
                <th>Type</th>
                <th>Test Values</th>
            </tr>
            ${interactions.testedInputs.slice(0, 10).map(input => `
                <tr>
                    <td>${input.name || input.id || 'Field'}</td>
                    <td>${input.type}</td>
                    <td>${input.testValue}</td>
                </tr>
            `).join('')}
        </table>
    </div>
    `;
  }

  generateErrorsSection(browserErrors, generalErrors) {
    const allErrors = [...browserErrors, ...generalErrors];
    
    if (allErrors.length === 0) {
      return `
      <div class="section">
          <h2>Errors</h2>
          <p class="success">✅ No errors detected during testing!</p>
      </div>
      `;
    }
    
    return `
    <div class="section">
        <h2>Errors (${allErrors.length})</h2>
        ${allErrors.map(error => `
            <div class="log-entry log-error">
                <strong>${error.message}</strong>
                ${error.stack ? `<pre>${error.stack}</pre>` : ''}
                ${error.timestamp ? `<br>Time: ${new Date(error.timestamp).toLocaleTimeString()}` : ''}
            </div>
        `).join('')}
    </div>
    `;
  }

  generateConsoleLogsSection(logs) {
    const errorLogs = logs.filter(log => log.type === 'error');
    const warningLogs = logs.filter(log => log.type === 'warning');
    const infoLogs = logs.filter(log => log.type === 'log' || log.type === 'info');
    
    return `
    <div class="section">
        <h2>Console Logs</h2>
        
        <details>
            <summary>Errors (${errorLogs.length})</summary>
            ${errorLogs.map(log => `
                <div class="log-entry log-error">
                    [${new Date(log.timestamp).toLocaleTimeString()}] ${log.text}
                </div>
            `).join('') || '<p>No errors logged</p>'}
        </details>
        
        <details>
            <summary>Warnings (${warningLogs.length})</summary>
            ${warningLogs.map(log => `
                <div class="log-entry log-warning">
                    [${new Date(log.timestamp).toLocaleTimeString()}] ${log.text}
                </div>
            `).join('') || '<p>No warnings logged</p>'}
        </details>
        
        <details>
            <summary>Info Logs (${infoLogs.length})</summary>
            ${infoLogs.slice(0, 50).map(log => `
                <div class="log-entry">
                    [${new Date(log.timestamp).toLocaleTimeString()}] ${log.text}
                </div>
            `).join('')}
            ${infoLogs.length > 50 ? `<p>...and ${infoLogs.length - 50} more</p>` : ''}
        </details>
    </div>
    `;
  }

  generateNetworkSection(logs) {
    const apiCalls = logs.filter(log => log.url.includes('/api/'));
    const slowCalls = [];
    
    // Calculate response times
    apiCalls.forEach(request => {
      if (request.type === 'request') {
        const response = logs.find(log => 
          log.type === 'response' && 
          log.url === request.url &&
          log.timestamp > request.timestamp
        );
        
        if (response) {
          const duration = new Date(response.timestamp) - new Date(request.timestamp);
          if (duration > 1000) {
            slowCalls.push({
              url: request.url,
              method: request.method,
              duration,
              status: response.status
            });
          }
        }
      }
    });
    
    return `
    <div class="section">
        <h2>Network Activity</h2>
        
        <h3>API Endpoints Used</h3>
        ${this.generateApiEndpointsSummary(apiCalls)}
        
        <h3>Slow API Calls (>1s)</h3>
        ${slowCalls.length > 0 ? `
            <table>
                <tr>
                    <th>Endpoint</th>
                    <th>Method</th>
                    <th>Duration</th>
                    <th>Status</th>
                </tr>
                ${slowCalls.map(call => `
                    <tr>
                        <td>${call.url.replace(/.*\/api/, '/api')}</td>
                        <td>${call.method}</td>
                        <td>${call.duration}ms</td>
                        <td>${call.status}</td>
                    </tr>
                `).join('')}
            </table>
        ` : '<p class="success">✅ No slow API calls detected</p>'}
    </div>
    `;
  }

  generateApiEndpointsSummary(apiCalls) {
    const endpoints = {};
    
    apiCalls.forEach(call => {
      if (call.type === 'request') {
        const endpoint = call.url.replace(/.*\/api/, '/api').split('?')[0];
        const key = `${call.method} ${endpoint}`;
        endpoints[key] = (endpoints[key] || 0) + 1;
      }
    });
    
    return `
    <table>
        <tr>
            <th>Endpoint</th>
            <th>Calls</th>
        </tr>
        ${Object.entries(endpoints).map(([endpoint, count]) => `
            <tr>
                <td>${endpoint}</td>
                <td>${count}</td>
            </tr>
        `).join('')}
    </table>
    `;
  }

  generateDatabaseSection(database) {
    const queries = database.queries || [];
    const slowQueries = queries.filter(q => q.duration > 100);
    const failedQueries = queries.filter(q => !q.success);
    
    return `
    <div class="section">
        <h2>Database Activity</h2>
        
        <div class="summary">
            <div class="summary-card">
                <h3>Total Queries</h3>
                <div class="value">${queries.length}</div>
            </div>
            <div class="summary-card">
                <h3>Slow Queries</h3>
                <div class="value ${slowQueries.length > 0 ? 'warning' : ''}">${slowQueries.length}</div>
            </div>
            <div class="summary-card">
                <h3>Failed Queries</h3>
                <div class="value ${failedQueries.length > 0 ? 'error' : ''}">${failedQueries.length}</div>
            </div>
        </div>
        
        <details>
            <summary>Recent Queries</summary>
            ${queries.slice(-20).map(query => `
                <div class="log-entry ${query.success ? '' : 'log-error'}">
                    <strong>${query.query.substring(0, 100)}...</strong><br>
                    Duration: ${query.duration}ms | Rows: ${query.rowCount}
                    ${query.error ? `<br>Error: ${query.error}` : ''}
                </div>
            `).join('')}
        </details>
    </div>
    `;
  }

  generateErrorsList(errors) {
    return `
    <div class="errors">
        ${errors.map(error => `
            <div class="log-entry log-error">
                ${error.message}
                ${error.stack ? `<pre>${error.stack}</pre>` : ''}
            </div>
        `).join('')}
    </div>
    `;
  }

  async generateJSON(data) {
    await this.ensureReportDirectory();
    await fs.writeFile(
      path.join(this.reportDir, 'report.json'),
      JSON.stringify(data, null, 2)
    );
  }

  async generateMarkdown(data) {
    await this.ensureReportDirectory();
    
    const markdown = `
# Coffee Cue Test Report

**Generated:** ${new Date().toLocaleString()}  
**Duration:** ${this.calculateDuration(data.startTime, data.endTime)}

## Summary

| Metric | Value |
|--------|-------|
| Total Tests | ${data.totalTests} |
| Passed | ${data.passedTests} |
| Failed | ${data.failedTests} |
| Success Rate | ${this.calculateSuccessRate(data)}% |

## Test Suites

${Object.entries(data.suites).map(([name, suite]) => `
### ${name}
- Duration: ${this.calculateDuration(suite.startTime, suite.endTime)}
- Passed: ${suite.passed}
- Failed: ${suite.failed}
${suite.errors.length > 0 ? `\n**Errors:**\n${suite.errors.map(e => `- ${e.message}`).join('\n')}` : ''}
`).join('\n')}

## UI Interactions

- **Buttons Clicked:** ${data.interactions.clickedButtons.length}
- **Form Fields Tested:** ${data.interactions.testedInputs.length}

## Errors

${data.browserLogs.errors.length === 0 && data.errors.length === 0 ? 
  '✅ No errors detected!' : 
  [...data.browserLogs.errors, ...data.errors].map(e => `- ${e.message}`).join('\n')
}

## Database Activity

- **Total Queries:** ${data.database.queries.length}
- **Slow Queries (>100ms):** ${data.database.queries.filter(q => q.duration > 100).length}
- **Failed Queries:** ${data.database.queries.filter(q => !q.success).length}

## API Performance

${this.generateApiPerformanceMarkdown(data.browserLogs.network)}
`;

    await fs.writeFile(path.join(this.reportDir, 'report.md'), markdown);
  }

  generateApiPerformanceMarkdown(networkLogs) {
    const apiCalls = networkLogs.filter(log => log.url.includes('/api/'));
    const endpoints = {};
    
    apiCalls.forEach(request => {
      if (request.type === 'request') {
        const endpoint = request.url.replace(/.*\/api/, '/api').split('?')[0];
        if (!endpoints[endpoint]) {
          endpoints[endpoint] = { count: 0, totalDuration: 0 };
        }
        
        const response = networkLogs.find(log => 
          log.type === 'response' && 
          log.url === request.url &&
          log.timestamp > request.timestamp
        );
        
        if (response) {
          const duration = new Date(response.timestamp) - new Date(request.timestamp);
          endpoints[endpoint].count++;
          endpoints[endpoint].totalDuration += duration;
        }
      }
    });
    
    return Object.entries(endpoints).map(([endpoint, stats]) => 
      `- **${endpoint}**: ${stats.count} calls, avg ${Math.round(stats.totalDuration / stats.count)}ms`
    ).join('\n');
  }

  async generateClaudeSummary(data) {
    await this.ensureReportDirectory();
    
    const summary = `
# Coffee Cue Test Summary for Claude

## Quick Overview
- **Success Rate:** ${this.calculateSuccessRate(data)}%
- **Total Tests:** ${data.totalTests} (${data.passedTests} passed, ${data.failedTests} failed)
- **Duration:** ${this.calculateDuration(data.startTime, data.endTime)}

## What Works ✅
${this.identifyWorkingFeatures(data)}

## What Doesn't Work ❌
${this.identifyBrokenFeatures(data)}

## Critical Issues 🚨
${this.identifyCriticalIssues(data)}

## Performance Insights 📊
${this.generatePerformanceInsights(data)}

## Database Verification 💾
${this.generateDatabaseInsights(data)}

## Recommendations 💡
${this.generateRecommendations(data)}
`;

    await fs.writeFile(path.join(this.reportDir, 'claude-summary.md'), summary);
  }

  identifyWorkingFeatures(data) {
    const working = [];
    
    Object.entries(data.suites).forEach(([name, suite]) => {
      if (suite.failed === 0 && suite.passed > 0) {
        working.push(`- **${name}**: All tests passed`);
      }
    });
    
    if (data.interactions.clickedButtons.length > 0) {
      working.push(`- **UI Buttons**: ${data.interactions.clickedButtons.length} buttons tested successfully`);
    }
    
    if (data.interactions.testedInputs.length > 0) {
      working.push(`- **Form Fields**: ${data.interactions.testedInputs.length} input fields tested`);
    }
    
    return working.join('\n') || '- No features confirmed working';
  }

  identifyBrokenFeatures(data) {
    const broken = [];
    
    Object.entries(data.suites).forEach(([name, suite]) => {
      if (suite.failed > 0) {
        broken.push(`- **${name}**: ${suite.failed} tests failed`);
        suite.errors.forEach(error => {
          broken.push(`  - ${error.message}`);
        });
      }
    });
    
    if (data.browserLogs.errors.length > 0) {
      broken.push(`- **JavaScript Errors**: ${data.browserLogs.errors.length} errors detected`);
    }
    
    return broken.join('\n') || '- No broken features detected';
  }

  identifyCriticalIssues(data) {
    const issues = [];
    
    // Check for authentication issues
    const authSuite = data.suites['Authentication'];
    if (authSuite && authSuite.failed > 0) {
      issues.push('- **Authentication System**: Login/logout functionality has issues');
    }
    
    // Check for database issues
    const failedQueries = data.database.queries.filter(q => !q.success);
    if (failedQueries.length > 0) {
      issues.push(`- **Database**: ${failedQueries.length} queries failed`);
    }
    
    // Check for API errors
    const apiErrors = data.browserLogs.network.filter(log => 
      log.type === 'response' && log.status >= 400
    );
    if (apiErrors.length > 0) {
      issues.push(`- **API Errors**: ${apiErrors.length} API calls returned errors`);
    }
    
    return issues.join('\n') || '- No critical issues found';
  }

  generatePerformanceInsights(data) {
    const insights = [];
    
    // Slow database queries
    const slowQueries = data.database.queries.filter(q => q.duration > 100);
    if (slowQueries.length > 0) {
      insights.push(`- **Slow Database Queries**: ${slowQueries.length} queries took >100ms`);
    }
    
    // API performance
    const apiCalls = data.browserLogs.network.filter(log => log.url.includes('/api/'));
    if (apiCalls.length > 0) {
      insights.push(`- **API Calls**: ${apiCalls.length} total API requests made`);
    }
    
    return insights.join('\n') || '- Performance appears acceptable';
  }

  generateDatabaseInsights(data) {
    const insights = [];
    const queries = data.database.queries;
    
    // Check for data persistence
    const insertQueries = queries.filter(q => q.query.toLowerCase().includes('insert'));
    const updateQueries = queries.filter(q => q.query.toLowerCase().includes('update'));
    
    insights.push(`- **Data Creation**: ${insertQueries.length} INSERT queries executed`);
    insights.push(`- **Data Updates**: ${updateQueries.length} UPDATE queries executed`);
    
    // Check specific tables
    const tables = ['orders', 'inventory', 'settings', 'stations'];
    tables.forEach(table => {
      const tableQueries = queries.filter(q => q.query.includes(table));
      if (tableQueries.length > 0) {
        insights.push(`- **${table} table**: ${tableQueries.length} queries executed`);
      }
    });
    
    return insights.join('\n');
  }

  generateRecommendations(data) {
    const recommendations = [];
    
    if (data.failedTests > 0) {
      recommendations.push('1. Fix failing tests before deployment');
    }
    
    if (data.browserLogs.errors.length > 0) {
      recommendations.push('2. Address JavaScript errors in the console');
    }
    
    const slowQueries = data.database.queries.filter(q => q.duration > 100);
    if (slowQueries.length > 5) {
      recommendations.push('3. Optimize database queries for better performance');
    }
    
    if (data.errors.length > 0) {
      recommendations.push('4. Investigate and fix application errors');
    }
    
    return recommendations.join('\n') || '- System appears ready for use';
  }

  calculateDuration(startTime, endTime) {
    if (!startTime || !endTime) return 'N/A';
    const duration = new Date(endTime) - new Date(startTime);
    const seconds = Math.floor(duration / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  }

  calculateSuccessRate(data) {
    if (data.totalTests === 0) return 0;
    return ((data.passedTests / data.totalTests) * 100).toFixed(1);
  }
}

module.exports = ReportGenerator;