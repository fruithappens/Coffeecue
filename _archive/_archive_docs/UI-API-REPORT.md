# Coffee Cue System - UI Elements, API Contracts, and Event Flows

This document provides a comprehensive analysis of the Coffee Cue system's UI components, API contracts, and event flows to facilitate testing and automation.

## 1. User Interfaces and Components

The Coffee Cue system is divided into several distinct interfaces, each with specialized UI components:

### 1.1 Barista Interface

The primary interface for coffee preparation and order management.

**Main Components:**
- `BaristaInterface.js` - Container component for barista view
- `PendingOrdersSection.js` - Displays upcoming orders
- `CurrentOrderSection.js` - Shows orders currently being prepared
- `InProgressOrder.js` - Individual order card for in-progress orders
- `RegularOrdersList.js` - Standard priority orders
- `VipOrdersList.js` - High-priority VIP orders
- `BatchGroupsList.js` - Grouped orders that can be processed together

**Key UI Elements:**
- Order Cards:
  ```html
  <div className="mb-2 p-3 rounded-lg border-l-4 border-[color] shadow-sm hover:shadow transition-all">
  ```
- Start Order Button:
  ```html
  <button className="px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-md text-sm">Start</button>
  ```
- Complete Order Button:
  ```html
  <button className="w-full py-3 rounded-lg font-bold text-lg bg-green-500 text-white hover:bg-green-600">COMPLETE ORDER</button>
  ```
- Message Customer Button:
  ```html
  <button className="flex-1 bg-gray-200 py-2 rounded flex items-center justify-center space-x-1 hover:bg-gray-300">
    <MessageCircle size={18} />
    <span>Message Customer</span>
  </button>
  ```
- Time Pressure Bar:
  ```html
  <div className="bg-gray-200 h-2 rounded-full overflow-hidden">
    <div className="h-2 bg-[color]" style={{ width: `${percent}%` }}></div>
  </div>
  ```

### 1.2 Organizer Interface

Management interface for staff and administrators to oversee operations.

**Main Components:**
- `OrganiserInterface.js` - Container for organizer view
- `StationManagementPanel.js` - Manage coffee stations
- `GroupOrdersTab.js` - Bulk order processing
- `Dashboard` section - Performance metrics and statistics

**Key UI Elements:**
- Navigation Sidebar:
  ```html
  <div className="bg-white shadow-lg w-64 transition-all duration-300 flex flex-col">
  ```
- Navigation Button:
  ```html
  <button className="w-full flex items-center px-3 py-2 rounded-md bg-amber-100 text-amber-800">
  ```
- Dashboard Cards:
  ```html
  <div className="bg-white p-6 rounded-lg shadow">
    <h2 className="text-lg font-semibold mb-4">Daily Orders</h2>
    <div className="text-3xl font-bold">127</div>
  </div>
  ```
- Stations Table:
  ```html
  <table className="min-w-full divide-y divide-gray-200">
    <thead>...</thead>
    <tbody className="bg-white divide-y divide-gray-200">...</tbody>
  </table>
  ```

### 1.3 Display Interface

Public-facing screen showing order status for customers.

**Main Components:**
- `DisplayScreen.js` - Main display component
- Order sections for "In Progress" and "Ready for Pickup"

**Key UI Elements:**
- Header:
  ```html
  <header style={{ backgroundColor: config.header_color || '#1e40af' }} className="text-white p-4">
  ```
- In Progress Orders Section:
  ```html
  <div className="bg-white rounded-lg shadow-lg overflow-hidden">
    <div className="bg-amber-500 text-white p-4">
      <div className="flex items-center">
        <Clock size={24} className="mr-2" />
        <h2 className="text-xl font-bold">In Progress</h2>
      </div>
    </div>
    <div className="divide-y divide-gray-200">...</div>
  </div>
  ```
- Ready for Pickup Orders Section:
  ```html
  <div className="bg-white rounded-lg shadow-lg overflow-hidden">
    <div className="bg-green-600 text-white p-4">
      <div className="flex items-center">
        <Check size={24} className="mr-2" />
        <h2 className="text-xl font-bold">Ready for Pickup</h2>
      </div>
    </div>
    <div className="divide-y divide-gray-200">...</div>
  </div>
  ```
- Station Selector:
  ```html
  <select id="station-select" value={currentStation?.id || ''} onChange={(e) => handleStationChange(e.target.value)} className="border rounded px-2 py-1 text-gray-700">
  ```

