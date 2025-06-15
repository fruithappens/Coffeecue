#!/usr/bin/env node
/**
 * Autonomous Test System for Coffee Cue
 * Runs tests, analyzes failures, fixes issues, and retests automatically
 */

const TestRunner = require('./test-runner');
const IssueAnalyzer = require('./issue-analyzer');
const AutoFixer = require('./auto-fixer');
const ReportGenerator = require('./report-generator');
const fs = require('fs').promises;
const path = require('path');

class AutonomousTestSystem {
    constructor(config = {}) {
        this.config = {
            maxRetries: config.maxRetries || 5,
            headless: config.headless || false,
            baseUrl: config.baseUrl || 'http://localhost:3000',
            apiUrl: config.apiUrl || 'http://localhost:5001',
            screenshotDir: config.screenshotDir || './test-results/screenshots',
            reportDir: config.reportDir || './test-results',
            fixDelay: config.fixDelay || 2000, // Wait after fixes
            verbose: config.verbose || true
        };

        this.testRunner = new TestRunner(this.config);
        this.analyzer = new IssueAnalyzer();
        this.fixer = new AutoFixer(this.config);
        this.reporter = new ReportGenerator(this.config);
        
        this.results = {
            startTime: Date.now(),
            cycles: [],
            totalTests: 0,
            finalStatus: 'pending'
        };
    }

    log(message, level = 'info') {
        if (this.config.verbose) {
            const timestamp = new Date().toISOString();
            const levelEmoji = {
                info: 'ℹ️',
                success: '✅',
                warning: '⚠️',
                error: '❌',
                fix: '🔧'
            };
            console.log(`[${timestamp}] ${levelEmoji[level] || '📝'} ${message}`);
        }
    }

    async initialize() {
        this.log('Initializing Autonomous Test System...', 'info');
        
        // Create directories
        await fs.mkdir(this.config.screenshotDir, { recursive: true });
        await fs.mkdir(this.config.reportDir, { recursive: true });
        
        // Check if services are running
        const servicesReady = await this.checkServices();
        if (!servicesReady) {
            this.log('Services not ready. Please start frontend and backend.', 'error');
            return false;
        }
        
        this.log('System initialized successfully', 'success');
        return true;
    }

    async checkServices() {
        const checks = [
            { name: 'Frontend', url: this.config.baseUrl },
            { name: 'Backend', url: `${this.config.apiUrl}/api/orders` }
        ];
        
        for (const check of checks) {
            try {
                const response = await fetch(check.url);
                if (response.ok || response.status === 401) { // 401 is ok, means API is responding
                    this.log(`${check.name} is running`, 'success');
                } else {
                    throw new Error(`Status ${response.status}`);
                }
            } catch (error) {
                this.log(`${check.name} is not accessible: ${error.message}`, 'error');
                return false;
            }
        }
        
        return true;
    }

    async runCycle(cycleNumber) {
        this.log(`\n🔄 Starting Test Cycle ${cycleNumber}/${this.config.maxRetries}`, 'info');
        
        const cycle = {
            number: cycleNumber,
            startTime: Date.now(),
            testResults: null,
            issues: [],
            fixes: [],
            status: 'running'
        };

        try {
            // Run tests
            this.log('Running automated tests...', 'info');
            const testResults = await this.testRunner.runAllTests();
            cycle.testResults = testResults;
            
            // Check if all tests passed
            if (testResults.summary.failed === 0) {
                this.log('All tests passed! 🎉', 'success');
                cycle.status = 'passed';
                return cycle;
            }
            
            // Analyze failures
            this.log(`Analyzing ${testResults.summary.failed} failures...`, 'info');
            const issues = await this.analyzer.analyzeResults(testResults);
            cycle.issues = issues;
            
            if (issues.length === 0) {
                this.log('No fixable issues identified', 'warning');
                cycle.status = 'failed';
                return cycle;
            }
            
            // Attempt fixes
            this.log(`Attempting to fix ${issues.length} issues...`, 'fix');
            const fixes = await this.fixer.fixIssues(issues);
            cycle.fixes = fixes;
            
            const successfulFixes = fixes.filter(f => f.success).length;
            if (successfulFixes === 0) {
                this.log('No issues could be fixed automatically', 'error');
                cycle.status = 'failed';
                return cycle;
            }
            
            this.log(`Fixed ${successfulFixes}/${issues.length} issues`, 'success');
            
            // Wait before retrying
            await this.wait(this.config.fixDelay);
            
            cycle.status = 'fixed';
            return cycle;
            
        } catch (error) {
            this.log(`Cycle failed with error: ${error.message}`, 'error');
            cycle.status = 'error';
            cycle.error = error.message;
            return cycle;
        } finally {
            cycle.endTime = Date.now();
            cycle.duration = cycle.endTime - cycle.startTime;
        }
    }

    async run() {
        console.log(`
╔════════════════════════════════════════════════╗
║     🤖 Coffee Cue Autonomous Test System       ║
║     Version 1.0.0                              ║
╚════════════════════════════════════════════════╝
        `);

        // Initialize
        const initialized = await this.initialize();
        if (!initialized) {
            process.exit(1);
        }

        // Run test cycles
        let allTestsPassed = false;
        
        for (let i = 1; i <= this.config.maxRetries; i++) {
            const cycle = await this.runCycle(i);
            this.results.cycles.push(cycle);
            
            if (cycle.status === 'passed') {
                allTestsPassed = true;
                break;
            }
            
            if (cycle.status === 'failed' || cycle.status === 'error') {
                // No point retrying if we can't fix anything
                if (i < this.config.maxRetries && cycle.fixes && cycle.fixes.some(f => f.success)) {
                    this.log(`Retrying after fixes...`, 'info');
                } else {
                    break;
                }
            }
        }

        // Generate final report
        this.results.endTime = Date.now();
        this.results.totalDuration = this.results.endTime - this.results.startTime;
        this.results.finalStatus = allTestsPassed ? 'passed' : 'failed';
        
        const reportPath = await this.reporter.generateReport(this.results);
        
        // Summary
        console.log(`
╔════════════════════════════════════════════════╗
║               Final Results                    ║
╚════════════════════════════════════════════════╝
`);
        
        console.log(`Status: ${allTestsPassed ? '✅ PASSED' : '❌ FAILED'}`);
        console.log(`Total Cycles: ${this.results.cycles.length}`);
        console.log(`Total Duration: ${Math.round(this.results.totalDuration / 1000)}s`);
        console.log(`Report: ${reportPath}`);
        
        // Save results as JSON
        const jsonPath = path.join(this.config.reportDir, 'autonomous-test-results.json');
        await fs.writeFile(jsonPath, JSON.stringify(this.results, null, 2));
        
        // Exit with appropriate code
        process.exit(allTestsPassed ? 0 : 1);
    }

    async wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Run if called directly
if (require.main === module) {
    const args = process.argv.slice(2);
    const config = {};
    
    // Parse command line arguments
    args.forEach(arg => {
        if (arg === '--headless') config.headless = true;
        if (arg.startsWith('--retries=')) config.maxRetries = parseInt(arg.split('=')[1]);
        if (arg === '--verbose') config.verbose = true;
    });
    
    const system = new AutonomousTestSystem(config);
    system.run().catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}

module.exports = AutonomousTestSystem;