/**
 * Issue Analyzer Module
 * Analyzes test failures and identifies fixable issues
 */

class IssueAnalyzer {
    constructor() {
        this.issuePatterns = [
            {
                type: 'authentication',
                patterns: [
                    /login.*failed/i,
                    /authentication.*error/i,
                    /unauthorized/i,
                    /401/
                ],
                severity: 'high',
                fixable: true
            },
            {
                type: 'missing_element',
                patterns: [
                    /no.*found/i,
                    /element.*not.*found/i,
                    /waiting.*timed out/i,
                    /cannot.*find/i
                ],
                severity: 'medium',
                fixable: true
            },
            {
                type: 'network_error',
                patterns: [
                    /network.*error/i,
                    /fetch.*failed/i,
                    /ERR_.*FAILED/,
                    /socket.*hang up/i
                ],
                severity: 'high',
                fixable: true
            },
            {
                type: 'permission_error',
                patterns: [
                    /permission.*denied/i,
                    /403/,
                    /forbidden/i,
                    /not.*authorized/i
                ],
                severity: 'medium',
                fixable: true
            },
            {
                type: 'state_error',
                patterns: [
                    /state.*not.*found/i,
                    /undefined.*property/i,
                    /cannot.*read.*property/i,
                    /null.*reference/i
                ],
                severity: 'medium',
                fixable: true
            },
            {
                type: 'timeout',
                patterns: [
                    /timeout/i,
                    /timed.*out/i,
                    /exceeded.*time/i
                ],
                severity: 'low',
                fixable: true
            },
            {
                type: 'localStorage',
                patterns: [
                    /localStorage/i,
                    /storage.*error/i,
                    /quota.*exceeded/i
                ],
                severity: 'low',
                fixable: true
            },
            {
                type: 'cors',
                patterns: [
                    /CORS/,
                    /cross-origin/i,
                    /blocked.*by.*CORS/i
                ],
                severity: 'high',
                fixable: true
            },
            {
                type: 'ui_change',
                patterns: [
                    /selector.*not.*found/i,
                    /element.*changed/i,
                    /no.*matching.*element/i
                ],
                severity: 'medium',
                fixable: true
            },
            {
                type: 'data_format',
                patterns: [
                    /JSON.*parse.*error/i,
                    /invalid.*format/i,
                    /unexpected.*token/i
                ],
                severity: 'medium',
                fixable: true
            }
        ];
    }

    analyzeResults(testResults) {
        const issues = [];
        const failedTests = testResults.tests.filter(test => !test.passed);

        for (const test of failedTests) {
            const issue = this.analyzeTest(test);
            if (issue) {
                issues.push(issue);
            }
        }

        // Remove duplicates and prioritize
        const uniqueIssues = this.deduplicateIssues(issues);
        const prioritizedIssues = this.prioritizeIssues(uniqueIssues);

        return prioritizedIssues;
    }

    analyzeTest(test) {
        const errorText = test.error || test.message || '';
        
        for (const pattern of this.issuePatterns) {
            const matches = pattern.patterns.some(p => p.test(errorText));
            
            if (matches) {
                return {
                    type: pattern.type,
                    severity: pattern.severity,
                    fixable: pattern.fixable,
                    test: {
                        suite: test.suite,
                        name: test.name,
                        error: errorText
                    },
                    context: this.getContextForIssue(pattern.type, test),
                    suggestedFix: this.getSuggestedFix(pattern.type, test)
                };
            }
        }

        // Generic issue if no pattern matches
        return {
            type: 'unknown',
            severity: 'low',
            fixable: false,
            test: {
                suite: test.suite,
                name: test.name,
                error: errorText
            },
            context: {},
            suggestedFix: 'Manual investigation required'
        };
    }