### 1.4 Common Components

Components shared across multiple interfaces:

- `NotificationSystem.js` - Toast notifications
- `ApiNotificationBanner.js` - Connection status alerts
- `MessageDialog.js` - SMS messaging interface
- `WaitTimeDialog.js` - Wait time adjustment
- `Tooltip.js` - Contextual help tooltips
- `StationCapabilities.js` - Station information

## 2. API Contracts

The system uses a RESTful API with the following key endpoints and data formats:

### 2.1 Authentication Endpoints

| Endpoint | Method | Request Format | Response Format |
|----------|--------|----------------|-----------------|
| `/api/auth/login` | POST | `{ "username": string, "password": string }` | `{ "status": "success", "token": string, "refreshToken": string, "expiresIn": number, "user": object }` |
| `/api/auth/refresh` | POST | `{ "refreshToken": string }` | `{ "status": "success", "token": string, "expiresIn": number }` |

### 2.2 Order Management Endpoints

| Endpoint | Method | Request Format | Response Format |
|----------|--------|----------------|-----------------|
| `/api/orders/pending` | GET | - | `[{ "id": string, "order_number": string, "customerName": string, "coffeeType": string, "milkType": string, "sugar": string, "status": string, "createdAt": string, "waitTime": number, "promisedTime": number, "priority": boolean }]` |
| `/api/orders/in-progress` | GET | - | `[{ "id": string, "order_number": string, "customerName": string, "phoneNumber": string, "coffeeType": string, "milkType": string, "sugar": string, "extraHot": boolean, "priority": boolean, "createdAt": string, "waitTime": number, "promisedTime": number }]` |
| `/api/orders/completed` | GET | - | `[{ "id": string, "order_number": string, "customerName": string, "phoneNumber": string, "coffeeType": string, "milkType": string, "completedAt": string, "pickedUpAt": string, "pickedUp": boolean }]` |
| `/api/orders/<order_id>/start` | POST | - | `{ "success": boolean, "message": string }` |
| `/api/orders/<order_id>/complete` | POST | - | `{ "success": boolean, "message": string }` |
| `/api/orders/<order_id>/pickup` | POST | - | `{ "success": boolean, "message": string }` |
| `/api/orders/<order_id>/message` | POST | `{ "message": string }` | `{ "success": boolean, "message": string, "message_sid": string }` |

### 2.3 Batch Processing Endpoints

| Endpoint | Method | Request Format | Response Format |
|----------|--------|----------------|-----------------|
| `/api/orders/batch` | POST | `{ "order_ids": string[], "action": string }` | `{ "success": boolean, "processed": number, "total": number }` |
| `/api/orders/batch/add` | POST | `{ "orders": Order[], "group_code": string, "group_name": string, "notes": string }` | `{ "success": boolean, "count": number }` |

### 2.4 SMS Endpoints

| Endpoint | Method | Request Format | Response Format |
|----------|--------|----------------|-----------------|
| `/api/sms/send` | POST | `{ "order_id": string, "message": string }` | `{ "success": boolean, "message": string, "message_sid": string }` |
| `/api/sms/send-test` | POST | `{ "to": string, "message": string }` | `{ "success": boolean, "message": string, "message_sid": string }` |

### 2.5 Station Management Endpoints

| Endpoint | Method | Request Format | Response Format |
|----------|--------|----------------|-----------------|
| `/api/stations` | GET | - | `[{ "id": number, "name": string, "location": string, "status": string, "currentLoad": number }]` |
| `/api/stations/<station_id>/status` | PATCH | `{ "status": string }` | `{ "success": boolean, "message": string }` |

### 2.6 Settings Endpoints

| Endpoint | Method | Request Format | Response Format |
|----------|--------|----------------|-----------------|
| `/api/settings` | GET | - | `{ "settings": object }` |
| `/api/settings/wait-time` | POST | `{ "waitTime": number, "stationId": number }` | `{ "success": boolean, "message": string }` |

## 3. Data Structures

### 3.1 Order Object

The core data structure used throughout the system, with variations based on status:

