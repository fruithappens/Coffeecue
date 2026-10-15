/**
 * Report Generator Module
 * Generates comprehensive test reports
 */

const fs = require('fs').promises;
const path = require('path');

class ReportGenerator {
    constructor(config) {
        this.config = config;
    }

    async generateReport(results) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const reportName = `autonomous-test-report-${timestamp}.html`;
        const reportPath = path.join(this.config.reportDir, reportName);
        
        const html = this.generateHtml(results);
        await fs.writeFile(reportPath, html);
        
        // Also generate JSON report
        const jsonPath = path.join(this.config.reportDir, `autonomous-test-results-${timestamp}.json`);
        await fs.writeFile(jsonPath, JSON.stringify(results, null, 2));
        
        return reportPath;
    }

    generateHtml(results) {
        const { cycles, finalStatus, totalDuration } = results;
        const lastCycle = cycles[cycles.length - 1] || {};
        
        return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Coffee Cue Autonomous Test Report</title>
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
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 40px;
            border-radius: 10px;
            text-align: center;
            margin-bottom: 30px;
        }
        
        .header h1 {
            margin: 0;
            font-size: 2.5em;
        }
        
        .summary {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        
        .summary-card {
            background: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            text-align: center;
        }
        
        .summary-card h3 {
            margin: 0 0 10px 0;
            color: #666;
            font-size: 0.9em;
            text-transform: uppercase;
        }
        
        .summary-card .value {
            font-size: 2em;
            font-weight: bold;
            color: #333;
        }
        
        .passed { color: #10b981; }
        .failed { color: #ef4444; }
        .warning { color: #f59e0b; }
        
        .section {
            background: white;
            padding: 30px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            margin-bottom: 20px;
        }
        
        .section h2 {
            margin-top: 0;
            color: #333;
            border-bottom: 2px solid #e5e7eb;
            padding-bottom: 10px;
        }
        
        .cycle {
            border: 1px solid #e5e7eb;
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 20px;
        }
        
        .cycle-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 15px;
        }
        
        .test-result {
            background: #f9fafb;
            padding: 10px 15px;
            margin: 5px 0;
            border-radius: 5px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .test-result.passed {
            border-left: 4px solid #10b981;
        }
        
        .test-result.failed {
            border-left: 4px solid #ef4444;
        }
        
        .issue {
            background: #fef3c7;
            padding: 15px;
            margin: 10px 0;
            border-radius: 5px;
            border-left: 4px solid #f59e0b;
        }
        
        .fix {
            background: #d1fae5;
            padding: 15px;
            margin: 10px 0;
            border-radius: 5px;
            border-left: 4px solid #10b981;
        }
        
        .timeline {
            position: relative;
            padding: 20px 0;
        }
        
        .timeline-item {
            display: flex;
            align-items: center;
            margin: 20px 0;
        }
        
        .timeline-marker {
            width: 40px;
            height: 40px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: bold;
            color: white;
            margin-right: 20px;
            flex-shrink: 0;
        }
        
        .timeline-marker.passed { background: #10b981; }
        .timeline-marker.failed { background: #ef4444; }
        .timeline-marker.fixed { background: #3b82f6; }
        
        pre {
            background: #1f2937;
            color: #fff;
            padding: 15px;
            border-radius: 5px;
            overflow-x: auto;
        }
        
        .chart {
            margin: 20px 0;
            height: 300px;
        }
        
        .recommendations {
            background: #eff6ff;
            border: 1px solid #3b82f6;
            padding: 20px;
            border-radius: 8px;
            margin: 20px 0;
        }
        
        .recommendations h3 {
            margin-top: 0;
            color: #1e40af;
        }
        
        .recommendations ul {
            margin: 10px 0;
        }
        
        .footer {
            text-align: center;
            color: #666;
            margin-top: 40px;
            padding-top: 20px;
            border-top: 1px solid #e5e7eb;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>🤖 Coffee Cue Autonomous Test Report</h1>
        <p>Generated: ${new Date(results.startTime).toLocaleString()}</p>
    </div>
    
    <div class="summary">
        <div class="summary-card">
            <h3>Final Status</h3>
            <div class="value ${finalStatus === 'passed' ? 'passed' : 'failed'}">
                ${finalStatus.toUpperCase()}
            </div>
        </div>
        <div class="summary-card">
            <h3>Total Duration</h3>
            <div class="value">${Math.round(totalDuration / 1000)}s</div>
        </div>
        <div class="summary-card">
            <h3>Test Cycles</h3>
            <div class="value">${cycles.length}</div>
        </div>
        <div class="summary-card">
            <h3>Total Tests</h3>
            <div class="value">${this.getTotalTests(cycles)}</div>
        </div>
    </div>
    
    <div class="section">
        <h2>📊 Test Timeline</h2>
        <div class="timeline">
            ${cycles.map((cycle, index) => this.generateTimelineItem(cycle, index)).join('')}
        </div>
    </div>
    
    ${cycles.map((cycle, index) => this.generateCycleSection(cycle, index)).join('')}
    
    <div class="section recommendations">
        <h3>🎯 Recommendations</h3>
        ${this.generateRecommendations(results)}
    </div>
    
    <div class="section">
        <h2>📈 Performance Metrics</h2>
        ${this.generateMetrics(results)}
    </div>
    
    <div class="footer">
        <p>Generated by Coffee Cue Autonomous Test System v1.0.0</p>
    </div>
</body>
</html>`;
    }

    generateTimelineItem(cycle, index) {
        const icon = cycle.status === 'passed' ? '✓' : cycle.status === 'fixed' ? '🔧' : '✗';
        
        return `
            <div class="timeline-item">
                <div class="timeline-marker ${cycle.status}">
                    ${icon}
                </div>
                <div>
                    <strong>Cycle ${cycle.number}</strong>: 
                    ${cycle.status.charAt(0).toUpperCase() + cycle.status.slice(1)}
                    ${cycle.testResults ? 
                        `(${cycle.testResults.summary.passed}/${cycle.testResults.summary.total} passed)` : 
                        ''}
                    - ${Math.round(cycle.duration / 1000)}s
                </div>
            </div>`;
    }

    generateCycleSection(cycle, index) {
        return `
            <div class="section">
                <h2>Cycle ${cycle.number} Details</h2>
                <div class="cycle">
                    <div class="cycle-header">
                        <div>
                            <strong>Status:</strong> 
                            <span class="${cycle.status === 'passed' ? 'passed' : 'failed'}">
                                ${cycle.status.toUpperCase()}
                            </span>
                        </div>
                        <div>
                            <strong>Duration:</strong> ${Math.round(cycle.duration / 1000)}s
                        </div>
                    </div>
                    
                    ${cycle.testResults ? this.generateTestResults(cycle.testResults) : ''}
                    ${cycle.issues && cycle.issues.length > 0 ? this.generateIssues(cycle.issues) : ''}
                    ${cycle.fixes && cycle.fixes.length > 0 ? this.generateFixes(cycle.fixes) : ''}
                </div>
            </div>`;
    }

    generateTestResults(results) {
        const testsByStatus = {
            passed: results.tests.filter(t => t.passed),
            failed: results.tests.filter(t => !t.passed)
        };
        
        return `
            <div>
                <h3>Test Results (${results.summary.passed}/${results.summary.total} passed)</h3>
                ${results.tests.map(test => `
                    <div class="test-result ${test.passed ? 'passed' : 'failed'}">
                        <div>
                            <strong>${test.suite}</strong>: ${test.name}
                        </div>
                        <div>
                            ${test.passed ? '✓ Passed' : '✗ Failed'}
                            ${test.error ? `: ${test.error}` : ''}
                        </div>
                    </div>
                `).join('')}
            </div>`;
    }

    generateIssues(issues) {
        return `
            <div>
                <h3>🔍 Issues Identified</h3>
                ${issues.map(issue => `
                    <div class="issue">
                        <strong>${issue.type}</strong> (${issue.severity} severity)
                        <br>Test: ${issue.test.suite} - ${issue.test.name}
                        <br>Suggested Fix: ${issue.suggestedFix}
                    </div>
                `).join('')}
            </div>`;
    }

    generateFixes(fixes) {
        return `
            <div>
                <h3>🔧 Fixes Applied</h3>
                ${fixes.map(fix => `
                    <div class="fix">
                        <strong>${fix.issue}</strong>: 
                        ${fix.success ? 
                            `✓ ${fix.action || 'Fixed successfully'}` : 
                            `✗ Failed: ${fix.error}`}
                    </div>
                `).join('')}
            </div>`;
    }

    generateRecommendations(results) {
        const recommendations = [];
        const failedCycles = results.cycles.filter(c => c.status === 'failed');
        
        if (results.finalStatus === 'passed') {
            recommendations.push('✅ All tests passed! Consider adding more test coverage.');
        } else {
            // Analyze common failures
            const allIssues = results.cycles.flatMap(c => c.issues || []);
            const issueTypes = {};
            
            allIssues.forEach(issue => {
                issueTypes[issue.type] = (issueTypes[issue.type] || 0) + 1;
            });
            
            // Sort by frequency
            const sortedIssues = Object.entries(issueTypes)
                .sort(([,a], [,b]) => b - a);
            
            if (sortedIssues.length > 0) {
                recommendations.push(`🔴 Most common issues: ${sortedIssues.slice(0, 3).map(([type, count]) => `${type} (${count}x)`).join(', ')}`);
            }
            
            if (issueTypes.authentication > 0) {
                recommendations.push('🔐 Fix authentication system - ensure backend is running and credentials are correct');
            }
            
            if (issueTypes.network_error > 0) {
                recommendations.push('🌐 Check backend service status and network connectivity');
            }
            
            if (issueTypes.missing_element > 2) {
                recommendations.push('🎯 Update test selectors to match current UI');
            }
        }
        
        recommendations.push('📚 Review detailed test logs for specific error messages');
        recommendations.push('🔄 Run tests in different environments to ensure consistency');
        
        return `<ul>${recommendations.map(r => `<li>${r}</li>`).join('')}</ul>`;
    }

    generateMetrics(results) {
        const metrics = {
            avgCycleDuration: results.cycles.reduce((sum, c) => sum + (c.duration || 0), 0) / results.cycles.length,
            totalTestsRun: this.getTotalTests(results.cycles),
            fixSuccessRate: this.getFixSuccessRate(results.cycles),
            firstCyclePassRate: results.cycles[0]?.testResults ? 
                (results.cycles[0].testResults.summary.passed / results.cycles[0].testResults.summary.total * 100).toFixed(1) : 0
        };
        
        return `
            <div class="summary">
                <div class="summary-card">
                    <h3>Avg Cycle Duration</h3>
                    <div class="value">${Math.round(metrics.avgCycleDuration / 1000)}s</div>
                </div>
                <div class="summary-card">
                    <h3>Total Tests Run</h3>
                    <div class="value">${metrics.totalTestsRun}</div>
                </div>
                <div class="summary-card">
                    <h3>Fix Success Rate</h3>
                    <div class="value">${metrics.fixSuccessRate}%</div>
                </div>
                <div class="summary-card">
                    <h3>Initial Pass Rate</h3>
                    <div class="value">${metrics.firstCyclePassRate}%</div>
                </div>
            </div>`;
    }

    getTotalTests(cycles) {
        return cycles.reduce((sum, cycle) => 
            sum + (cycle.testResults?.summary.total || 0), 0);
    }

    getFixSuccessRate(cycles) {
        const allFixes = cycles.flatMap(c => c.fixes || []);
        if (allFixes.length === 0) return 0;
        
        const successful = allFixes.filter(f => f.success).length;
        return (successful / allFixes.length * 100).toFixed(1);
    }
}

module.exports = ReportGenerator;