# Expresso/Coffee Cue Testing Guide

This document outlines the testing strategy and provides instructions for running tests for the Expresso/Coffee Cue system.

## Testing Architecture

The Expresso/Coffee Cue system is tested at multiple levels:

1. **API Tests** - Python scripts that test backend API endpoints
2. **Frontend Tests** - Jest tests for React components
3. **Integration Tests** - Tests covering frontend-backend interaction
4. **End-to-End Tests** - Cypress tests that simulate user workflows
5. **Authentication Tests** - Tests for JWT authentication system

## Test Files

### Backend API Tests
- `test_api.py` - Tests for core API endpoints
- `test_frontend_backend_integration.py` - Tests for frontend-backend API integration
- `test_auth_flow.py` - Tests for authentication flow
- `test_jwt_config.py` - Tests for JWT configuration
- `test_cors.py` - Tests for CORS configuration
- `test_inventory_endpoints.py` - Tests for inventory-specific endpoints
- `test_inventory_endpoints_auth.py` - Tests for inventory endpoints with authentication

### Frontend Tests
- `Barista Front End/src/components/InProgressOrder.test.js` - Tests for the InProgressOrder component
- `Barista Front End/src/services/OrderDataService.test.js` - Tests for the OrderDataService
- `Barista Front End/cypress/e2e/barista_workflow.cy.js` - End-to-end tests for barista workflow

### Test Runner
- `run_all_tests.sh` - Master script that runs all tests and consolidates results

## Running Tests

### Prerequisites
Before running tests, ensure:
1. The backend server is running at http://localhost:5001
2. The database is initialized with test data
3. Frontend dependencies are installed (`npm install` in the Barista Front End directory)

### Running All Tests
```bash
./run_all_tests.sh
```

### Running Specific Test Groups
```bash
# Run only API tests
./run_all_tests.sh --api-only

# Run only frontend tests
./run_all_tests.sh --frontend-only

# Run only database tests
./run_all_tests.sh --db-only
```

### Running Individual Tests
```bash
# Backend API tests
python test_api.py --all
python test_frontend_backend_integration.py
python test_auth_flow.py

# Frontend component tests
cd "Barista Front End"
npm test

# End-to-end tests
cd "Barista Front End"
npx cypress open   # Interactive UI
npx cypress run    # Headless mode
```

## Test Data

The API tests use test endpoints to create temporary data. The `/api/debug/create-test-order` endpoint is used to create test orders for API testing.

For frontend testing, mocked data is used where appropriate, and backend API calls are intercepted in Cypress tests.

## Test Coverage

The test suite covers:

1. **Order Lifecycle**
   - Order creation
   - Order progression (pending → in progress → completed → picked up)
   - Batch order processing
   - Order notification system

2. **Authentication**
   - Login and token generation
   - Token validation and refresh
   - Role-based access control
   - Logout flow

3. **Barista Interface**
   - Component rendering
   - User interactions
   - Offline capabilities
   - Data persistence

4. **Inventory Management**
   - Stock level updates
   - Low stock reporting
   - Usage tracking

5. **Settings Management**
   - Setting retrieval
   - Setting updates

## Writing New Tests

### API Tests
Follow the pattern in `test_api.py`:
1. Create test functions for specific features
2. Use `requests` to call API endpoints
3. Verify responses with assertions
4. Use the `print_response` helper function to display results

### Frontend Tests
Follow React Testing Library practices:
1. Render components with necessary providers and mocks
2. Use `screen` queries to find elements
3. Interact with elements using `fireEvent`
4. Verify results with `expect` assertions

### End-to-End Tests
Follow Cypress patterns:
1. Use `cy.visit()` to navigate to pages
2. Use `cy.get()` to find elements
3. Use `cy.intercept()` to mock API responses if needed
4. Chain commands to interact with the application
5. Use assertions to verify expected outcomes

## CI/CD Integration

The test suite is designed to be integrated with CI/CD pipelines. The `run_all_tests.sh` script returns non-zero exit codes on test failure, making it suitable for automated builds.

Example GitHub Actions workflow:
```yaml
name: Test Suite

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Set up Python
        uses: actions/setup-python@v2
        with:
          python-version: '3.9'
      - name: Install Python dependencies
        run: pip install -r requirements.txt
      - name: Set up Node.js
        uses: actions/setup-node@v2
        with:
          node-version: '14'
      - name: Install Node.js dependencies
        run: cd "Barista Front End" && npm install
      - name: Start backend server
        run: python run_server.py &
      - name: Wait for server
        run: sleep 5
      - name: Run tests
        run: ./run_all_tests.sh
```

## Troubleshooting

### Common Issues

1. **API tests fail with connection errors**
   - Ensure the backend server is running at http://localhost:5001
   - Check for any CORS issues
   - Verify that the database is properly initialized

2. **Authentication tests fail**
   - Ensure test user accounts exist in the database
   - Verify JWT secret key configuration
   - Check token validation logic

3. **Frontend tests fail**
   - Ensure all dependencies are installed
   - Update test mocks if API contracts have changed
   - Fix test selectors if component structure has changed

4. **Cypress tests fail**
   - Ensure the frontend development server is running
   - Check if selectors have changed
   - Update expected API responses if backend has changed

### Getting Help

If you encounter issues running tests, please:
1. Check the error messages and logs
2. Verify all prerequisites are met
3. Review relevant test files for specific requirements
4. Contact the development team for assistance