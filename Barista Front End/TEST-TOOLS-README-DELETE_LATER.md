# Expresso Frontend Testing Tools

**WARNING: THESE TOOLS ARE FOR TESTING ONLY AND SHOULD BE DELETED BEFORE DEPLOYMENT**

This directory contains automated testing tools for the Expresso frontend application.
They are designed to help identify and fix issues with the barista interface, authentication,
and other components.

## Testing Tools

### 1. Test Utility Web Interface
- **URL**: `/test-utility-DELETE_LATER.html`
- **Purpose**: Manual testing of login, orders, and UI components
- **Features**:
  - Login testing with error handling
  - Token management and validation
  - Order creation and flow testing
  - Component and UI testing

### 2. Auto Tester Script
- **URL**: `/auto-tester-DELETE_LATER.js`
- **Purpose**: Automated testing of the frontend application
- **Features**:
  - Automated login testing
  - Navigation testing
  - Order flow testing
  - Component testing
  - Error handling testing
  - Automatic fallback mode enablement when failures occur

### 3. Test Runner
- **URL**: `/run-tests-DELETE_LATER.html`
- **Purpose**: User-friendly interface for running automated tests
- **Features**:
  - Configure which tests to run
  - View test results and logs
  - Enable/disable automatic fixes
  - Clear local storage

### 4. Test Injector
- **URL**: `/test-injector-DELETE_LATER.js`
- **Purpose**: Inject tester into any page within the application
- **Features**:
  - Can be run from browser console or as a bookmarklet
  - Automatically loads and initializes the auto tester
  - Creates a floating UI for test management

## How to Use

### Basic Usage

1. Visit `/run-tests-DELETE_LATER.html` in your browser
2. Select which tests you want to run
3. Click "Run Tests" and view the results

### Testing on Specific Pages

1. Navigate to the page you want to test (e.g., `/barista`)
2. Open browser console and run:
   ```javascript
   const script = document.createElement('script');
   script.src = '/test-injector-DELETE_LATER.js';
   document.head.appendChild(script);
   ```
3. The test UI will appear in the corner of the page
4. Run tests directly from this interface

### URL Parameters

You can add `?auto_test=true` or `#auto_test` to any page URL to automatically 
inject and run the tester when the page loads.

Example:
```
http://localhost:3000/barista?auto_test=true
```

### Bookmarklet

Create a bookmark with the following URL:
```
javascript:(function(){const s=document.createElement('script');s.src='/test-injector-DELETE_LATER.js';document.head.appendChild(s);})();
```

Click this bookmark while on any page in the application to inject the tester.

## Testing Capabilities

### Authentication Testing
- Login with valid credentials
- Handling of invalid credentials
- Token refresh
- Token validation
- Fallback mode activation

### Navigation Testing
- Tab navigation
- Content loading
- Route changes

### Order Testing
- Walk-in order creation
- Order processing flow
- Order actions (start, complete, cancel)

### Component Testing
- Notification system
- Order sorting and filtering
- Search functionality
- Form validation

### Error Handling Testing
- JWT token errors
- API endpoint errors
- Network errors
- Fallback mode activation

## Auto-Fix Capabilities

The tester can automatically fix issues when they occur:

1. **Login Issues**: Creates a dummy token when login fails
2. **JWT Errors**: Refreshes token or creates a new dummy token
3. **API Errors**: Enables fallback mode for data retrieval
4. **Navigation Issues**: Reloads page or redirects as needed

## Important Notes

1. These tools are only for testing and debugging
2. They contain hardcoded test credentials
3. They should never be deployed to production
4. All files with "DELETE_LATER" in the filename should be removed before deployment

## Removal Instructions

Before deploying to production, run the following command to remove all test tools:

```bash
# From the project root
find . -name "*DELETE_LATER*" -type f -delete
```

## Feedback and Issues

When you encounter issues during testing, note them in this README or create
separate documentation for tracking purposes.