```javascript
{
  id: string,                     // Unique identifier (often order_number)
  orderNumber: string,            // Customer-facing order number
  customerName: string,           // Customer name
  phoneNumber: string,            // Customer phone
  coffeeType: string,             // Type of coffee
  milkType: string,               // Type of milk
  sugar: string,                  // Sugar preference
  status: 'pending' | 'in-progress' | 'completed', // Order status
  createdAt: string,              // ISO timestamp
  waitTime: number,               // Minutes since order was placed
  promisedTime: number,           // Expected wait time in minutes
  priority: boolean,              // VIP/priority flag
  extraHot: boolean,              // Temperature preference
  alternativeMilk: boolean,       // Alternative milk flag
  batchGroup: string | null,      // Group for batch processing
  
  // Timing fields
  startedAt: string | null,       // When order was started
  completedAt: string | null,     // When order was completed
  pickedUpAt: string | null,      // When order was picked up
  
  // Station assignment fields
  stationId: number | null,       // Primary station ID
  station_id: number | null,      // Alternative station ID field
  assignedStation: number | null, // Another alternative
  assigned_to_station: number | null, // Another alternative
}
```

### 3.2 Station Object

```javascript
{
  id: number,                    // Station ID
  name: string,                  // Station name
  location: string | null,       // Physical location
  status: 'active' | 'inactive' | 'maintenance', // Station status
  currentLoad: number,           // Current order load
  barista: string | null,        // Assigned barista
  capabilities: string[]         // Special capabilities
}
```

### 3.3 Settings Object

```javascript
{
  displaySettings: {
    eventName: string,           // Event name
    organizationName: string,    // Organization
    headerColor: string,         // Header color (hex)
    customMessage: string,       // Custom message
    smsNumber: string,           // SMS number
    showSponsor: boolean,        // Sponsor toggle
    sponsorName: string,         // Sponsor name
    sponsorMessage: string       // Sponsor message
  },
  waitTimeWarning: number,       // Wait time threshold
  notificationSettings: {
    sound: boolean,              // Sound notification toggle
    sms: boolean                 // SMS notification toggle
  }
}
```

## 4. CSS Classes and Styling

### 4.1 Order Status Colors

```css
/* Status colors */
.bg-amber-500 /* In Progress header */
.bg-green-600 /* Ready for Pickup header */
.bg-red-500 /* VIP/priority indicator */
.border-red-500 /* VIP order border */
.border-yellow-500 /* Batch order border */
.border-blue-500 /* Regular order border */

/* Time pressure indicators */
.bg-green-500 /* Low wait time */
.bg-yellow-500 /* Medium wait time */
.bg-orange-500 /* High wait time */
.bg-red-500 /* Critical wait time */
```

### 4.2 Milk Type Indicators

```css
/* Milk type indicators */
.milk-indicator-dot /* Base class */
.order-milk-1 /* Regular milk */
.order-milk-2 /* Skim milk */
.order-milk-3 /* Soy milk */
.order-milk-4 /* Almond milk */
.order-milk-5 /* Oat milk */
.order-milk-6 /* Coconut milk */
```

### 4.3 Button Styles

```css
/* Primary action buttons */
.bg-amber-600.hover:bg-amber-700.text-white.rounded-md /* Start order */
.bg-green-500.text-white.hover:bg-green-600 /* Complete order */

/* Secondary action buttons */
.bg-gray-200.hover:bg-gray-300 /* Message, Print, etc. */
.bg-gray-300.hover:bg-gray-400.text-gray-700 /* Delay */

/* Navigation buttons */
.bg-amber-100.text-amber-800 /* Selected nav item */
.text-gray-700.hover:bg-gray-100 /* Unselected nav item */
```

## 5. Event Flows

The system uses several key event flows that are essential for understanding interaction patterns:

### 5.1 Order Processing Flow

1. **Order Creation**
   - Order appears in `PendingOrdersSection`
   - If order is new, triggers `app:newOrder` event for sound notification

2. **Starting an Order**
   - User clicks "Start" button on a pending order
   - `startOrder()` is called with the order object
   - `OrderDataService.startOrder()` sends API request to `/api/orders/<order_id>/start`
   - Order is removed from `pendingOrders` state
   - Order is added to `inProgressOrders` state
   - Order card moves from `PendingOrdersSection` to `CurrentOrderSection`

3. **Completing an Order**
   - User clicks "Complete Order" button on an in-progress order
   - `completeOrder()` is called with the order ID
   - `OrderDataService.completeOrder()` sends API request to `/api/orders/<order_id>/complete`
   - Order is removed from `inProgressOrders` state
   - Order is added to `completedOrders` state
   - Order card moves from `CurrentOrderSection` to `DisplayScreen`'s "Ready for Pickup" section
   - Triggers `app:orderCompleted` event for sound notification

