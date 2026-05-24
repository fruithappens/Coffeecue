# Coffee Cue System - Test Scripts

This document provides a set of executable test scripts for verifying the functionality of the Coffee Cue system across all interfaces. These scripts can be used for manual testing or as a basis for automated test implementation.

## 1. Authentication Tests

### 1.1 Login Test Script

**Purpose**: Verify user authentication across different roles

**Steps**:
1. Navigate to login page at `/login`
2. Test login with admin credentials:
   ```
   Username: coffeecue
   Password: adminpassword
   ```
3. Verify successful login and redirection to landing page
4. Verify admin role provides access to all interfaces
5. Logout and verify redirection to login page
6. Repeat login test with Barista role
7. Verify Barista can access only permitted interfaces
8. Verify unauthorized access attempts are blocked

**Expected Results**:
- Admin can access all interfaces
- Barista can access only Barista and Display interfaces
- Unauthorized access attempts are redirected to login page
- JWT token is properly stored
- Token expiration is handled correctly

### 1.2 Authentication API Test

**Purpose**: Verify backend authentication endpoints

**Test Script**:
```bash
#!/bin/bash
# Authentication API test script

# Login test
echo "Testing login API..."
LOGIN_RESPONSE=$(curl -s -X POST http://localhost:5001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"coffeecue","password":"adminpassword"}')

# Extract token from response
ACCESS_TOKEN=$(echo $LOGIN_RESPONSE | grep -o '"access_token":"[^"]*' | sed 's/"access_token":"//')
REFRESH_TOKEN=$(echo $LOGIN_RESPONSE | grep -o '"refresh_token":"[^"]*' | sed 's/"refresh_token":"//')

echo "Access token: ${ACCESS_TOKEN:0:20}..."
echo "Refresh token: ${REFRESH_TOKEN:0:20}..."

# Verify token
echo "Testing token verification..."
VERIFY_RESPONSE=$(curl -s -X GET http://localhost:5001/api/auth/verify \
  -H "Authorization: Bearer $ACCESS_TOKEN")
echo "Verify response: $VERIFY_RESPONSE"

# Test refresh token
echo "Testing token refresh..."
REFRESH_RESPONSE=$(curl -s -X POST http://localhost:5001/api/auth/refresh \
  -H "Content-Type: application/json" \
  -d "{\"refresh_token\":\"$REFRESH_TOKEN\"}")
echo "Refresh response: $REFRESH_RESPONSE"

# Test invalid token
echo "Testing invalid token..."
INVALID_RESPONSE=$(curl -s -X GET http://localhost:5001/api/auth/verify \
  -H "Authorization: Bearer invalid_token")
echo "Invalid token response: $INVALID_RESPONSE"
```

## 2. Barista Interface Tests

### 2.1 Order Processing Workflow Test

**Purpose**: Verify the complete order processing workflow in the Barista Interface

**Steps**:
1. Login as a Barista
2. Navigate to the Barista Interface
3. Create a test order using the API:

