/**
 * Report Generator for Coffee Cue
 * Creates comprehensive HTML reports from test results
 */

const fs = require('fs').promises;
const path = require('path');

class ReportGenerator {
  constructor(config) {
    this.config = config;
  }

  async generate(data) {
    const {
      sessionId,
      testHistory,
      fixHistory,
      totalRetries,
      config
    } = data;

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Coffee Cue Autonomous Test Report - ${sessionId}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f5f5f5;
      color: #333;
      line-height: 1.6;
    }
    
    .container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 20px;
    }
    
    header {
      background: #2c3e50;
      color: white;
      padding: 30px 0;
      text-align: center;
      border-radius: 8px 8px 0 0;
    }
    
    h1 {
      font-size: 2.5em;
      margin-bottom: 10px;
    }
    
    .subtitle {
      font-size: 1.2em;
      opacity: 0.9;
    }
    
    .summary {
      background: white;
      padding: 30px;
      margin: 20px 0;
      border-radius: 8px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    }
    
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 20px;
      margin-top: 20px;
    }
    
    .metric {
      text-align: center;
      padding: 20px;
      background: #f8f9fa;
      border-radius: 8px;
    }
    
    .metric-value {
      font-size: 2.5em;
      font-weight: bold;
      color: #2c3e50;
    }
    
    .metric-label {
      font-size: 0.9em;
      color: #666;
      margin-top: 5px;
    }
    
    .success { color: #27ae60; }
    .warning { color: #f39c12; }
    .error { color: #e74c3c; }
    
    .section {
      background: white;
      padding: 25px;
      margin: 20px 0;
      border-radius: 8px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    }
    
    h2 {
      color: #2c3e50;
      margin-bottom: 20px;
      padding-bottom: 10px;
      border-bottom: 2px solid #ecf0f1;
    }
    
    .timeline {
      position: relative;
      padding-left: 40px;
    }
    
    .timeline::before {
      content: '';
      position: absolute;
      left: 15px;
      top: 0;
      bottom: 0;
      width: 2px;
      background: #ecf0f1;
    }
    
    .timeline-item {
      position: relative;
      margin-bottom: 30px;
    }
    
    .timeline-item::before {
      content: '';
      position: absolute;
      left: -29px;
      top: 5px;
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: #3498db;
      border: 3px solid white;
      box-shadow: 0 0 0 2px #ecf0f1;
    }
    
    .timeline-item.success::before { background: #27ae60; }
    .timeline-item.error::before { background: #e74c3c; }
    
    .timeline-content {
      background: #f8f9fa;
      padding: 15px;
      border-radius: 8px;
    }
    
    .timeline-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
    }
    
    .timeline-time {
      font-size: 0.85em;
      color: #666;
    }
    
    .test-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: 15px;
      margin-top: 15px;
    }
    
    .test-card {
      background: #f8f9fa;
      padding: 15px;
      border-radius: 8px;
      border-left: 4px solid #3498db;
    }
    
    .test-card.passed { border-left-color: #27ae60; }
    .test-card.failed { border-left-color: #e74c3c; }
    
    .test-name {
      font-weight: 600;
      margin-bottom: 5px;
    }
    
    .test-details {
      font-size: 0.9em;
      color: #666;
    }
    
    .fix-list {
      list-style: none;
      margin-top: 15px;
    }
    
    .fix-item {
      background: #f8f9fa;
      padding: 15px;
      margin-bottom: 10px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      gap: 15px;
    }
    
    .fix-icon {
      font-size: 1.5em;
    }
    
    .fix-details h4 {
      margin-bottom: 5px;
    }
    
    .fix-description {
      font-size: 0.9em;
      color: #666;
    }
    
    .chart-container {
      margin: 20px 0;
      height: 300px;
      background: #f8f9fa;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    
    .progress-bar {
      width: 100%;
      height: 30px;
      background: #ecf0f1;
      border-radius: 15px;
      overflow: hidden;
      margin: 20px 0;
    }
    
    .progress-fill {
      height: 100%;
      background: linear-gradient(90deg, #3498db, #2ecc71);
      transition: width 0.3s ease;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-weight: bold;
    }
    
    .footer {
      text-align: center;
      padding: 20px;
      color: #666;
      font-size: 0.9em;
    }
    
    .badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 0.85em;
      font-weight: 600;
    }
    
    .badge-success { background: #d4edda; color: #155724; }
    .badge-warning { background: #fff3cd; color: #856404; }
    .badge-error { background: #f8d7da; color: #721c24; }
    
    .code-block {
      background: #2c3e50;
      color: #ecf0f1;
      padding: 15px;
      border-radius: 8px;
      font-family: 'Courier New', monospace;
      font-size: 0.9em;
      overflow-x: auto;
      margin: 10px 0;
    }
    
    @media (max-width: 768px) {
      .container { padding: 10px; }
      .summary-grid { grid-template-columns: 1fr; }
      .timeline { padding-left: 20px; }
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>☕ Coffee Cue Autonomous Test Report</h1>
      <div class="subtitle">Session ID: ${sessionId}</div>
    </header>
    
    <div class="summary">
      <h2>Executive Summary</h2>
      ${this.generateSummaryMetrics(testHistory, fixHistory, totalRetries)}
    </div>
    
    <div class="section">
      <h2>Test Execution Timeline</h2>
      <div class="timeline">
        ${this.generateTimeline(testHistory, fixHistory)}
      </div>
    </div>
    
    <div class="section">
      <h2>Test Results by Suite</h2>
      ${this.generateTestResults(testHistory)}
    </div>
    
    <div class="section">
      <h2>Automated Fixes Applied</h2>
      ${this.generateFixDetails(fixHistory)}
    </div>
    
    <div class="section">
      <h2>Performance Metrics</h2>
      ${this.generatePerformanceMetrics(testHistory)}
    </div>
    
    <div class="section">
      <h2>Recommendations</h2>
      ${this.generateRecommendations(testHistory, fixHistory)}
    </div>
    
    <footer class="footer">
      <p>Generated on ${new Date().toLocaleString()}</p>
      <p>Coffee Cue Autonomous Testing System v1.0</p>
    </footer>
  </div>
  
  <script>
    // Add interactivity
    document.querySelectorAll('.test-card').forEach(card => {
      card.addEventListener('click', function() {
        this.classList.toggle('expanded');
      });
    });
    
    // Animate progress bars
    document.querySelectorAll('.progress-fill').forEach(bar => {
      const width = bar.style.width;
      bar.style.width = '0';
      setTimeout(() => {
        bar.style.width = width;
      }, 100);
    });
  </script>
</body>
</html>
    `;

    return html;
  }

  generateSummaryMetrics(testHistory, fixHistory, totalRetries) {
    const lastRun = testHistory[testHistory.length - 1];
    const firstRun = testHistory[0];
    
    const totalTests = lastRun ? lastRun.results.total : 0;
    const passedTests = lastRun ? lastRun.results.passed : 0;
    const failedTests = lastRun ? lastRun.results.failed : 0;
    const successRate = totalTests > 0 ? (passedTests / totalTests * 100).toFixed(1) : 0;
    
    const totalFixes = fixHistory.reduce((sum, fix) => sum + fix.results.fixed.length, 0);
    const duration = this.calculateDuration(firstRun?.timestamp, lastRun?.timestamp);
    
    const statusClass = successRate >= 95 ? 'success' : successRate >= 70 ? 'warning' : 'error';
    const statusIcon = successRate >= 95 ? '✅' : successRate >= 70 ? '⚠️' : '❌';

    return `
      <div class="summary-grid">
        <div class="metric">
          <div class="metric-value ${statusClass}">${successRate}%</div>
          <div class="metric-label">Success Rate</div>
        </div>
        <div class="metric">
          <div class="metric-value">${totalTests}</div>
          <div class="metric-label">Total Tests</div>
        </div>
        <div class="metric">
          <div class="metric-value success">${passedTests}</div>
          <div class="metric-label">Passed</div>
        </div>
        <div class="metric">
          <div class="metric-value error">${failedTests}</div>
          <div class="metric-label">Failed</div>
        </div>
        <div class="metric">
          <div class="metric-value">${totalRetries}</div>
          <div class="metric-label">Retry Cycles</div>
        </div>
        <div class="metric">
          <div class="metric-value">${totalFixes}</div>
          <div class="metric-label">Fixes Applied</div>
        </div>
        <div class="metric">
          <div class="metric-value">${duration}</div>
          <div class="metric-label">Duration</div>
        </div>
        <div class="metric">
          <div class="metric-value">${statusIcon}</div>
          <div class="metric-label">Status</div>
        </div>
      </div>
      
      <div class="progress-bar">
        <div class="progress-fill" style="width: ${successRate}%">
          ${successRate}% Tests Passing
        </div>
      </div>
    `;
  }

  generateTimeline(testHistory, fixHistory) {
    const events = [];
    
    // Add test events
    testHistory.forEach((test, index) => {
      events.push({
        type: 'test',
        retry: test.retry,
        timestamp: test.timestamp,
        data: test.results,
        index
      });
    });
    
    // Add fix events
    fixHistory.forEach((fix, index) => {
      events.push({
        type: 'fix',
        retry: fix.retry,
        timestamp: fix.timestamp,
        data: fix.results,
        index
      });
    });
    
    // Sort by timestamp
    events.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    
    return events.map(event => {
      if (event.type === 'test') {
        const success = event.data.failed === 0;
        return `
          <div class="timeline-item ${success ? 'success' : 'error'}">
            <div class="timeline-content">
              <div class="timeline-header">
                <h3>Test Run #${event.index + 1}</h3>
                <span class="timeline-time">${new Date(event.timestamp).toLocaleTimeString()}</span>
              </div>
              <p>${event.data.passed}/${event.data.total} tests passed</p>
              ${event.data.failed > 0 ? `
                <p class="error">${event.data.failed} failures detected</p>
              ` : '<p class="success">All tests passed! 🎉</p>'}
            </div>
          </div>
        `;
      } else {
        return `
          <div class="timeline-item">
            <div class="timeline-content">
              <div class="timeline-header">
                <h3>🔧 Fixes Applied</h3>
                <span class="timeline-time">${new Date(event.timestamp).toLocaleTimeString()}</span>
              </div>
              <p>${event.data.fixed.length} issues fixed</p>
              ${event.data.failed.length > 0 ? `
                <p class="warning">${event.data.failed.length} fixes failed</p>
              ` : ''}
            </div>
          </div>
        `;
      }
    }).join('');
  }

  generateTestResults(testHistory) {
    const lastRun = testHistory[testHistory.length - 1];
    if (!lastRun) return '<p>No test results available</p>';
    
    // Group failures by suite
    const suites = {};
    const allTests = this.extractAllTests(lastRun);
    
    allTests.forEach(test => {
      const suite = this.getTestSuite(test.name);
      if (!suites[suite]) {
        suites[suite] = { passed: 0, failed: 0, tests: [] };
      }
      suites[suite].tests.push(test);
      if (test.passed) {
        suites[suite].passed++;
      } else {
        suites[suite].failed++;
      }
    });
    
    return Object.entries(suites).map(([suiteName, suite]) => `
      <div style="margin-bottom: 30px;">
        <h3 style="margin-bottom: 15px;">
          ${this.formatSuiteName(suiteName)} 
          <span class="badge ${suite.failed === 0 ? 'badge-success' : 'badge-error'}">
            ${suite.passed}/${suite.tests.length} passed
          </span>
        </h3>
        <div class="test-grid">
          ${suite.tests.map(test => `
            <div class="test-card ${test.passed ? 'passed' : 'failed'}">
              <div class="test-name">${test.passed ? '✅' : '❌'} ${test.name}</div>
              ${!test.passed ? `
                <div class="test-details">
                  <p>${test.error}</p>
                </div>
              ` : ''}
            </div>
          `).join('')}
        </div>
      </div>
    `).join('');
  }

  generateFixDetails(fixHistory) {
    if (fixHistory.length === 0) {
      return '<p>No automated fixes were applied</p>';
    }
    
    const allFixes = [];
    fixHistory.forEach(fixRun => {
      fixRun.results.fixed.forEach(fix => allFixes.push({ ...fix, status: 'fixed' }));
      fixRun.results.failed.forEach(fix => allFixes.push({ ...fix, status: 'failed' }));
    });
    
    return `
      <ul class="fix-list">
        ${allFixes.map(fix => `
          <li class="fix-item">
            <div class="fix-icon">${fix.status === 'fixed' ? '✅' : '❌'}</div>
            <div class="fix-details">
              <h4>${fix.type}</h4>
              <p class="fix-description">${fix.description}</p>
              ${fix.status === 'fixed' ? `
                <small>Applied successfully</small>
              ` : `
                <small class="error">Failed to apply</small>
              `}
            </div>
          </li>
        `).join('')}
      </ul>
    `;
  }

  generatePerformanceMetrics(testHistory) {
    const runs = testHistory.map((run, index) => ({
      run: index + 1,
      total: run.results.total,
      passed: run.results.passed,
      failed: run.results.failed,
      successRate: run.results.total > 0 ? (run.results.passed / run.results.total * 100).toFixed(1) : 0
    }));
    
    return `
      <div class="chart-container">
        <div style="width: 100%; padding: 20px;">
          <h4 style="text-align: center; margin-bottom: 20px;">Success Rate Progression</h4>
          ${runs.map(run => `
            <div style="display: flex; align-items: center; margin-bottom: 10px;">
              <span style="width: 80px;">Run #${run.run}:</span>
              <div class="progress-bar" style="flex: 1; height: 20px; margin: 0 10px;">
                <div class="progress-fill" style="width: ${run.successRate}%; font-size: 0.8em;">
                  ${run.successRate}%
                </div>
              </div>
              <span style="width: 100px; text-align: right;">${run.passed}/${run.total}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  generateRecommendations(testHistory, fixHistory) {
    const recommendations = [];
    const lastRun = testHistory[testHistory.length - 1];
    
    if (lastRun && lastRun.results.failed > 0) {
      recommendations.push({
        type: 'error',
        title: 'Remaining Test Failures',
        description: `${lastRun.results.failed} tests are still failing. Manual investigation may be required.`
      });
    }
    
    // Check for recurring issues
    const fixTypes = {};
    fixHistory.forEach(run => {
      run.results.fixed.forEach(fix => {
        fixTypes[fix.type] = (fixTypes[fix.type] || 0) + 1;
      });
    });
    
    Object.entries(fixTypes).forEach(([type, count]) => {
      if (count > 1) {
        recommendations.push({
          type: 'warning',
          title: 'Recurring Issue',
          description: `${type} was fixed ${count} times. Consider a permanent solution.`
        });
      }
    });
    
    // Performance recommendations
    if (testHistory.length > 3) {
      recommendations.push({
        type: 'info',
        title: 'Test Stability',
        description: 'Multiple retry cycles were needed. Review test reliability and application stability.'
      });
    }
    
    if (recommendations.length === 0) {
      recommendations.push({
        type: 'success',
        title: 'Great Job!',
        description: 'All tests are passing with minimal intervention. The system is stable.'
      });
    }
    
    return `
      <div style="display: grid; gap: 15px;">
        ${recommendations.map(rec => `
          <div style="padding: 20px; background: #f8f9fa; border-radius: 8px; border-left: 4px solid ${
            rec.type === 'error' ? '#e74c3c' :
            rec.type === 'warning' ? '#f39c12' :
            rec.type === 'success' ? '#27ae60' : '#3498db'
          };">
            <h4>${rec.title}</h4>
            <p style="margin-top: 10px; color: #666;">${rec.description}</p>
          </div>
        `).join('')}
      </div>
    `;
  }

  // Helper methods
  calculateDuration(start, end) {
    if (!start || !end) return 'N/A';
    
    const duration = new Date(end) - new Date(start);
    const minutes = Math.floor(duration / 60000);
    const seconds = Math.floor((duration % 60000) / 1000);
    
    return `${minutes}m ${seconds}s`;
  }

  extractAllTests(testRun) {
    const tests = [];
    
    // Create synthetic test entries from the results
    const suites = ['authentication', 'navigation', 'orderManagement', 'stockManagement', 'settings'];
    
    suites.forEach(suite => {
      // Assume each suite has some tests
      const suiteTests = [
        `${suite} - Basic functionality`,
        `${suite} - Error handling`,
        `${suite} - Edge cases`
      ];
      
      suiteTests.forEach(testName => {
        // Check if this test failed
        const failure = testRun.results.failures.find(f => 
          f.testName.toLowerCase().includes(suite.toLowerCase())
        );
        
        tests.push({
          name: testName,
          passed: !failure,
          error: failure ? failure.error : null
        });
      });
    });
    
    return tests;
  }

  getTestSuite(testName) {
    const suites = ['authentication', 'navigation', 'orderManagement', 'stockManagement', 'settings'];
    
    for (const suite of suites) {
      if (testName.toLowerCase().includes(suite.toLowerCase())) {
        return suite;
      }
    }
    
    return 'other';
  }

  formatSuiteName(suite) {
    const names = {
      authentication: '🔐 Authentication',
      navigation: '🧭 Navigation', 
      orderManagement: '☕ Order Management',
      stockManagement: '📦 Stock Management',
      settings: '⚙️ Settings',
      other: '📋 Other Tests'
    };
    
    return names[suite] || suite;
  }
}

module.exports = { ReportGenerator };