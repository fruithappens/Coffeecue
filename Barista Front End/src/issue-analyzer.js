/**
 * Issue Analyzer for Coffee Cue
 * Analyzes test failures and identifies fixable issues
 */

class IssueAnalyzer {
  constructor(config) {
    this.config = config;
    
    // Define issue patterns and their fixes
    this.issuePatterns = [
      {
        type: 'MISSING_TOKEN',
        patterns: [
          /not logged in/i,
          /no token found/i,
          /unauthorized/i,
          /401/
        ],
        description: 'Authentication token missing or invalid',
        fixable: true,
        priority: 1
      },
      {
        type: 'ELEMENT_NOT_FOUND',
        patterns: [
          /waiting for selector .* failed/i,
          /cannot find element/i,
          /no element found/i,
          /timeout.*waiting for/i
        ],
        description: 'UI element not found within timeout',
        fixable: true,
        priority: 2
      },
      {
        type: 'NETWORK_ERROR',
        patterns: [
          /network error/i,
          /failed to fetch/i,
          /ERR_CONNECTION_REFUSED/i,
          /net::ERR_/i
        ],
        description: 'Network connection issue',
        fixable: true,
        priority: 1
      },
      {
        type: 'LOCALSTORAGE_ERROR',
        patterns: [
          /localStorage.*undefined/i,
          /cannot read.*localStorage/i,
          /localStorage.*null/i
        ],
        description: 'LocalStorage access issue',
        fixable: true,
        priority: 1
      },
      {
        type: 'NAVIGATION_TIMEOUT',
        patterns: [
          /navigation timeout/i,
          /timeout.*exceeded.*navigation/i
        ],
        description: 'Page navigation timeout',
        fixable: true,
        priority: 2
      },
      {
        type: 'CONSOLE_ERROR',
        patterns: [
          /uncaught.*error/i,
          /cannot read property/i,
          /undefined is not/i
        ],
        description: 'JavaScript console error',
        fixable: true,
        priority: 3
      },
      {
        type: 'DEMO_MODE_CONFLICT',
        patterns: [
          /demo mode/i,
          /mock data/i,
          /offline mode/i
        ],
        description: 'Demo mode interfering with tests',
        fixable: true,
        priority: 2
      },
      {
        type: 'STALE_DATA',
        patterns: [
          /stale element/i,
          /element is not attached/i,
          /node.*removed/i
        ],
        description: 'DOM element became stale',
        fixable: true,
        priority: 3
      },
      {
        type: 'CORS_ERROR',
        patterns: [
          /CORS/i,
          /cross-origin/i,
          /blocked by CORS policy/i
        ],
        description: 'Cross-origin request blocked',
        fixable: true,
        priority: 1
      },
      {
        type: 'SESSION_EXPIRED',
        patterns: [
          /session expired/i,
          /token expired/i,
          /jwt expired/i
        ],
        description: 'Authentication session expired',
        fixable: true,
        priority: 1
      }
    ];
  }

  async analyze(testResults) {
    const issues = [];
    const seenIssues = new Set();

    // Analyze each failure
    for (const failure of testResults.failures) {
      const detectedIssues = this.detectIssues(failure);
      
      for (const issue of detectedIssues) {
        const issueKey = `${issue.type}-${issue.testName}`;
        
        // Avoid duplicate issues
        if (!seenIssues.has(issueKey)) {
          seenIssues.add(issueKey);
          issues.push({
            ...issue,
            failure: failure
          });
        }
      }
    }

    // Sort by priority
    issues.sort((a, b) => a.priority - b.priority);

    // Add contextual analysis
    await this.addContextualAnalysis(issues, testResults);

    return issues;
  }

  detectIssues(failure) {
    const issues = [];
    const errorText = `${failure.error} ${failure.stack || ''}`.toLowerCase();

    for (const pattern of this.issuePatterns) {
      const matches = pattern.patterns.some(p => p.test(errorText));
      
      if (matches) {
        issues.push({
          type: pattern.type,
          description: pattern.description,
          fixable: pattern.fixable,
          priority: pattern.priority,
          testName: failure.testName,
          error: failure.error,
          pattern: pattern
        });
      }
    }

    // If no specific issue detected, create a generic one
    if (issues.length === 0) {
      issues.push({
        type: 'UNKNOWN_ERROR',
        description: 'Unknown test failure',
        fixable: false,
        priority: 99,
        testName: failure.testName,
        error: failure.error
      });
    }

    return issues;
  }

