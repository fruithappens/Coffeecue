# Coffee Cue Comprehensive Test Framework

This automated testing framework provides complete coverage of the Coffee Cue system by clicking every button, testing every form field, and monitoring all system activity.

## Features

- 🖱️ **Automated UI Testing**: Clicks every button and tests every form field
- 📊 **Real-time Monitoring**: Live dashboard showing test progress
- 🔍 **Comprehensive Logging**: Captures console logs, network requests, and database queries
- 📸 **Visual Documentation**: Takes screenshots of every interaction
- 📝 **Detailed Reports**: Generates HTML, JSON, and Markdown reports
- 🤖 **AI-Friendly Summaries**: Creates Claude-optimized summaries

## Installation

```bash
cd test-framework
npm install
```

## Usage

### Run All Tests
```bash
npm start
```

### Run Specific Test Suite
```bash
node src/testOrchestrator.js auth      # Authentication tests only
node src/testOrchestrator.js barista   # Barista interface tests
node src/testOrchestrator.js orders    # Order management tests
node src/testOrchestrator.js inventory # Inventory tests
node src/testOrchestrator.js settings  # Settings tests
node src/testOrchestrator.js display   # Display screen tests
node src/testOrchestrator.js ui        # Comprehensive UI tests
node src/testOrchestrator.js api       # API endpoint tests
```

### View Real-time Monitoring
Open http://localhost:8080 in your browser while tests are running

## What It Tests

### Authentication
- Login with valid/invalid credentials
- Role-based access (Admin, Barista, Organizer)
- Session persistence
- JWT token handling
- Logout functionality

### Barista Interface
- Order claiming and completion
- Walk-in order creation
- Milk option selection
- Order filtering and search
- Batch order handling

### Order Management
- Order status updates
- Order history
- Customer notifications
- Order timing tracking

### Inventory Management
- Stock level updates
- Low stock alerts
- Inventory history
- Milk availability

### Settings
- SMS configuration
- Station management
- System settings
- User preferences

### UI Interactions
- Every button click
- Form field validation
- Error handling
- Loading states
- Navigation flows

### API & Database
- All API endpoints
- Response times
- Database query performance
- Data persistence verification

## Reports

After testing completes, find reports in the `reports/` directory:

### report.html
Full interactive HTML report with:
- Test summary and metrics
- Detailed test results by suite
- Screenshots of interactions
- Console logs and errors
- Network activity
- Database queries

### report.json
Raw test data in JSON format for further analysis

### report.md
Markdown summary suitable for documentation

### claude-summary.md
AI-optimized summary highlighting:
- What works ✅
- What doesn't work ❌
- Critical issues 🚨
- Performance insights 📊
- Recommendations 💡

## Configuration

Edit `config/testConfig.js` to customize:
- Test credentials
- Database connection
- Browser settings (headless mode, viewport size)
- Report options

## Architecture

```
test-framework/
├── src/
│   ├── browserAutomation.js    # Puppeteer browser control
│   ├── databaseMonitor.js      # PostgreSQL monitoring
│   ├── monitoringDashboard.js  # Real-time web dashboard
│   ├── testOrchestrator.js     # Test coordination
│   ├── testSuites.js           # Test implementations
│   └── reportGenerator.js      # Report generation
├── config/
│   └── testConfig.js           # Configuration
├── reports/                    # Generated reports
└── package.json
```

## Troubleshooting

### Tests fail to start
- Ensure Coffee Cue backend is running on port 5001
- Ensure Coffee Cue frontend is running on port 3000
- Check PostgreSQL is running and accessible

### Browser doesn't launch
- Install Chrome/Chromium if using headless mode
- Check Puppeteer installation: `npm install puppeteer`

### Database monitoring fails
- Verify PostgreSQL credentials in config
- Ensure database user has query permissions

### Dashboard not accessible
- Check port 8080 is not in use
- Try a different port in config