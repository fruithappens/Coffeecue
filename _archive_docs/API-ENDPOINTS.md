# Expresso Coffee Ordering System - API Endpoints and Frontend Integration

This document maps the backend API endpoints to their corresponding frontend actions and components.

## Authentication Endpoints

| Endpoint | Method | Description | Frontend Component | Action |
|----------|--------|-------------|-------------------|--------|
| `/api/auth/login` | POST | Login and receive JWT tokens | `LoginPage`, `AuthService` | User login with username/password |
| `/api/auth/refresh` | POST | Refresh access token using refresh token | `ApiService` | Automatic token refresh |
| `/api/auth/verify` | GET | Verify authentication status | `AppRouter`, `AuthService` | Check if user is authenticated |

## System Endpoints

| Endpoint | Method | Description | Frontend Component | Action |
|----------|--------|-------------|-------------------|--------|
| `/api/status` | GET | Get system status | `ApiNotificationBanner`, `SupportApiNotificationBanner` | Check system health |
| `/api/test` | GET | Simple connectivity test | `ApiDebugPanel` | Test API connection |

## Order Management Endpoints

| Endpoint | Method | Description | Frontend Component | Action |
|----------|--------|-------------|-------------------|--------|
| `/api/orders/pending` | GET | Get pending orders | `PendingOrdersSection`, `RegularOrdersList`, `VipOrdersList` | Display orders waiting to be made |
| `/api/orders/in-progress` | GET | Get in-progress orders | `CurrentOrderSection`, `InProgressOrder` | Display orders being made |
| `/api/orders/completed` | GET | Get completed orders | `DisplayScreen` | Display recently completed orders |
| `/api/orders/history` | GET | Get order history with filtering | `OrganiserInterface` | View historical orders |
| `/api/orders/statistics` | GET | Get order statistics | `OrganiserInterface` (Dashboard) | Display order metrics |
| `/api/orders/lookup/<order_id>` | GET | Look up order details | `CurrentOrderSection`, `OrderDetailDialog` | Get specific order info |
| `/api/orders/<order_id>/start` | POST | Start an order | `PendingOrdersSection` | Begin making an order |
| `/api/orders/<order_id>/complete` | POST | Complete an order | `CurrentOrderSection`, `InProgressOrder` | Mark order as completed |
| `/api/orders/<order_id>/pickup` | POST | Mark order as picked up | `DisplayScreen` | Update order status to picked up |
| `/api/orders/batch` | POST | Process multiple orders | `BatchGroupsList` | Start multiple orders together |
| `/api/orders/<order_id>/message` | POST | Send message to customer | `OrderNotificationHandler` | Send SMS to customer |

## Display Endpoints

| Endpoint | Method | Description | Frontend Component | Action |
|----------|--------|-------------|-------------------|--------|
| `/api/display/config` | GET | Get display configuration | `DisplaySelector`, `DisplayScreen` | Configure public display |
| `/api/display/orders` | GET | Get orders for display | `DisplayScreen` | Show order status on public display |

## Settings Endpoints

| Endpoint | Method | Description | Frontend Component | Action |
|----------|--------|-------------|-------------------|--------|
| `/api/settings` | GET | Get all system settings | `SettingsService`, `useSettings` | Load system settings |
| `/api/settings` | PUT | Update multiple settings | `OrganiserInterface` (Settings) | Save multiple settings |
| `/api/settings` | PATCH | Update a single setting | `SystemModeToggle`, `SMSSettingsPanel` | Update individual setting |
| `/api/settings/reset` | POST | Reset settings to defaults | `OrganiserInterface` (Settings) | Restore default settings |
| `/api/settings/wait-time` | POST | Update estimated wait time | `SessionControlPanel` | Set current wait time estimate |

## Station Endpoints

| Endpoint | Method | Description | Frontend Component | Action |
|----------|--------|-------------|-------------------|--------|
| `/api/stations` | GET | Get all coffee stations | `StationsService`, `useStations` | Load all station information |
| `/api/stations/<station_id>` | GET | Get specific station details | `StationCapabilities` | Show station details |
| `/api/stations/<station_id>/status` | PATCH | Update station status | `StationManagementPanel` | Change station status |
| `/api/stations/<station_id>/stats` | GET | Get station statistics | `StationManagementPanel` | Display station metrics |
| `/api/stations` | POST | Create a new station | `StationManagementPanel` | Add new coffee station |
| `/api/stations/<station_id>/barista` | PATCH | Assign barista to station | `StationManagementPanel` | Assign staff to station |

## SMS Endpoints

| Endpoint | Method | Description | Frontend Component | Action |
|----------|--------|-------------|-------------------|--------|
| `/api/sms/send` | POST | Send SMS message | `OrderNotificationHandler` | Send notification to customer |
| `/api/sms/send-test` | POST | Send test SMS | `SMSSettingsPanel` | Test SMS notifications |

## Chat Endpoints

