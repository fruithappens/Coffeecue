# Coffee Cue System - Live Testing Guide

This guide explains how to conduct real-world testing with the Coffee Cue system while monitoring all activity and checking for hardcoded data.

## Testing Environment Setup

We've created a comprehensive live testing environment that monitors:
- Frontend console logs
- API traffic between frontend and backend
- Potential hardcoded data in the codebase
- Database content analysis to detect real vs. demo data

## Starting the Test Environment

Before starting the test environment, make sure the system components are running:

1. The backend server on port 5001 
2. The frontend React app on port 3001

Then run:

```bash
./live-test-environment.sh
```

This script will:
1. Inject monitoring code into the frontend
2. Start several monitoring services
3. Analyze the codebase for hardcoded data
4. Analyze database content for potential real user data
5. Start a background service to periodically test API endpoints

## Conducting Tests

Once the environment is running:

1. Navigate to the frontend at http://localhost:3001
2. Perform normal system operations as if in a real-world scenario:
   - Creating coffee orders
   - Managing stations
   - Tracking order status
   - Using all features of the system

3. The monitoring system will automatically capture:
   - All console logs from the browser
   - All API requests and responses
   - Any errors or warnings that occur

## Reviewing Test Results

After testing, you can find detailed reports in the following locations:

- **Console Logs**: `/Users/stevewf/expresso/logs/live_test/console-*.log`
- **API Traffic**: `/Users/stevewf/expresso/logs/live_test/api-traffic.log`
- **Hardcoded Data Analysis**: `/Users/stevewf/expresso/logs/live_test/hardcoded-data-analysis.md`
- **Database Content Analysis**: `/Users/stevewf/expresso/logs/live_test/database-analysis.md`

## Checking for Hardcoded Data

The data analysis tools specifically look for:

1. **In Code Files**:
   - Hardcoded names (following name patterns)
   - Email addresses
   - Phone numbers
   - Other personal information

2. **In Database**:
   - Tables containing potential real user data
   - Differentiation between demo/test data and real data
   - Indicators of whether data is properly anonymized

## What to Look For

During testing, pay attention to:

1. **User Experience Issues**:
   - Any lags or delays in the interface
   - Error messages or console warnings
   - Features that don't work as expected

2. **Data Source Verification**:
   - Check if displayed names, emails, or other personal data is coming from the database (good) or hardcoded in the frontend (bad)
   - Verify that any "demo" or "sample" data is clearly labeled as such

3. **System Performance**:
   - How the system handles multiple concurrent operations
   - Response times for API calls
   - Any memory issues or browser warnings

## Real-world Readiness Checklist

After testing, review these key points to determine if the system is ready for real-world use:

- [ ] All personal data is loaded from the database, not hardcoded
- [ ] The system clearly distinguishes between demo mode and production mode
- [ ] Error handling is robust and user-friendly
- [ ] The system performs well under typical usage patterns
- [ ] All API endpoints respond correctly and with appropriate data
- [ ] Authentication and authorization work correctly
- [ ] User actions are properly logged for audit purposes

## Stopping the Test Environment

To stop the testing environment, press `Ctrl+C` in the terminal window where you started the script.