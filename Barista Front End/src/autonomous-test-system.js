#!/usr/bin/env node

/**
 * Autonomous Test System for Coffee Cue
 * Main orchestrator that coordinates testing, analysis, fixing, and reporting
 */

const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const path = require('path');
const { TestRunner } = require('./test-runner');
const { IssueAnalyzer } = require('./issue-analyzer');
const { AutoFixer } = require('./auto-fixer');
const { ReportGenerator } = require('./report-generator');

class AutonomousTestSystem {
  constructor(config = {}) {
    this.config = {
      maxRetries: config.maxRetries || 5,
      baseUrl: config.baseUrl || 'http://localhost:3000',
      headless: config.headless !== false,
      slowMo: config.slowMo || 50,
      timeout: config.timeout || 30000,
      logsDir: config.logsDir || path.join(__dirname, 'test-logs'),
      screenshotsDir: config.screenshotsDir || path.join(__dirname, 'test-screenshots'),
      ...config
    };

    this.testRunner = new TestRunner(this.config);
    this.issueAnalyzer = new IssueAnalyzer(this.config);
    this.autoFixer = new AutoFixer(this.config);
    this.reportGenerator = new ReportGenerator(this.config);

    this.sessionId = new Date().toISOString().replace(/[:.]/g, '-');
    this.currentRetry = 0;
    this.testHistory = [];
    this.fixHistory = [];
  }

  async initialize() {
    // Create necessary directories
    await fs.mkdir(this.config.logsDir, { recursive: true });
    await fs.mkdir(this.config.screenshotsDir, { recursive: true });
    
    // Initialize log file
    this.logFile = path.join(this.config.logsDir, `session-${this.sessionId}.log`);
    await this.log('🚀 Autonomous Test System Starting', 'info');
    await this.log(`Configuration: ${JSON.stringify(this.config, null, 2)}`, 'debug');

    // Check if frontend is running
    try {
      const response = await fetch(this.config.baseUrl);
      if (!response.ok) {
        throw new Error(`Frontend not accessible at ${this.config.baseUrl}`);
      }
      await this.log('✅ Frontend is accessible', 'info');
    } catch (error) {
      await this.log(`❌ Frontend not accessible: ${error.message}`, 'error');
      await this.log('Please ensure the frontend is running with: npm start', 'error');
      throw error;
    }

    // Check if backend is running
    try {
      const response = await fetch('http://localhost:5001/api/health');
      await this.log('✅ Backend is accessible', 'info');
    } catch (error) {
      await this.log('⚠️  Backend not accessible - tests may fail for API-dependent features', 'warn');
    }
  }

  async log(message, level = 'info') {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
    
    console.log(logEntry);
    
    if (this.logFile) {
      await fs.appendFile(this.logFile, logEntry + '\n').catch(console.error);
    }
  }

  async run() {
    try {
      await this.initialize();
      
      while (this.currentRetry <= this.config.maxRetries) {
        await this.log(`\n🔄 Test Cycle ${this.currentRetry + 1}/${this.config.maxRetries + 1}`, 'info');
        
        // Run tests
        const testResults = await this.runTests();
        
        // Check if all tests passed
        if (testResults.allPassed) {
          await this.log('🎉 All tests passed!', 'success');
          break;
        }
        
        // Analyze failures
        const issues = await this.analyzeFailures(testResults);
        
        if (issues.length === 0) {
          await this.log('❌ Tests failed but no fixable issues detected', 'error');
          break;
        }
        
        // Attempt to fix issues
        const fixResults = await this.fixIssues(issues);
        
        if (!fixResults.anyFixed) {
          await this.log('❌ No issues could be fixed automatically', 'error');
          break;
        }
        
        // Wait before retrying
        await this.log('⏳ Waiting 5 seconds before retry...', 'info');
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        this.currentRetry++;
      }
      
      // Generate final report
      await this.generateFinalReport();
      
    } catch (error) {
      await this.log(`Fatal error: ${error.message}`, 'error');
      await this.log(error.stack, 'debug');
      throw error;
    }
  }

