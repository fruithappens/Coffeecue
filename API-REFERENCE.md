# Expresso Coffee Ordering System API Reference

This document provides a reference to the standardized REST API endpoints for the Expresso Coffee Ordering System. 
All API endpoints follow a consistent structure and authentication model.

## Base URL

All API endpoints are prefixed with `/api`. For example, `/api/orders/pending`.

## Authentication

The API uses JWT (JSON Web Token) authentication. To access protected endpoints, include an `Authorization` header with a bearer token:

```
Authorization: Bearer <your_jwt_token>
```

### Authentication Endpoints

| Endpoint | Method | Description | Authentication Required |
|----------|--------|-------------|------------------------|
| `/api/auth/login` | POST | Login and receive JWT tokens | No |
| `/api/auth/refresh` | POST | Refresh access token using refresh token | No |
| `/api/auth/verify` | GET | Verify authentication status | Optional |

#### Login Example

**Request:**
```json
POST /api/auth/login
{
  "username": "barista",
  "password": "coffee123"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Login successful",
  "token": "eyJhbGc...",
  "refreshToken": "eyJhbGc...",
  "expiresIn": 3600,
  "user": {
    "id": 1,
    "username": "barista",
    "email": "barista@example.com",
    "role": "barista",
    "full_name": "Coffee Barista"
  }
}
```

## System Endpoints

| Endpoint | Method | Description | Authentication Required |
|----------|--------|-------------|------------------------|
| `/api/status` | GET | Get system status | No |
| `/api/test` | GET | Simple connectivity test | No |

## Order Management Endpoints

| Endpoint | Method | Description | Authentication Required | Roles |
|----------|--------|-------------|------------------------|-------|
| `/api/orders/pending` | GET | Get pending orders | Yes | admin, staff, barista |
| `/api/orders/in-progress` | GET | Get in-progress orders | Yes | admin, staff, barista |
| `/api/orders/completed` | GET | Get completed orders | Yes | admin, staff, barista |
| `/api/orders/history` | GET | Get order history with filtering | Yes | admin, staff, barista |
| `/api/orders/statistics` | GET | Get order statistics | Yes | admin, staff |
| `/api/orders/lookup/<order_id>` | GET | Look up order details | Yes | admin, staff, barista |
| `/api/orders/<order_id>/start` | POST | Start an order | Yes | admin, staff, barista |
| `/api/orders/<order_id>/complete` | POST | Complete an order | Yes | admin, staff, barista |
| `/api/orders/<order_id>/pickup` | POST | Mark order as picked up | Yes | admin, staff, barista |
| `/api/orders/batch` | POST | Process multiple orders | Yes | admin, staff, barista |
| `/api/orders/<order_id>/message` | POST | Send message to customer | Yes | admin, staff, barista |

### Order History Endpoint

The order history endpoint allows filtering orders by various criteria.

```
GET /api/orders/history?start_date=2023-01-01&end_date=2023-01-31&status=completed&limit=50&offset=0
```

Query parameters:
- `start_date`: Filter orders created on or after this date (YYYY-MM-DD)
- `end_date`: Filter orders created on or before this date (YYYY-MM-DD)
- `status`: Filter by order status (pending, in-progress, completed)
- `station_id`: Filter by station ID
- `customer_name`: Filter by customer name (partial match)
- `limit`: Maximum number of orders to return (default: 50)
- `offset`: Number of orders to skip for pagination (default: 0)

Response:
```json
{
  "success": true,
  "orders": [
    {
      "id": "12345",
      "order_number": "12345",
      "customer_name": "Jane Smith",
      "phone_number": "+61412345678",
      "coffee_type": "Latte",
      "milk_type": "Almond",
      "sugar": "1 sugar",
      "status": "completed",
      "station_id": 1,
      "created_at": "2023-01-15T09:30:00",
      "updated_at": "2023-01-15T09:45:00",
      "completed_at": "2023-01-15T09:45:00",
      "notes": "Extra hot"
    },
    // Additional orders...
  ],
  "pagination": {
    "total": 120,
    "offset": 0,
    "limit": 50
  }
}
```

