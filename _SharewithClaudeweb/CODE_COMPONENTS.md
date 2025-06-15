# Expresso Code Components

This document outlines the key code components and their relationships for the Expresso coffee ordering system.

## Frontend Services

### OrderDataService (OrderDataService.js)

A singleton service responsible for:
- Retrieving order data from backend API
- Managing order state (pending, in-progress, completed)
- Processing orders (start, complete, etc.)
- Handling batch operations
- Sending customer notifications
- Providing fallback mechanisms when API connectivity fails

Key methods:
- `getPendingOrders()` - Gets pending orders from API
- `getInProgressOrders(stationId)` - Gets in-progress orders for a station
- `getCompletedOrders(stationId)` - Gets completed orders for a station
- `startOrder(order)` - Marks an order as in-progress
- `completeOrder(orderId)` - Marks an order as completed
- `sendMessageToCustomer(orderId, message)` - Sends SMS to customer
- `sendReadyNotification(order)` - Sends notification when order is ready
- `_processOrders(orders)` - Internal method to format order data

### MessageService (MessageService.js)

A singleton service responsible for:
- Sending SMS messages to customers
- Maintaining history of sent messages
- Managing notification settings
- Providing templates for messages

Key methods:
- `sendMessage(order, messageText)` - Sends general message to customer
- `sendReadyNotification(order)` - Sends notification when order is ready
- `sendReminderNotification(order, waitMinutes)` - Sends reminder for uncollected orders
- `showOnDisplay(order)` - Shows order on display screen
- `updateSettings(newSettings)` - Updates notification settings

## Frontend Components

### BaristaInterface (BaristaInterface.js)

The main UI component for baristas to manage orders. Responsible for:
- Displaying pending, in-progress, and completed orders
- Processing orders
- Managing station selection
- Handling customer notifications
- Managing stock and inventory
- Viewing schedule and history

Key methods:
- `handleCompleteOrder(orderId)` - Completes an order with notifications
- `handleSendMessage(orderId, message)` - Sends message to customer
- `handleWalkInOrder(orderDetails)` - Adds a walk-in order
- `renderInProgressOrder(order)` - Renders in-progress order UI
- `renderCompletedOrder(order)` - Renders completed order UI

### Other Components

- `PendingOrdersSection` - Displays and manages pending orders
- `StationChat` - Chat interface for communication between stations
- `NotificationSystem` - Handles in-app notifications
- `OrderNotificationHandler` - Processes order notifications

## Backend Services

### Order API (Flask)

Endpoints:
- `GET /api/orders/pending` - Gets pending orders
- `GET /api/orders/in-progress` - Gets in-progress orders
- `GET /api/orders/completed` - Gets completed orders
- `POST /api/orders/{id}/start` - Starts an order
- `POST /api/orders/{id}/complete` - Completes an order
- `POST /api/orders/{id}/pickup` - Marks order as picked up
- `POST /api/orders/{id}/message` - Sends message for an order

### SMS API (Flask + Twilio)

Endpoints:
- `POST /api/sms/send` - Sends an SMS message
- `POST /api/sms/send-test` - Sends a test SMS message
- `GET /api/sms/templates` - Gets SMS message templates

## Data Flow

1. **Order Creation**:
   - Customer places order → Backend API → Order added to database
   - Frontend polls API → OrderDataService → Pending order displayed in BaristaInterface

2. **Order Processing**:
   - Barista starts order → BaristaInterface → OrderDataService.startOrder() → Backend API
   - Barista completes order → BaristaInterface.handleCompleteOrder() → OrderDataService.completeOrder() → Backend API
   - BaristaInterface.handleCompleteOrder() → Notification system (multiple fallbacks)

3. **Customer Notification**:
   - When order completed → handleCompleteOrder() → Several notification attempts:
     1. OrderNotificationHandler.completeWithNotification()
     2. MessageService.sendReadyNotification()
     3. OrderDataService.sendReadyNotification()
     4. OrderDataService.sendMessageToCustomer() as last resort

## Authentication and Authorization

- JWT-based authentication
- Tokens stored in localStorage and included in API requests
- Role-based access to different interfaces and operations