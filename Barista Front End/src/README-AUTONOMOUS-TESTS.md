# Coffee Cue Autonomous Test System

A fully autonomous testing system that runs UI tests, analyzes failures, automatically fixes issues, and retests until all tests pass.

## Features

- 🤖 **Fully Autonomous**: Runs without human intervention
- 🔧 **Self-Healing**: Automatically fixes common issues
- 🔄 **Smart Retries**: Retests after applying fixes
- 📊 **Comprehensive Reports**: Detailed HTML reports with metrics
- 🎯 **Issue Detection**: Identifies root causes of failures
- ⚡ **Performance Optimized**: Handles timeouts and slow elements
- 🛡️ **Error Recovery**: Gracefully handles unexpected errors

## Quick Start

```bash
# Run with GUI (see browser actions)
./run-autonomous-tests.sh

# Run headless (no browser window)
./run-autonomous-tests.sh --headless

# Run with custom retries
./run-autonomous-tests.sh --retries=10

# Run against different URL
./run-autonomous-tests.sh --url=http://localhost:3001
```

## System Components

### 1. **autonomous-test-system.js**
Main orchestrator that coordinates the entire testing process:
- Initializes the test environment
- Manages retry cycles
- Coordinates test execution, analysis, and fixing
- Generates final reports

### 2. **test-runner.js**
Executes automated UI tests using Puppeteer:
- Tests authentication flow
- Tests navigation between tabs
- Tests order management
- Tests stock management
- Tests settings functionality
- Tests walk-in orders
- Tests messaging features
- Tests display screens

### 3. **issue-analyzer.js**
Analyzes test failures and identifies fixable issues:
- Pattern matching for common errors
- Contextual analysis of failures
- Priority scoring for fixes
- Root cause identification

### 4. **auto-fixer.js**
Automatically fixes detected issues:
- Authentication token issues
- Missing UI elements
- Network errors
- LocalStorage problems
- Navigation timeouts
- Console errors
- Demo mode conflicts
- CORS issues
- Session expiration

### 5. **report-generator.js**
Creates comprehensive HTML reports:
- Executive summary with metrics
- Timeline of test runs and fixes
- Detailed test results by suite
- Applied fixes documentation
- Performance metrics
- Recommendations for improvement

## Issue Types and Fixes

| Issue Type | Description | Automated Fix |
|------------|-------------|---------------|
| MISSING_TOKEN | Authentication token missing | Injects valid token, patches AuthService |
| ELEMENT_NOT_FOUND | UI element not found | Adds wait helpers, increases timeouts |
| NETWORK_ERROR | API connection failed | Starts backend or enables offline mode |
| LOCALSTORAGE_ERROR | Storage access issue | Adds polyfill and error handling |
| NAVIGATION_TIMEOUT | Page load timeout | Increases timeout, optimizes performance |
| DEMO_MODE_CONFLICT | Demo mode interference | Disables demo mode, clears mock data |
| CORS_ERROR | Cross-origin blocked | Updates proxy config, adds headers |
| SESSION_EXPIRED | Auth session expired | Implements auto-refresh logic |

## Output Files

After running, you'll find:

- **test-logs/report-{sessionId}.html** - Beautiful HTML report
- **test-logs/summary-{sessionId}.json** - JSON summary of results
- **test-logs/session-{sessionId}.log** - Detailed execution logs
- **test-screenshots/*.png** - Screenshots of failures

## Configuration

Edit `autonomous-test-system.js` to customize:

```javascript
const config = {
  maxRetries: 5,              // Maximum retry attempts
  baseUrl: 'http://localhost:3000',  // Frontend URL
  headless: false,            // Run with/without browser window
  slowMo: 50,                 // Slow down actions (ms)
  timeout: 30000,             // Default timeout (ms)
  logsDir: './test-logs',     // Log directory
  screenshotsDir: './test-screenshots'  // Screenshots directory
};
```

## Requirements

- Node.js 14+
- npm or yarn
- Chrome/Chromium (automatically downloaded by Puppeteer)
- Coffee Cue frontend running
- (Optional) Coffee Cue backend running

## Installation

```bash
# Navigate to the test directory
cd "Barista Front End/src"

# Install dependencies
npm install

# Make script executable
chmod +x run-autonomous-tests.sh
```

## Advanced Usage

### Running Specific Test Suites

Modify `test-runner.js` to run only specific suites:

```javascript
this.testSuites = [
  'authentication',  // Comment out suites you don't want
  'orderManagement'
];
```

### Adding Custom Fixes

Add new fix handlers in `auto-fixer.js`:

```javascript
this.fixHandlers = {
  'CUSTOM_ISSUE': this.fixCustomIssue.bind(this),
  // ... other handlers
};

async fixCustomIssue(issue) {
  // Your fix logic here
  return { applied: true, description: 'Fixed custom issue' };
}
```

### Custom Issue Patterns

Add patterns in `issue-analyzer.js`:

```javascript
this.issuePatterns = [
  {
    type: 'CUSTOM_ERROR',
    patterns: [/your pattern/i],
    description: 'Your description',
    fixable: true,
    priority: 1
  },
  // ... other patterns
];
```

## Troubleshooting

### Tests fail immediately
- Ensure frontend is running on the configured URL
- Check browser console for errors
- Review test-logs/session-*.log for details

### Fixes not working
- Check if fix scripts are being created in public/
- Verify fix logic matches current app structure
- Review auto-fixer.js logs

### Performance issues
- Increase timeouts in configuration
- Run with --headless flag
- Reduce slowMo value

## Contributing

To improve the autonomous test system:

1. Add new test cases in `test-runner.js`
2. Add issue patterns in `issue-analyzer.js`
3. Implement fixes in `auto-fixer.js`
4. Enhance reports in `report-generator.js`

## License

Part of the Coffee Cue system. See main project license.