### Order Statistics Endpoint

The order statistics endpoint provides aggregated data about orders.

```
GET /api/orders/statistics?period=week&start_date=2023-01-01&end_date=2023-01-31
```

Query parameters:
- `period`: Time period for statistics (day, week, month, year)
- `start_date`: Start date for statistics (YYYY-MM-DD)
- `end_date`: End date for statistics (YYYY-MM-DD)

Response:
```json
{
  "success": true,
  "statistics": {
    "date_range": {
      "start_date": "2023-01-01",
      "end_date": "2023-01-31"
    },
    "by_status": {
      "pending": 5,
      "in-progress": 10,
      "completed": 105
    },
    "by_day": {
      "2023-01-01": 2,
      "2023-01-02": 8,
      // Additional days...
    },
    "by_coffee_type": {
      "Latte": 45,
      "Cappuccino": 35,
      "Espresso": 20,
      // Additional types...
    },
    "by_milk_type": {
      "Full Cream": 50,
      "Almond": 25,
      "Oat": 20,
      // Additional types...
    },
    "by_hour": {
      "8": 15,
      "9": 25,
      "10": 30,
      // Additional hours...
    },
    "total_orders": 120
  }
}
```

## Display Endpoints (Public)

These endpoints are used by the public display screen and do not require authentication.

| Endpoint | Method | Description | Authentication Required |
|----------|--------|-------------|------------------------|
| `/api/display/config` | GET | Get display configuration | No |
| `/api/display/orders` | GET | Get orders for display | No |

## Settings Endpoints

| Endpoint | Method | Description | Authentication Required | Roles |
|----------|--------|-------------|------------------------|-------|
| `/api/settings` | GET | Get all system settings | Yes | admin, staff, barista |
| `/api/settings` | PUT | Update multiple settings | Yes | admin, staff |
| `/api/settings` | PATCH | Update a single setting | Yes | admin, staff, barista |
| `/api/settings/reset` | POST | Reset settings to defaults | Yes | admin, staff |
| `/api/settings/wait-time` | POST | Update estimated wait time | Yes | admin, staff, barista |

## Station Endpoints

| Endpoint | Method | Description | Authentication Required | Roles |
|----------|--------|-------------|------------------------|-------|
| `/api/stations` | GET | Get all coffee stations | Yes | admin, staff, barista |
| `/api/stations/<station_id>` | GET | Get specific station details | Yes | admin, staff, barista |
| `/api/stations/<station_id>/status` | PATCH | Update station status | Yes | admin, staff, barista |
| `/api/stations/<station_id>/stats` | GET | Get station statistics | Yes | admin, staff, barista |
| `/api/stations` | POST | Create a new station | Yes | admin, staff |
| `/api/stations/<station_id>/barista` | PATCH | Assign barista to station | Yes | admin, staff |

### Station Management Examples

#### Get All Stations

```
GET /api/stations
```

Response:
```json
{
  "success": true,
  "count": 3,
  "stations": [
    {
      "station_id": 1,
      "status": "active",
      "current_load": 2,
      "total_orders": 152,
      "avg_completion_time": 180,
      "barista_name": "Jane Smith",
      "last_updated": "2023-01-15T09:30:00",
      "last_updated_formatted": "2023-01-15 09:30:00"
    },
    {
      "station_id": 2,
      "status": "active",
      "current_load": 1,
      "total_orders": 143,
      "avg_completion_time": 195,
      "barista_name": "John Doe",
      "last_updated": "2023-01-15T09:35:00",
      "last_updated_formatted": "2023-01-15 09:35:00"
    },
    {
      "station_id": 3,
      "status": "maintenance",
      "current_load": 0,
      "total_orders": 98,
      "avg_completion_time": 210,
      "barista_name": null,
      "last_updated": "2023-01-15T08:15:00",
      "last_updated_formatted": "2023-01-15 08:15:00"
    }
  ]
}
```