  async runTests() {
    await this.log('🧪 Running test suite...', 'info');
    
    const results = await this.testRunner.runAll();
    
    this.testHistory.push({
      retry: this.currentRetry,
      timestamp: new Date().toISOString(),
      results
    });
    
    await this.log(`Test Results: ${results.passed}/${results.total} passed`, 'info');
    
    for (const failure of results.failures) {
      await this.log(`  ❌ ${failure.testName}: ${failure.error}`, 'error');
    }
    
    return results;
  }

  async analyzeFailures(testResults) {
    await this.log('🔍 Analyzing test failures...', 'info');
    
    const issues = await this.issueAnalyzer.analyze(testResults);
    
    await this.log(`Found ${issues.length} fixable issues:`, 'info');
    for (const issue of issues) {
      await this.log(`  - ${issue.type}: ${issue.description}`, 'info');
    }
    
    return issues;
  }

  async fixIssues(issues) {
    await this.log('🔧 Attempting to fix issues...', 'info');
    
    const fixResults = {
      fixed: [],
      failed: [],
      anyFixed: false
    };
    
    for (const issue of issues) {
      try {
        await this.log(`  Fixing ${issue.type}...`, 'info');
        const fixed = await this.autoFixer.fix(issue);
        
        if (fixed) {
          fixResults.fixed.push(issue);
          fixResults.anyFixed = true;
          await this.log(`    ✅ Fixed successfully`, 'success');
        } else {
          fixResults.failed.push(issue);
          await this.log(`    ❌ Fix failed`, 'error');
        }
      } catch (error) {
        fixResults.failed.push(issue);
        await this.log(`    ❌ Fix error: ${error.message}`, 'error');
      }
    }
    
    this.fixHistory.push({
      retry: this.currentRetry,
      timestamp: new Date().toISOString(),
      results: fixResults
    });
    
    return fixResults;
  }

  async generateFinalReport() {
    await this.log('\n📊 Generating final report...', 'info');
    
    const report = await this.reportGenerator.generate({
      sessionId: this.sessionId,
      testHistory: this.testHistory,
      fixHistory: this.fixHistory,
      totalRetries: this.currentRetry,
      config: this.config
    });
    
    const reportPath = path.join(this.config.logsDir, `report-${this.sessionId}.html`);
    await fs.writeFile(reportPath, report);
    
    await this.log(`✅ Report generated: ${reportPath}`, 'success');
    
    // Also generate a summary
    const summary = this.generateSummary();
    const summaryPath = path.join(this.config.logsDir, `summary-${this.sessionId}.json`);
    await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2));
    
    await this.log(`✅ Summary generated: ${summaryPath}`, 'success');
  }

  generateSummary() {
    const lastTest = this.testHistory[this.testHistory.length - 1];
    const totalTests = lastTest ? lastTest.results.total : 0;
    const passedTests = lastTest ? lastTest.results.passed : 0;
    
    const totalFixes = this.fixHistory.reduce((sum, fix) => 
      sum + fix.results.fixed.length, 0
    );
    
    return {
      sessionId: this.sessionId,
      startTime: this.testHistory[0]?.timestamp,
      endTime: new Date().toISOString(),
      totalRetries: this.currentRetry,
      finalTestResults: {
        total: totalTests,
        passed: passedTests,
        failed: totalTests - passedTests,
        successRate: totalTests > 0 ? (passedTests / totalTests * 100).toFixed(2) + '%' : '0%'
      },
      fixesApplied: totalFixes,
      success: lastTest?.results.allPassed || false
    };
  }
}

// CLI Runner
if (require.main === module) {
  const system = new AutonomousTestSystem({
    headless: process.argv.includes('--headless'),
    maxRetries: parseInt(process.argv.find(arg => arg.startsWith('--retries='))?.split('=')[1] || '5'),
    baseUrl: process.argv.find(arg => arg.startsWith('--url='))?.split('=')[1] || 'http://localhost:3000'
  });

  system.run()
    .then(() => {
      console.log('\n✅ Autonomous test system completed successfully');
      process.exit(0);
    })
    .catch(error => {
      console.error('\n❌ Autonomous test system failed:', error);
      process.exit(1);
    });
}

module.exports = { AutonomousTestSystem };