```javascript
// Create test order via API
async function createTestOrder() {
  const response = await fetch('http://localhost:5001/api/debug/create-test-order', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${localStorage.getItem('access_token')}`
    },
    body: JSON.stringify({
      name: 'Test Customer',
      type: 'Cappuccino',
      milk: 'Oat milk',
      size: 'Regular',
      sugar: '1 sugar',
      phone: '+61400123456',
      notes: 'Test order created via API'
    })
  });
  
  const data = await response.json();
  console.log('Created test order:', data);
  return data.order_number;
}
```

4. Verify the order appears in the Pending Orders section
5. Click "Start" on the test order
6. Verify the order moves to the In Progress section
7. Click "Complete" on the test order
8. Verify the order disappears from the In Progress section
9. Navigate to Display Interface
10. Verify the completed order appears in the Ready for Pickup section

**Expected Results**:
- Test order appears in all expected sections during its lifecycle
- Order status updates are reflected in real-time
- Order details are consistent across all views
- The workflow completes without errors

### 2.2 Batch Processing Test

**Purpose**: Verify batch processing of multiple orders

**Steps**:
1. Login as a Barista
2. Navigate to the Barista Interface
3. Create multiple test orders using the API (at least 3)
4. Verify all orders appear in the Pending Orders section
5. Test batch grouping functionality:
   - Verify orders with the same coffee and milk type are grouped together
   - Select multiple orders from the same group
   - Click "Start Batch"
6. Verify all selected orders move to the In Progress section
7. Select multiple orders in the In Progress section
8. Click "Complete Batch"
9. Verify all selected orders disappear from the In Progress section
10. Navigate to Display Interface
11. Verify all completed orders appear in the Ready for Pickup section

**Expected Results**:
- Orders are correctly grouped by coffee and milk type
- Batch operations correctly update all selected orders
- All status changes are reflected across interfaces
- Batch operations complete without errors

## 3. Organizer Interface Tests

### 3.1 Station Management Test

**Purpose**: Verify station management functionality in the Organizer Interface

**Steps**:
1. Login as an Admin or Staff member
2. Navigate to the Organizer Interface
3. Go to the Stations tab
4. Test creating a new station:
   - Click "Add Station"
   - Fill in station details:
     ```
     Name: Test Station
     Location: Testing Area
     Capacity: 5
     ```
   - Submit the form
5. Verify the new station appears in the stations list
6. Test editing the station:
   - Click "Edit" on the test station
   - Change the name to "Updated Test Station"
   - Submit the form
7. Verify the changes are reflected in the stations list
8. Test changing station status:
   - Click "Deactivate" on the test station
   - Verify status changes to "inactive"
   - Click "Activate" on the test station
   - Verify status changes to "active"
9. Test assigning a barista to the station:
   - Click "Assign Barista" on the test station
   - Select a barista from the dropdown
   - Submit the form
10. Verify the barista assignment is reflected in the stations list

**Expected Results**:
- Station CRUD operations work correctly
- Status changes are applied immediately
- Barista assignments are saved correctly
- All changes persist after page refresh

### 3.2 Dashboard Analytics Test

**Purpose**: Verify dashboard analytics functionality in the Organizer Interface

**Steps**:
1. Login as an Admin or Staff member
2. Navigate to the Organizer Interface
3. Go to the Dashboard tab
4. Verify the following metrics are displayed:
   - Daily Orders count
   - Active Stations count
   - Average Wait Time
5. Process several test orders to generate data
6. Refresh the dashboard
7. Verify the metrics update to reflect the new orders
8. Test different time period filters if available
9. Verify charts and visualizations update correctly

**Expected Results**:
- Dashboard displays relevant metrics
- Data updates after new orders are processed
- Charts and visualizations render correctly
- Performance statistics are accurate

## 4. Display Interface Tests

### 4.1 Order Display Test

**Purpose**: Verify the Display Interface shows orders correctly

**Steps**:
1. Login with Display or Admin credentials
2. Navigate to the Display Interface
3. Process several test orders through the workflow:
   - Create pending orders
   - Start some orders
   - Complete some orders
4. Verify In Progress orders appear in the left panel
5. Verify Completed orders appear in the right panel
6. Test the auto-refresh functionality:
   - Process a new order in another tab
   - Verify it appears in the Display Interface within the refresh interval
7. Test manual refresh by clicking the refresh button
8. Test multiple station views:
   - Select "All Stations" from the dropdown
   - Verify orders from all stations are displayed
   - Select a specific station
   - Verify only orders for that station are displayed

**Expected Results**:
- In Progress and Completed orders are displayed correctly
- Orders update automatically within the refresh interval
- Manual refresh immediately updates the display
- Station filtering works correctly
- Order details are complete and accurate

### 4.2 Display Settings Test

**Purpose**: Verify display customization settings

**Steps**:
1. Login as an Admin
2. Navigate to the Organizer Interface
3. Go to the Settings tab
4. Update Display Settings:
   ```
   Event Name: Test Event
   Organization Name: Test Organization
   Header Color: #FF5500
   Custom Message: Test message for customers
   Show Sponsor: true
   Sponsor Name: Test Sponsor
   Sponsor Message: Sponsored by Test Sponsor
   ```
5. Save the settings
6. Navigate to the Display Interface
7. Verify all customized settings are applied:
   - Event name is updated
   - Header color is changed
   - Custom message is displayed
   - Sponsor information is shown

**Expected Results**:
- All display settings are saved correctly
- Settings are immediately applied to the Display Interface
- Layout adapts correctly to different content lengths
- Colors and styling are applied properly

## 5. API Tests

### 5.1 Order API Test Script

**Purpose**: Verify order management API endpoints

**Test Script**:
```bash
#!/bin/bash
# Order API test script