#### Get Station Details

```
GET /api/stations/1
```

Response:
```json
{
  "success": true,
  "station": {
    "station_id": 1,
    "status": "active",
    "current_load": 2,
    "total_orders": 152,
    "avg_completion_time": 180,
    "barista_name": "Jane Smith",
    "last_updated": "2023-01-15T09:30:00",
    "last_updated_formatted": "2023-01-15 09:30:00",
    "todays_schedule": [
      {
        "id": 1,
        "station_id": 1,
        "day_of_week": 0,
        "start_time": "08:00",
        "end_time": "12:00",
        "break_start": "10:00",
        "break_end": "10:15",
        "notes": "Morning shift",
        "start_time_formatted": "8:00 AM",
        "end_time_formatted": "12:00 PM",
        "break_start_formatted": "10:00 AM",
        "break_end_formatted": "10:15 AM"
      },
      {
        "id": 2,
        "station_id": 1,
        "day_of_week": 0,
        "start_time": "12:00",
        "end_time": "16:00",
        "break_start": "14:00",
        "break_end": "14:15",
        "notes": "Afternoon shift",
        "start_time_formatted": "12:00 PM",
        "end_time_formatted": "4:00 PM",
        "break_start_formatted": "2:00 PM",
        "break_end_formatted": "2:15 PM"
      }
    ]
  }
}
```

#### Update Station Status

```
PATCH /api/stations/3/status
{
  "status": "active"
}
```

Response:
```json
{
  "success": true,
  "message": "Station status updated to active",
  "station": {
    "station_id": 3,
    "status": "active",
    "current_load": 0,
    "total_orders": 98,
    "avg_completion_time": 210,
    "barista_name": null,
    "last_updated": "2023-01-15T09:45:00",
    "last_updated_formatted": "2023-01-15 09:45:00"
  }
}
```

#### Assign Barista to Station

```
PATCH /api/stations/3/barista
{
  "barista_name": "Alex Johnson"
}
```

Response:
```json
{
  "success": true,
  "message": "Barista Alex Johnson assigned to station 3",
  "station": {
    "station_id": 3,
    "status": "active",
    "current_load": 0,
    "total_orders": 98,
    "avg_completion_time": 210,
    "barista_name": "Alex Johnson",
    "last_updated": "2023-01-15T09:50:00",
    "last_updated_formatted": "2023-01-15 09:50:00"
  }
}
```

#### Get Station Statistics

```
GET /api/stations/1/stats
```