4. **Pick Up Order**
   - User marks an order as picked up
   - `markOrderPickedUp()` is called with the order ID
   - `OrderDataService.markOrderPickedUp()` sends API request to `/api/orders/<order_id>/pickup`
   - Order is removed from `completedOrders` state
   - Order is added to `previousOrders` state

### 5.2 Data Refresh Flow

1. **Automatic Refresh**
   - Orders are refreshed automatically based on `autoRefreshInterval` setting (default 60 seconds)
   - `fetchOrdersData()` is called to update all order lists
   - Order states (`pendingOrders`, `inProgressOrders`, etc.) are updated

2. **Manual Refresh**
   - User clicks refresh button
   - `refreshData()` is called
   - Triggers debounced refresh with 5-second cooldown
   - Updates `lastUpdated` timestamp

3. **Tab Visibility Refresh**
   - When a browser tab becomes visible again
   - `visibilitychange` event listener triggers
   - `fetchOrdersData()` is called

### 5.3 Messaging Flow

1. **Send Message to Customer**
   - User clicks "Message Customer" button
   - Message dialog opens
   - User enters message text
   - `sendMessage()` is called with order ID and message
   - `OrderDataService.sendMessageToCustomer()` sends API request to `/api/orders/<order_id>/message`
   - System displays success/error notification

### 5.4 Batch Processing Flow

1. **Start Batch of Orders**
   - User selects batch group or multiple orders
   - `processBatch()` or `processBatchSelection()` is called
   - `OrderDataService.processBatch()` sends API request to `/api/orders/batch`
   - All selected orders move from pending to in-progress

### 5.5 Station Change Flow

1. **Change Working Station**
   - User selects a different station
   - `updateStationId()` is called with new station ID
   - Local storage is updated with station preference
   - `fetchOrdersData()` is called to load station-specific orders

## 6. Local Storage Usage

The system makes extensive use of localStorage for data persistence:

```javascript
// Authentication
localStorage.getItem('coffee_system_token')
localStorage.getItem('coffee_auth_token')

// State persistence
localStorage.getItem(`orders_cache_station_${stationId}`)
localStorage.getItem(`local_orders_station_${stationId}`)
localStorage.getItem('coffee_cue_selected_station')

// Settings
localStorage.getItem('coffee_auto_refresh_enabled')
localStorage.getItem('coffee_auto_refresh_interval')
localStorage.getItem(`station_${stationId}_wait_time`)
localStorage.getItem(`station_${stationId}_avg_prep_time`)
```

## 7. Error Handling Patterns

The system implements several error handling patterns:

1. **API Connection Failures**
   - Primary mechanism: Fall back to localStorage cached data
   - Visual indicator: `ApiNotificationBanner` component shows connection status
   - Cache key: `orders_cache_station_${stationId}`

2. **Optimistic UI Updates**
   - Pattern: Update UI immediately, then confirm with API
   - Error recovery: Refresh data if API call fails
   - Implementation: State updates before API confirmation

3. **Fallback Data**
   - Key flag: `use_fallback_data` in localStorage
   - Implementation: Cached sample data in case of persistent API failures
   - Pattern: Multiple fallback layers (API → direct fetch → localStorage → sample data)

## 8. Testing Considerations

Based on this analysis, the following testing considerations are critical:

1. **Authentication Testing**
   - Test token storage and refresh mechanisms
   - Verify role-based access control across interfaces
   - Test token expiration handling

2. **UI Component Testing**
   - Test order card rendering with different status values
   - Verify status color indicators
   - Test responsive layouts across device sizes

3. **Data Flow Testing**
   - Verify order state changes across the complete workflow
   - Test batch processing functionality
   - Ensure display screens update properly

4. **API Resilience Testing**
   - Test behavior when API is unavailable
   - Verify fallback mechanisms work correctly
   - Test localStorage persistence

5. **Cross-Interface Testing**
   - Verify changes in one interface reflect in others
   - Test station filtering across interfaces
   - Ensure consistent data presentation

6. **Performance Testing**
   - Test with large numbers of orders (100+)
   - Verify rendering performance
   - Test auto-refresh with various intervals