# Login to get token
echo "Logging in..."
LOGIN_RESPONSE=$(curl -s -X POST http://localhost:5001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"coffeecue","password":"adminpassword"}')

ACCESS_TOKEN=$(echo $LOGIN_RESPONSE | grep -o '"access_token":"[^"]*' | sed 's/"access_token":"//')
echo "Access token obtained: ${ACCESS_TOKEN:0:20}..."

# Create test order
echo "Creating test order..."
CREATE_RESPONSE=$(curl -s -X POST http://localhost:5001/api/debug/create-test-order \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d '{
    "name": "API Test Customer",
    "type": "Latte",
    "milk": "Almond milk",
    "size": "Large",
    "sugar": "2 sugar",
    "phone": "+61400123456",
    "notes": "Created via API test script"
  }')

echo "Create response: $CREATE_RESPONSE"
ORDER_NUMBER=$(echo $CREATE_RESPONSE | grep -o '"order_number":"[^"]*' | sed 's/"order_number":"//')
echo "Order number: $ORDER_NUMBER"

# Get pending orders
echo "Getting pending orders..."
PENDING_RESPONSE=$(curl -s -X GET http://localhost:5001/api/orders/pending \
  -H "Authorization: Bearer $ACCESS_TOKEN")
echo "Pending orders count: $(echo $PENDING_RESPONSE | grep -o '\[.*\]' | tr -d '[]' | tr ',' '\n' | wc -l)"

# Start order
echo "Starting order $ORDER_NUMBER..."
START_RESPONSE=$(curl -s -X POST http://localhost:5001/api/orders/$ORDER_NUMBER/start \
  -H "Authorization: Bearer $ACCESS_TOKEN")
echo "Start response: $START_RESPONSE"

# Get in-progress orders
echo "Getting in-progress orders..."
INPROGRESS_RESPONSE=$(curl -s -X GET http://localhost:5001/api/orders/in-progress \
  -H "Authorization: Bearer $ACCESS_TOKEN")
echo "In-progress orders count: $(echo $INPROGRESS_RESPONSE | grep -o '\[.*\]' | tr -d '[]' | tr ',' '\n' | wc -l)"

# Complete order
echo "Completing order $ORDER_NUMBER..."
COMPLETE_RESPONSE=$(curl -s -X POST http://localhost:5001/api/orders/$ORDER_NUMBER/complete \
  -H "Authorization: Bearer $ACCESS_TOKEN")
echo "Complete response: $COMPLETE_RESPONSE"

# Get completed orders
echo "Getting completed orders..."
COMPLETED_RESPONSE=$(curl -s -X GET http://localhost:5001/api/orders/completed \
  -H "Authorization: Bearer $ACCESS_TOKEN")
echo "Completed orders count: $(echo $COMPLETED_RESPONSE | grep -o '\[.*\]' | tr -d '[]' | tr ',' '\n' | wc -l)"

# Look up order
echo "Looking up order $ORDER_NUMBER..."
LOOKUP_RESPONSE=$(curl -s -X GET http://localhost:5001/api/orders/lookup/$ORDER_NUMBER \
  -H "Authorization: Bearer $ACCESS_TOKEN")
echo "Order status: $(echo $LOOKUP_RESPONSE | grep -o '"status":"[^"]*' | sed 's/"status":"//')"
```

### 5.2 Station API Test Script

**Purpose**: Verify station management API endpoints

**Test Script**:
```bash
#!/bin/bash
# Station API test script

# Login to get token
echo "Logging in..."
LOGIN_RESPONSE=$(curl -s -X POST http://localhost:5001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"coffeecue","password":"adminpassword"}')

ACCESS_TOKEN=$(echo $LOGIN_RESPONSE | grep -o '"access_token":"[^"]*' | sed 's/"access_token":"//')
echo "Access token obtained: ${ACCESS_TOKEN:0:20}..."

# Get all stations
echo "Getting all stations..."
STATIONS_RESPONSE=$(curl -s -X GET http://localhost:5001/api/stations \
  -H "Authorization: Bearer $ACCESS_TOKEN")
echo "Stations count: $(echo $STATIONS_RESPONSE | grep -o '\[.*\]' | tr -d '[]' | tr ',' '\n' | wc -l)"

# Create test station
echo "Creating test station..."
CREATE_RESPONSE=$(curl -s -X POST http://localhost:5001/api/stations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d '{
    "name": "API Test Station",
    "location": "Test Area",
    "capacity": 5,
    "status": "inactive"
  }')

echo "Create response: $CREATE_RESPONSE"
STATION_ID=$(echo $CREATE_RESPONSE | grep -o '"id":[0-9]*' | sed 's/"id"://')
echo "Station ID: $STATION_ID"

# Get station details
echo "Getting station details..."
STATION_RESPONSE=$(curl -s -X GET http://localhost:5001/api/stations/$STATION_ID \
  -H "Authorization: Bearer $ACCESS_TOKEN")
echo "Station details: $STATION_RESPONSE"

# Update station status
echo "Updating station status to active..."
STATUS_RESPONSE=$(curl -s -X PATCH http://localhost:5001/api/stations/$STATION_ID/status \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d '{"status": "active"}')
echo "Status update response: $STATUS_RESPONSE"

# Assign barista to station
echo "Assigning barista to station..."
ASSIGN_RESPONSE=$(curl -s -X PATCH http://localhost:5001/api/stations/$STATION_ID/barista \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d '{"barista_id": 1}')
echo "Barista assignment response: $ASSIGN_RESPONSE"

# Get station statistics
echo "Getting station statistics..."
STATS_RESPONSE=$(curl -s -X GET http://localhost:5001/api/stations/$STATION_ID/stats \
  -H "Authorization: Bearer $ACCESS_TOKEN")
echo "Station statistics: $STATS_RESPONSE"
```

## 6. Cross-Interface Tests

### 6.1 End-to-End Order Workflow Test

**Purpose**: Verify order workflow across all interfaces

**Steps**:
1. Open three browser tabs for different interfaces:
   - Tab 1: Barista Interface
   - Tab 2: Organizer Interface
   - Tab 3: Display Interface
2. Login to each interface with appropriate credentials
3. Create a test order via API
4. In the Barista Interface:
   - Verify the order appears in the Pending Orders section
   - Start the order
   - After a delay, complete the order
5. In the Organizer Interface:
   - Monitor the Dashboard to verify order count increases
   - Check the Order History tab to see the completed order
6. In the Display Interface:
   - Verify the order appears in the In Progress section when started
   - Verify the order moves to the Ready for Pickup section when completed
7. Back in the Barista Interface:
   - Send an SMS notification for the order
8. Verify SMS is sent (check logs or actual receipt if testing environment supports it)

**Expected Results**:
- Order status changes are reflected in real-time across all interfaces
- Order counts and statistics update correctly
- SMS notification is sent successfully
- The entire workflow completes without errors

### 6.2 Settings Propagation Test

**Purpose**: Verify settings changes propagate across interfaces

**Steps**:
1. Open two browser tabs:
   - Tab 1: Organizer Interface (Settings section)
   - Tab 2: Display Interface
2. In the Organizer Interface:
   - Update display settings with new values
   - Change wait time estimation
   - Toggle features on/off
   - Save changes
3. In the Display Interface:
   - Refresh the page if needed
   - Verify all settings changes are reflected

**Expected Results**:
- All settings changes are applied correctly
- Display Interface updates to reflect new settings
- Configuration persists across page refreshes

## 7. Stress and Performance Tests

### 7.1 High-Volume Order Test

**Purpose**: Verify system performance under high order volume

**Test Script**:
```javascript
// High-volume order test
async function createBulkOrders(count) {
  console.log(`Creating ${count} test orders...`);
  const startTime = Date.now();
  
  const coffeeTypes = ['Latte', 'Cappuccino', 'Flat White', 'Long Black', 'Espresso'];
  const milkTypes = ['Full Cream', 'Skim', 'Almond', 'Oat', 'Soy'];
  const sizes = ['Regular', 'Large'];
  
  const promises = [];
  
  for (let i = 0; i < count; i++) {
    const order = {
      name: `Bulk Test ${i+1}`,
      type: coffeeTypes[i % coffeeTypes.length],
      milk: milkTypes[i % milkTypes.length],
      size: sizes[i % sizes.length],
      sugar: `${i % 3} sugar`,
      phone: '+61400123456',
      notes: `Bulk test order ${i+1} of ${count}`
    };
    
    const promise = fetch('http://localhost:5001/api/debug/create-test-order', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('access_token')}`
      },
      body: JSON.stringify(order)
    });
    
    promises.push(promise);
  }
  
  await Promise.all(promises);
  const endTime = Date.now();
  console.log(`Created ${count} orders in ${(endTime - startTime)/1000} seconds`);
  
  // Test retrieving all orders
  console.log('Fetching pending orders...');
  const fetchStart = Date.now();
  const response = await fetch('http://localhost:5001/api/orders/pending', {
    headers: {
      'Authorization': `Bearer ${localStorage.getItem('access_token')}`
    }
  });
  
  const orders = await response.json();
  const fetchEnd = Date.now();
  console.log(`Fetched ${orders.length} orders in ${(fetchEnd - fetchStart)/1000} seconds`);
  
  return {
    createTime: (endTime - startTime)/1000,
    fetchTime: (fetchEnd - fetchStart)/1000,
    orderCount: orders.length
  };
}

// Execute test with 50 orders
createBulkOrders(50).then(result => {
  console.log('Test results:', result);
});
```

**Expected Results**:
- System handles high volume of orders without errors
- Response times remain within acceptable limits
- UI remains responsive
- All orders are correctly processed and displayed

### 7.2 Concurrent User Test

**Purpose**: Verify system performance with multiple concurrent users

**Test Approach**:
1. Prepare multiple test accounts with different roles
2. Use browser automation or multiple testers to simulate concurrent users
3. Each user performs typical workflows for their role:
   - Baristas process orders
   - Organizers view dashboards and manage stations
   - Displays show order status
4. Monitor system performance, response times, and error rates
5. Gradually increase the number of concurrent users

**Expected Results**:
- System handles multiple concurrent users without errors
- Response times remain within acceptable limits
- No race conditions or data inconsistencies occur
- All users can complete their workflows successfully

## 8. Integration Tests

### 8.1 SMS Notification Test

**Purpose**: Verify SMS notification functionality

**Steps**:
1. Login as a Barista
2. Create a test order with a valid phone number
3. Process the order to completion
4. Click "Send Message" on the completed order
5. Enter a custom message and submit
6. Verify the message is sent successfully (check logs or actual receipt)
7. Test automated notifications if enabled

**Expected Results**:
- Message is sent successfully
- Notification history is updated
- Error handling works for invalid numbers
- Rate limiting is enforced if configured

### 8.2 Database Integrity Test

**Purpose**: Verify database integrity during operations

**Test Script**:
```bash
#!/bin/bash
# Database integrity test

# Login to get token
echo "Logging in..."
LOGIN_RESPONSE=$(curl -s -X POST http://localhost:5001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"coffeecue","password":"adminpassword"}')

ACCESS_TOKEN=$(echo $LOGIN_RESPONSE | grep -o '"access_token":"[^"]*' | sed 's/"access_token":"//')
echo "Access token obtained"

# Get database stats before test
echo "Getting initial database stats..."
DB_BEFORE=$(curl -s -X GET http://localhost:5001/api/debug/database-info \
  -H "Authorization: Bearer $ACCESS_TOKEN")

# Create and process 10 test orders
echo "Creating and processing test orders..."
for i in {1..10}; do
  # Create order
  CREATE_RESPONSE=$(curl -s -X POST http://localhost:5001/api/debug/create-test-order \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -d "{\"name\":\"DB Test ${i}\",\"type\":\"Latte\"}")
  
  ORDER_NUMBER=$(echo $CREATE_RESPONSE | grep -o '"order_number":"[^"]*' | sed 's/"order_number":"//')
  echo "Created order: $ORDER_NUMBER"
  
  # Start order
  curl -s -X POST http://localhost:5001/api/orders/$ORDER_NUMBER/start \
    -H "Authorization: Bearer $ACCESS_TOKEN" > /dev/null
  
  # Complete order
  curl -s -X POST http://localhost:5001/api/orders/$ORDER_NUMBER/complete \
    -H "Authorization: Bearer $ACCESS_TOKEN" > /dev/null
  
  echo "Processed order: $ORDER_NUMBER"
done

# Get database stats after test
echo "Getting final database stats..."
DB_AFTER=$(curl -s -X GET http://localhost:5001/api/debug/database-info \
  -H "Authorization: Bearer $ACCESS_TOKEN")

# Compare row counts
ORDERS_BEFORE=$(echo $DB_BEFORE | grep -o '"orders":[0-9]*' | sed 's/"orders"://')
ORDERS_AFTER=$(echo $DB_AFTER | grep -o '"orders":[0-9]*' | sed 's/"orders"://')

echo "Orders before: $ORDERS_BEFORE"
echo "Orders after: $ORDERS_AFTER"
echo "Difference: $((ORDERS_AFTER - ORDERS_BEFORE))"

if [ $((ORDERS_AFTER - ORDERS_BEFORE)) -eq 10 ]; then
  echo "Database integrity test PASSED"
else
  echo "Database integrity test FAILED - expected 10 new orders"
fi
```

**Expected Results**:
- Database record counts match expected values
- No orphaned or inconsistent records are created
- All transactions complete successfully
- Database remains in a consistent state

## 9. Execution Instructions

### 9.1 Test Environment Setup

**Prerequisites**:
- Python 3.9+ and Node.js 14+ installed
- PostgreSQL 12+ configured
- Twilio account for SMS testing (optional)

**Setup Steps**:
1. Clone the repository
2. Create and activate Python virtual environment:
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```
3. Install backend dependencies:
   ```bash
   pip install -r requirements.txt
   ```
4. Set up the database:
   ```bash
   python pg_init.py
   python create_admin.py
   python load_test_data.py
   ```
5. Install frontend dependencies:
   ```bash
   cd "Barista Front End"
   npm install
   ```
6. Start the system:
   ```bash
   ./start_expresso.sh
   ```

### 9.2 Test Execution

1. Run API tests first to verify backend functionality:
   ```bash
   ./test_api.py
   ./test_login.py
   ./test_jwt.py
   ```

2. Execute frontend integration tests:
   ```bash
   cd "Barista Front End"
   npm test
   ```

3. Perform manual tests for each interface using the test scripts provided above

4. Document results, including:
   - Test execution date and time
   - Pass/fail status for each test
   - Error details for failed tests
   - Performance metrics where applicable

## 10. Maintenance and Updates

### 10.1 Updating Test Scripts

When making changes to the codebase:
1. Update relevant test scripts to match new functionality
2. Add new tests for new features
3. Verify all existing tests still pass

### 10.2 Test Data Management

To reset test data:
```bash
python reset_test_data.py
```

To create a specific test scenario:
```bash
python create_test_scenario.py --scenario=high_volume
```

---

These test scripts provide a comprehensive approach to verifying all aspects of the Coffee Cue system. By executing these tests regularly, you can ensure the system remains reliable and functional across all updates and changes.