Response:
```json
{
  "success": true,
  "stats": {
    "station_id": 1,
    "barista_name": "Jane Smith",
    "status": "active",
    "current_load": 2,
    "total_orders": 152,
    "avg_completion_time": 185,
    "avg_completion_time_formatted": "3:05",
    "orders_by_status": [
      {
        "status": "pending",
        "count": 2
      },
      {
        "status": "in-progress",
        "count": 1
      },
      {
        "status": "completed",
        "count": 149
      }
    ],
    "orders_by_hour": [
      {
        "hour": 8,
        "count": 15
      },
      {
        "hour": 9,
        "count": 25
      },
      {
        "hour": 10,
        "count": 20
      },
      {
        "hour": 11,
        "count": 18
      }
    ],
    "orders_by_day": [
      {
        "date": "2023-01-09",
        "date_formatted": "2023-01-09",
        "count": 35
      },
      {
        "date": "2023-01-10",
        "date_formatted": "2023-01-10",
        "count": 28
      },
      {
        "date": "2023-01-11",
        "date_formatted": "2023-01-11",
        "count": 31
      },
      {
        "date": "2023-01-12",
        "date_formatted": "2023-01-12",
        "count": 33
      },
      {
        "date": "2023-01-13",
        "date_formatted": "2023-01-13",
        "count": 40
      },
      {
        "date": "2023-01-14",
        "date_formatted": "2023-01-14",
        "count": 25
      },
      {
        "date": "2023-01-15",
        "date_formatted": "2023-01-15",
        "count": 12
      }
    ]
  }
}

## SMS Endpoints

| Endpoint | Method | Description | Authentication Required | Roles |
|----------|--------|-------------|------------------------|-------|
| `/api/sms/send` | POST | Send SMS message | Yes | admin, staff, barista |
| `/api/sms/send-test` | POST | Send test SMS | Yes | admin, staff, barista |

## Chat Endpoints

| Endpoint | Method | Description | Authentication Required | Roles |
|----------|--------|-------------|------------------------|-------|
| `/api/chat/messages` | GET | Get chat messages | Yes | admin, staff, barista |
| `/api/chat/messages` | POST | Create chat message | Yes | admin, staff, barista |
| `/api/chat/messages/<message_id>` | GET | Get specific chat message | Yes | admin, staff, barista |
| `/api/chat/messages/<message_id>` | DELETE | Delete a chat message | Yes | admin, staff, barista |
| `/api/chat/stations` | GET | Get active stations for chat | Yes | admin, staff, barista |

## Response Format

All API responses follow a consistent format:

```json
{
  "success": true,  // boolean indicating success or failure
  "message": "Optional message explaining the result",
  // Additional data specific to the endpoint
}
```

## Error Handling

When errors occur, the API returns a response with `success: false` and an error message:

```json
{
  "success": false,
  "message": "Error message explaining what went wrong"
}
```

HTTP status codes are also used appropriately:
- 200: Success
- 400: Bad request (client error)
- 401: Unauthorized (authentication required)
- 403: Forbidden (insufficient permissions)
- 404: Not found
- 500: Server error

## Role-Based Access

The API implements role-based access control with the following roles:

- `admin`: Full access to all endpoints
- `staff`: Access to order management, messaging, and settings
- `barista`: Access to order management and messaging
- `customer`: Limited access to their own orders (if implemented)

## Schedule Endpoints

| Endpoint | Method | Description | Authentication Required | Roles |
|----------|--------|-------------|------------------------|-------|
| `/api/schedule/today` | GET | Get today's schedule | Yes | admin, staff, barista |
| `/api/schedule/date/<date>` | GET | Get schedule for specific date | Yes | admin, staff, barista |
| `/api/schedule/barista/<barista_name>` | GET | Get specific barista's schedule | Yes | admin, staff, barista |
| `/api/schedule/shifts` | POST | Add new shift | Yes | admin, staff |
| `/api/schedule/shifts/<shift_id>` | PUT | Update shift | Yes | admin, staff |
| `/api/schedule/shifts/<shift_id>` | DELETE | Delete shift | Yes | admin, staff |
| `/api/schedule/breaks` | POST | Add new break | Yes | admin, staff |
| `/api/schedule/breaks/<break_id>` | PUT | Update break | Yes | admin, staff |
| `/api/schedule/breaks/<break_id>` | DELETE | Delete break | Yes | admin, staff |
| `/api/schedule/rush-periods` | POST | Add new rush period | Yes | admin, staff |

### Schedule Management Examples

#### Get Today's Schedule

```
GET /api/schedule/today
```

Response:
```json
{
  "success": true,
  "day_of_week": 0,
  "day_name": "Monday",
  "current_time": "10:15 AM",
  "schedules": [
    {
      "id": 1,
      "station_id": 1,
      "day_of_week": 0,
      "start_time": "08:00",
      "end_time": "12:00",
      "break_start": "10:00",
      "break_end": "10:15",
      "notes": "Morning shift",
      "barista_name": "Jane Smith",
      "start_time_formatted": "8:00 AM",
      "end_time_formatted": "12:00 PM",
      "break_start_formatted": "10:00 AM",
      "break_end_formatted": "10:15 AM"
    },
    {
      "id": 2,
      "station_id": 1,
      "day_of_week": 0,
      "start_time": "12:00",
      "end_time": "16:00",
      "break_start": "14:00",
      "break_end": "14:15",
      "notes": "Afternoon shift",
      "barista_name": "John Doe",
      "start_time_formatted": "12:00 PM",
      "end_time_formatted": "4:00 PM",
      "break_start_formatted": "2:00 PM",
      "break_end_formatted": "2:15 PM"
    }
  ],
  "stations": [
    {
      "station_id": 1,
      "status": "active",
      "current_load": 2,
      "total_orders": 152,
      "avg_completion_time": 180,
      "barista_name": "Jane Smith"
    },
    {
      "station_id": 2,
      "status": "active",
      "current_load": 1, 
      "total_orders": 143,
      "avg_completion_time": 195,
      "barista_name": "John Doe"
    }
  ]
}
```

#### Get Schedule for a Specific Date

```
GET /api/schedule/date/2023-01-15
```

Response:
```json
{
  "success": true,
  "date": "2023-01-15",
  "day_of_week": 6,
  "day_name": "Sunday",
  "schedules": [
    {
      "id": 15,
      "station_id": 1,
      "day_of_week": 6,
      "start_time": "09:00",
      "end_time": "14:00",
      "break_start": "11:30",
      "break_end": "12:00",
      "notes": "Weekend shift",
      "barista_name": "Alex Johnson",
      "start_time_formatted": "9:00 AM",
      "end_time_formatted": "2:00 PM",
      "break_start_formatted": "11:30 AM",
      "break_end_formatted": "12:00 PM"
    }
  ],
  "stations": [
    {
      "station_id": 1,
      "status": "active",
      "current_load": 0,
      "total_orders": 152,
      "avg_completion_time": 180,
      "barista_name": "Jane Smith"
    },
    {
      "station_id": 2,
      "status": "inactive",
      "current_load": 0,
      "total_orders": 143,
      "avg_completion_time": 195,
      "barista_name": "John Doe"
    }
  ]
}
```

#### Add New Shift

```
POST /api/schedule/shifts
{
  "station_id": 1,
  "day_of_week": 2,
  "start_time": "08:00",
  "end_time": "12:00",
  "break_start": "10:00",
  "break_end": "10:15",
  "notes": "Wednesday morning shift"
}
```

Response:
```json
{
  "success": true,
  "message": "Shift added to schedule successfully",
  "schedule": {
    "id": 25,
    "station_id": 1,
    "day_of_week": 2,
    "start_time": "08:00",
    "end_time": "12:00",
    "break_start": "10:00",
    "break_end": "10:15",
    "notes": "Wednesday morning shift",
    "barista_name": "Jane Smith",
    "start_time_formatted": "8:00 AM",
    "end_time_formatted": "12:00 PM",
    "break_start_formatted": "10:00 AM",
    "break_end_formatted": "10:15 AM"
  }
}
```

#### Update Shift

```
PUT /api/schedule/shifts/25
{
  "start_time": "08:30",
  "end_time": "12:30",
  "notes": "Updated Wednesday morning shift"
}
```

Response:
```json
{
  "success": true,
  "message": "Shift updated successfully",
  "schedule": {
    "id": 25,
    "station_id": 1,
    "day_of_week": 2,
    "start_time": "08:30",
    "end_time": "12:30",
    "break_start": "10:00",
    "break_end": "10:15",
    "notes": "Updated Wednesday morning shift",
    "barista_name": "Jane Smith",
    "start_time_formatted": "8:30 AM",
    "end_time_formatted": "12:30 PM",
    "break_start_formatted": "10:00 AM",
    "break_end_formatted": "10:15 AM"
  }
}
```

#### Delete Shift

```
DELETE /api/schedule/shifts/25
```

Response:
```json
{
  "success": true,
  "message": "Shift 25 deleted successfully"
}
```

#### Add Break to Shift

```
POST /api/schedule/breaks
{
  "shift_id": 26,
  "break_start": "14:30",
  "break_end": "14:45",
  "notes": "Afternoon coffee break"
}
```

Response:
```json
{
  "success": true,
  "message": "Break added to shift successfully",
  "schedule": {
    "id": 26,
    "station_id": 2,
    "day_of_week": 2,
    "start_time": "12:00",
    "end_time": "16:00",
    "break_start": "14:30",
    "break_end": "14:45",
    "notes": "Afternoon coffee break",
    "barista_name": "John Doe",
    "start_time_formatted": "12:00 PM",
    "end_time_formatted": "4:00 PM",
    "break_start_formatted": "2:30 PM",
    "break_end_formatted": "2:45 PM"
  }
}
```

## Inventory Endpoints

| Endpoint | Method | Description | Authentication Required | Roles |
|----------|--------|-------------|------------------------|-------|
| `/api/inventory` | GET | Get all inventory items | Yes | admin, staff, barista |
| `/api/inventory/categories` | GET | Get inventory categories | Yes | admin, staff, barista |
| `/api/inventory/low-stock` | GET | Get low stock items | Yes | admin, staff, barista |
| `/api/inventory/<item_id>` | GET | Get specific inventory item | Yes | admin, staff, barista |
| `/api/inventory/<item_id>` | PUT | Update inventory item | Yes | admin, staff |
| `/api/inventory/<item_id>` | DELETE | Delete inventory item | Yes | admin, staff |
| `/api/inventory/<item_id>/adjust` | POST | Adjust inventory quantity | Yes | admin, staff, barista |
| `/api/inventory/<item_id>/report-low` | POST | Report item as low in stock | Yes | admin, staff, barista |
| `/api/inventory/restock-request` | POST | Create a restock request | Yes | admin, staff, barista |
| `/api/inventory/restock-requests` | GET | Get list of restock requests | Yes | admin, staff |
| `/api/inventory/restock-requests/<restock_id>` | GET | Get details of a specific restock request | Yes | admin, staff |
| `/api/inventory/restock-requests/<restock_id>/complete` | POST | Complete a restock request | Yes | admin, staff |
| `/api/inventory` | POST | Create new inventory item | Yes | admin, staff |

### Low Stock Reporting

```
POST /api/inventory/123/report-low
{
  "urgency": "high",
  "notes": "Need to reorder as soon as possible"
}
```

Urgency levels: `low`, `normal`, `high`, `critical`

Response:
```json
{
  "success": true,
  "message": "Low stock report created successfully",
  "alert_id": 5,
  "item": {
    "id": 123,
    "name": "Almond Milk",
    "category": "milk",
    "amount": 0.8,
    "unit": "L",
    "capacity": 5.0,
    "minimum_threshold": 1.0,
    "status": "warning"
  }
}
```

### Restock Requests

#### Create Restock Request

```
POST /api/inventory/restock-request
{
  "items": [
    {"id": 1, "quantity": 10},
    {"id": 2, "quantity": 5}
  ],
  "notes": "Needed for next week's event"
}
```

Response:
```json
{
  "success": true,
  "message": "Restock request created successfully",
  "restock_request": {
    "id": 12,
    "status": "pending",
    "notes": "Needed for next week's event",
    "created_at_formatted": "2023-01-15 09:30:00",
    "created_by": 5,
    "created_by_name": "staff_user",
    "items": [
      {
        "id": 15,
        "restock_id": 12,
        "item_id": 1,
        "requested_amount": 10.0,
        "status": "pending",
        "item_name": "Full Cream Milk",
        "category": "milk",
        "unit": "L"
      },
      {
        "id": 16,
        "restock_id": 12,
        "item_id": 2,
        "requested_amount": 5.0,
        "status": "pending",
        "item_name": "Regular Cups",
        "category": "cups",
        "unit": ""
      }
    ]
  }
}
```

#### List Restock Requests

```
GET /api/inventory/restock-requests?status=pending&limit=10&offset=0
```

Query parameters:
- `status`: Filter by status (pending, completed, cancelled)
- `limit`: Maximum number of requests to return (default: 50)
- `offset`: Number of requests to skip for pagination (default: 0)

Response:
```json
{
  "success": true,
  "count": 2,
  "total": 15,
  "restock_requests": [
    {
      "id": 12,
      "status": "pending",
      "notes": "Needed for next week's event",
      "created_at_formatted": "2023-01-15 09:30:00",
      "created_by_name": "staff_user",
      "item_count": 2
    },
    {
      "id": 11,
      "status": "pending",
      "notes": "Regular restock",
      "created_at_formatted": "2023-01-14 14:45:00",
      "created_by_name": "barista_user",
      "item_count": 3
    }
  ],
  "pagination": {
    "limit": 10,
    "offset": 0,
    "has_more": true
  }
}
```

#### Get Restock Request Details

```
GET /api/inventory/restock-requests/12
```

Response:
```json
{
  "success": true,
  "restock_request": {
    "id": 12,
    "status": "pending",
    "notes": "Needed for next week's event",
    "created_at_formatted": "2023-01-15 09:30:00",
    "created_by": 5,
    "created_by_name": "staff_user",
    "items": [
      {
        "id": 15,
        "restock_id": 12,
        "item_id": 1,
        "requested_amount": 10.0,
        "received_amount": null,
        "status": "pending",
        "item_name": "Full Cream Milk",
        "category": "milk",
        "unit": "L",
        "current_amount": 2.5
      },
      {
        "id": 16,
        "restock_id": 12,
        "item_id": 2,
        "requested_amount": 5.0,
        "received_amount": null,
        "status": "pending",
        "item_name": "Regular Cups",
        "category": "cups",
        "unit": "",
        "current_amount": 15
      }
    ]
  }
}
```

#### Complete Restock Request

```
POST /api/inventory/restock-requests/12/complete
{
  "items": [
    {
      "id": 1,
      "received_amount": 8.0,
      "notes": "Only received 8 out of 10"
    },
    {
      "id": 2,
      "received_amount": 5.0
    }
  ],
  "notes": "Partially fulfilled - vendor was out of stock on milk"
}
```

Response:
```json
{
  "success": true,
  "message": "Restock request completed successfully",
  "restock_request": {
    "id": 12,
    "status": "completed",
    "notes": "Partially fulfilled - vendor was out of stock on milk",
    "created_at_formatted": "2023-01-15 09:30:00",
    "completed_at_formatted": "2023-01-16 10:15:00",
    "created_by": 5,
    "created_by_name": "staff_user",
    "completed_by": 3,
    "completed_by_name": "admin_user",
    "items": [
      {
        "id": 15,
        "restock_id": 12,
        "item_id": 1,
        "requested_amount": 10.0,
        "received_amount": 8.0,
        "notes": "Only received 8 out of 10",
        "status": "completed",
        "item_name": "Full Cream Milk",
        "category": "milk",
        "unit": "L",
        "current_amount": 10.5
      },
      {
        "id": 16,
        "restock_id": 12,
        "item_id": 2,
        "requested_amount": 5.0,
        "received_amount": 5.0,
        "status": "completed",
        "item_name": "Regular Cups",
        "category": "cups",
        "unit": "",
        "current_amount": 20
      }
    ]
  }
}
```

## User Role Permissions

| Role | Permissions |
|------|-------------|
| admin | All operations |
| staff | Manage orders, stations, settings |
| barista | Process orders, send messages |
| customer | View own orders only |

## API Versioning

This API does not use explicit versioning in the URL. Instead, it follows a compatibility-first approach where existing endpoints maintain backward compatibility while new features may be added.