    getContextForIssue(issueType, test) {
        const context = {
            timestamp: test.timestamp,
            suite: test.suite,
            testName: test.name
        };

        switch (issueType) {
            case 'authentication':
                context.needsLogin = true;
                context.credentials = { username: 'barista', password: 'barista123' };
                break;
            
            case 'missing_element':
                // Extract selector from error if possible
                const selectorMatch = test.error.match(/["']([^"']+)["']/);
                if (selectorMatch) {
                    context.missingSelector = selectorMatch[1];
                }
                break;
            
            case 'network_error':
                context.apiUrl = 'http://localhost:5001';
                context.needsBackend = true;
                break;
            
            case 'localStorage':
                context.storageKeys = [
                    'coffee_cue_barista_settings',
                    'coffee_system_token',
                    'use_fallback_data'
                ];
                break;
        }

        return context;
    }

    getSuggestedFix(issueType, test) {
        const fixes = {
            authentication: 'Clear auth tokens and re-login with valid credentials',
            missing_element: 'Wait for element or use alternative selector',
            network_error: 'Check backend status or enable offline mode',
            permission_error: 'Check user role or use admin credentials',
            state_error: 'Initialize component state or clear localStorage',
            timeout: 'Increase timeout or optimize page load',
            localStorage: 'Clear localStorage or increase quota',
            cors: 'Update CORS configuration or use proxy',
            ui_change: 'Update selectors to match new UI',
            data_format: 'Validate data format or add error handling'
        };

        return fixes[issueType] || 'Investigate and fix manually';
    }

    deduplicateIssues(issues) {
        const seen = new Set();
        const unique = [];

        for (const issue of issues) {
            const key = `${issue.type}-${issue.test.suite}`;
            if (!seen.has(key)) {
                seen.add(key);
                unique.push(issue);
            }
        }

        return unique;
    }

    prioritizeIssues(issues) {
        const severityOrder = { high: 0, medium: 1, low: 2 };
        
        return issues.sort((a, b) => {
            // Sort by severity first
            const severityDiff = severityOrder[a.severity] - severityOrder[b.severity];
            if (severityDiff !== 0) return severityDiff;
            
            // Then by fixability
            if (a.fixable && !b.fixable) return -1;
            if (!a.fixable && b.fixable) return 1;
            
            // Then by type (authentication issues first)
            if (a.type === 'authentication') return -1;
            if (b.type === 'authentication') return 1;
            
            return 0;
        });
    }

    generateAnalysisReport(issues) {
        const report = {
            summary: {
                total: issues.length,
                fixable: issues.filter(i => i.fixable).length,
                bySeverity: {
                    high: issues.filter(i => i.severity === 'high').length,
                    medium: issues.filter(i => i.severity === 'medium').length,
                    low: issues.filter(i => i.severity === 'low').length
                },
                byType: {}
            },
            issues: issues,
            recommendations: this.generateRecommendations(issues)
        };

        // Count by type
        for (const issue of issues) {
            report.summary.byType[issue.type] = (report.summary.byType[issue.type] || 0) + 1;
        }

        return report;
    }

    generateRecommendations(issues) {
        const recommendations = [];

        // Check for systemic issues
        const authIssues = issues.filter(i => i.type === 'authentication').length;
        if (authIssues > 2) {
            recommendations.push({
                priority: 'high',
                action: 'Fix authentication system',
                reason: `${authIssues} authentication failures detected`
            });
        }

        const networkIssues = issues.filter(i => i.type === 'network_error').length;
        if (networkIssues > 0) {
            recommendations.push({
                priority: 'high',
                action: 'Check backend service status',
                reason: 'Network errors indicate backend may be down'
            });
        }

        const elementIssues = issues.filter(i => i.type === 'missing_element').length;
        if (elementIssues > 3) {
            recommendations.push({
                priority: 'medium',
                action: 'Update test selectors',
                reason: 'Multiple missing elements suggest UI changes'
            });
        }

        return recommendations;
    }
}

module.exports = IssueAnalyzer;