| Endpoint | Method | Description | Frontend Component | Action |
|----------|--------|-------------|-------------------|--------|
| `/api/chat/messages` | GET | Get chat messages | `StationChat`, `MessageHistory` | Load chat history |
| `/api/chat/messages` | POST | Create chat message | `StationChat` | Send new chat message |
| `/api/chat/messages/<message_id>` | GET | Get specific chat message | `MessageHistory` | View specific message |
| `/api/chat/messages/<message_id>` | DELETE | Delete a chat message | `MessageHistory` | Remove message from history |
| `/api/chat/stations` | GET | Get active stations for chat | `StationChat` | Get available chat participants |

## Schedule Endpoints

| Endpoint | Method | Description | Frontend Component | Action |
|----------|--------|-------------|-------------------|--------|
| `/api/schedule/today` | GET | Get today's schedule | `ScheduleService`, `useSchedule` | View today's shifts |
| `/api/schedule/date/<date>` | GET | Get schedule for specific date | `OrganiserInterface` (Schedule) | View schedule for a date |
| `/api/schedule/barista/<barista_name>` | GET | Get specific barista's schedule | `OrganiserInterface` (Schedule) | View individual's schedule |
| `/api/schedule/shifts` | POST | Add new shift | `OrganiserInterface` (Schedule) | Create staff shift |
| `/api/schedule/shifts/<shift_id>` | PUT | Update shift | `OrganiserInterface` (Schedule) | Modify existing shift |
| `/api/schedule/shifts/<shift_id>` | DELETE | Delete shift | `OrganiserInterface` (Schedule) | Remove staff shift |
| `/api/schedule/breaks` | POST | Add new break | `OrganiserInterface` (Schedule) | Add break to shift |
| `/api/schedule/breaks/<break_id>` | PUT | Update break | `OrganiserInterface` (Schedule) | Modify existing break |
| `/api/schedule/breaks/<break_id>` | DELETE | Delete break | `OrganiserInterface` (Schedule) | Remove break from shift |
| `/api/schedule/rush-periods` | POST | Add new rush period | `OrganiserInterface` (Schedule) | Mark high-volume period |

## Inventory Endpoints

| Endpoint | Method | Description | Frontend Component | Action |
|----------|--------|-------------|-------------------|--------|
| `/api/inventory` | GET | Get all inventory items | `StockService`, `useStock` | Load inventory items |
| `/api/inventory/categories` | GET | Get inventory categories | `StockManagementSection` | Load item categories |
| `/api/inventory/low-stock` | GET | Get low stock items | `StockManagementSection` | Check for low inventory |
| `/api/inventory/<item_id>` | GET | Get specific inventory item | `StockManagementSection` | View item details |
| `/api/inventory/<item_id>` | PUT | Update inventory item | `StockManagementSection` | Modify inventory item |
| `/api/inventory/<item_id>` | DELETE | Delete inventory item | `StockManagementSection` | Remove inventory item |
| `/api/inventory/<item_id>/adjust` | POST | Adjust inventory quantity | `StockManagementSection` | Update stock levels |
| `/api/inventory/<item_id>/report-low` | POST | Report item as low in stock | `StockManagementSection` | Flag low inventory |
| `/api/inventory/restock-request` | POST | Create a restock request | `StockManagementSection` | Request inventory refill |
| `/api/inventory/restock-requests` | GET | Get list of restock requests | `OrganiserInterface` | View pending restocks |
| `/api/inventory/restock-requests/<restock_id>` | GET | Get restock request details | `OrganiserInterface` | View restock details |
| `/api/inventory/restock-requests/<restock_id>/complete` | POST | Complete a restock request | `OrganiserInterface` | Process completed restock |
| `/api/inventory` | POST | Create new inventory item | `StockManagementSection` | Add new inventory item |

## Data Flow

1. **Order Processing Flow**:
   - Customer places order → `/api/orders/pending` → `PendingOrdersSection` displays order
   - Barista starts order → `/api/orders/<order_id>/start` → Order moves to `CurrentOrderSection`
   - Barista completes order → `/api/orders/<order_id>/complete` → Order appears on `DisplayScreen`
   - Customer picks up order → `/api/orders/<order_id>/pickup` → Order removed from display

2. **Station Management Flow**:
   - Admin creates station → `/api/stations` (POST) → Station appears in `StationManagementPanel`
   - Admin assigns barista → `/api/stations/<station_id>/barista` → Station updated in system
   - Admin updates status → `/api/stations/<station_id>/status` → Station availability changes

3. **Inventory Management Flow**:
   - Barista reports low stock → `/api/inventory/<item_id>/report-low` → Alert in `StockManagementSection`
   - Admin creates restock request → `/api/inventory/restock-request` → Request appears in system
   - Admin completes restock → `/api/inventory/restock-requests/<restock_id>/complete` → Inventory updated

4. **Communication Flow**:
   - Barista sends message → `/api/chat/messages` (POST) → Message appears in `StationChat`
   - System notifies customer → `/api/orders/<order_id>/message` → SMS sent through `OrderNotificationHandler`