# Coffee Cue Comprehensive Testing Framework

This testing framework provides automated UI testing, API monitoring, and real-time debugging for the Coffee Cue system.

## Features

- 🖱️ **Automated UI Testing**: Clicks every button and tests every form field
- 📊 **Real-time Monitoring**: Live dashboard showing console logs, API calls, and database queries
- 🔍 **Database Verification**: Confirms that form fields actually save to the database
- 📈 **Performance Testing**: Measures load times and memory usage
- 📝 **Detailed Reports**: HTML and JSON reports with screenshots
- 🤖 **Claude-friendly Summaries**: Quick summaries for AI understanding

## Quick Start

### 1. Simple API Test (No Dependencies)
```bash
node test-framework/simple-test.js
```

### 2. Full Automated Testing (Requires Puppeteer)
```bash
cd test-framework
npm install
./run-tests.sh
```

### 3. Manual Testing with Monitoring
```bash
# Start monitoring dashboard
node test-framework/orchestrator.js

# Open dashboard in browser
open http://localhost:8082/monitor-dashboard.html
```

## Test Components

### 1. Browser Automation (`browser-automation.js`)
- Launches Chrome with DevTools
- Monitors all console output
- Tracks network requests
- Takes screenshots
- Tests form validation
- Verifies database connections

### 2. Backend Monitor (`backend-monitor.py`)
- Injects into Flask app
- Tracks all database queries
- Monitors API response times
- Sends data to monitoring dashboard

### 3. Real-time Dashboard (`monitor-dashboard.html`)
- Live view of all system activity
- Console errors and warnings
- API calls and responses
- Database queries
- Test progress

### 4. Test Orchestrator (`orchestrator.js`)
- Manages test execution
- Runs test sequences
- Generates reports
- Controls browser automation

## Test Sequences

1. **Login Test**: Tests authentication with valid/invalid credentials
2. **Navigation Test**: Clicks through all tabs and takes screenshots
3. **Button Test**: Clicks every button and records what happens
4. **Form Test**: Tests all form fields with various inputs
5. **Order Flow**: Complete order creation to completion
6. **Stock Management**: Tests inventory adjustments
7. **Settings**: Verifies settings persistence
8. **Error Handling**: Tests offline mode and error states
9. **Performance**: Measures load times and memory usage

## Understanding Results

### Console Errors
- Check `test-results/realtime-console.log`
- Look for JavaScript errors
- Note any 404s or missing resources

### Non-functional Buttons
- Review `test-results/ui-test-report.html`
- Look for buttons with 0 network calls
- These likely need backend connections

### Database Issues
- Check fields marked "No database activity"
- These fields aren't saving data
- Need backend endpoint implementation

### Performance Problems
- Page load > 3 seconds needs optimization
- Memory increase > 50MB indicates leaks
- Check for infinite loops or re-renders

## Fixing Common Issues

### Button Does Nothing
1. Check if button has click handler
2. Verify API endpoint exists
3. Check for JavaScript errors
4. Add proper error handling

### Form Field Not Saving
1. Verify form submission handler
2. Check API endpoint accepts field
3. Ensure proper validation
4. Add success/error feedback

### Console Errors
1. Fix missing dependencies
2. Handle undefined values
3. Add try-catch blocks
4. Check API responses

## Example Usage

```javascript
// Run specific test
const tester = new CoffeeCueUITester();
await tester.initialize();
await tester.clickEveryButton();
await tester.generateReport();

// Check results
const report = require('./test-results/ui-test-report.json');
console.log(`Errors found: ${report.summary.consoleErrors}`);
console.log(`Buttons tested: ${report.summary.totalButtonsClicked}`);
```

## Output Files

- `test-results/ui-test-report.html` - Main HTML report
- `test-results/ui-test-report.json` - Detailed JSON data
- `test-results/claude-summary.md` - AI-friendly summary
- `test-results/screenshots/` - Screenshots of each test
- `test-results/realtime-*.log` - Real-time log files

## Troubleshooting

### "Backend not running"
Start the backend: `cd /Users/stevewf/expresso && python run_server.py`

### "Frontend not running"  
Start the frontend: `cd "/Users/stevewf/expresso/Barista Front End" && npm start`

### "Cannot find module 'puppeteer'"
Install dependencies: `cd test-framework && npm install`

### Tests hang or timeout
- Check if modals are blocking UI
- Increase timeout values
- Check for infinite loops

## Next Steps

1. Run `./run-tests.sh` to find all issues
2. Fix errors in order of severity
3. Connect non-functional UI elements
4. Add proper error handling
5. Implement missing API endpoints
6. Re-run tests to verify fixes