  async addContextualAnalysis(issues, testResults) {
    // Group issues by type
    const issuesByType = {};
    for (const issue of issues) {
      if (!issuesByType[issue.type]) {
        issuesByType[issue.type] = [];
      }
      issuesByType[issue.type].push(issue);
    }

    // Add contextual information
    for (const issue of issues) {
      issue.context = {
        totalFailures: testResults.failures.length,
        relatedIssues: issuesByType[issue.type].length,
        testSuite: this.getTestSuite(issue.testName),
        timestamp: new Date().toISOString()
      };

      // Add specific context based on issue type
      switch (issue.type) {
        case 'ELEMENT_NOT_FOUND':
          issue.context.selector = this.extractSelector(issue.error);
          issue.context.possibleCauses = [
            'Element hasn\'t loaded yet',
            'Selector has changed',
            'Page structure has changed',
            'Element is conditionally rendered'
          ];
          break;

        case 'MISSING_TOKEN':
          issue.context.possibleCauses = [
            'Login failed',
            'Token expired',
            'LocalStorage cleared',
            'Authentication service down'
          ];
          break;

        case 'NETWORK_ERROR':
          issue.context.endpoint = this.extractEndpoint(issue.error);
          issue.context.possibleCauses = [
            'Backend service not running',
            'Wrong API URL',
            'Network connectivity issue',
            'Firewall blocking request'
          ];
          break;

        case 'NAVIGATION_TIMEOUT':
          issue.context.url = this.extractUrl(issue.error);
          issue.context.possibleCauses = [
            'Page loading too slowly',
            'JavaScript errors preventing load',
            'Infinite redirect loop',
            'Heavy resources blocking load'
          ];
          break;
      }

      // Add fix suggestions
      issue.suggestedFixes = this.getSuggestedFixes(issue.type);
    }
  }

  extractSelector(error) {
    const match = error.match(/selector[:\s]+(["'])?([^"'\s]+)(["'])?/i);
    return match ? match[2] : 'unknown';
  }

  extractEndpoint(error) {
    const match = error.match(/https?:\/\/[^\s]+/i);
    return match ? match[0] : 'unknown';
  }

  extractUrl(error) {
    const match = error.match(/navigating to[:\s]+(["'])?([^"'\s]+)(["'])?/i);
    return match ? match[2] : 'unknown';
  }

  getTestSuite(testName) {
    const suites = ['authentication', 'navigation', 'orderManagement', 'stockManagement', 'settings'];
    
    for (const suite of suites) {
      if (testName.toLowerCase().includes(suite.toLowerCase())) {
        return suite;
      }
    }
    
    return 'unknown';
  }

  getSuggestedFixes(issueType) {
    const fixes = {
      MISSING_TOKEN: [
        'Re-authenticate with valid credentials',
        'Clear localStorage and login fresh',
        'Check if authentication service is running',
        'Verify credentials are correct'
      ],
      ELEMENT_NOT_FOUND: [
        'Increase wait timeout',
        'Update selector to match current DOM',
        'Add explicit wait for element',
        'Check if element is conditionally rendered'
      ],
      NETWORK_ERROR: [
        'Verify backend service is running',
        'Check API URL configuration',
        'Test network connectivity',
        'Check for CORS issues'
      ],
      LOCALSTORAGE_ERROR: [
        'Initialize localStorage properly',
        'Add localStorage polyfill',
        'Check browser compatibility',
        'Clear and reinitialize storage'
      ],
      NAVIGATION_TIMEOUT: [
        'Increase navigation timeout',
        'Check for JavaScript errors',
        'Verify page URL is correct',
        'Check for redirect loops'
      ],
      DEMO_MODE_CONFLICT: [
        'Disable demo mode',
        'Clear demo data',
        'Force real API connection',
        'Reset application state'
      ],
      CORS_ERROR: [
        'Configure CORS on backend',
        'Use proxy for API calls',
        'Check origin whitelist',
        'Verify API endpoint URL'
      ],
      SESSION_EXPIRED: [
        'Refresh authentication token',
        'Re-login with credentials',
        'Implement token auto-refresh',
        'Check token expiration time'
      ]
    };

    return fixes[issueType] || ['Manual investigation required'];
  }

  // Generate a priority score for fixing order
  calculateFixPriority(issue) {
    let score = issue.priority * 10;

    // Boost priority for auth issues
    if (['MISSING_TOKEN', 'SESSION_EXPIRED'].includes(issue.type)) {
      score -= 20;
    }

    // Boost priority for blocking issues
    if (['NETWORK_ERROR', 'CORS_ERROR'].includes(issue.type)) {
      score -= 15;
    }

    // Lower priority for UI-only issues
    if (['ELEMENT_NOT_FOUND', 'STALE_DATA'].includes(issue.type)) {
      score += 10;
    }

    // Consider how many tests are affected
    score += issue.context?.relatedIssues || 0;

    return score;
  }
}

module.exports = { IssueAnalyzer };