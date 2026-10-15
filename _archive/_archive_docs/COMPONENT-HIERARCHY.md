# Expresso Coffee Ordering System - Component Hierarchy Map

## 1. Application Structure

```
App (App.js)
├── AppContext (AppContext.js) - Application state management
└── AppRouter (AppRouter.js) - Routing and authentication logic
    ├── LoginPage - Authentication entry point
    ├── LandingPage - Role selection interface
    ├── BaristaInterface - Interface for baristas to manage orders
    ├── OrganiserInterface - Interface for admin/organizers
    ├── SupportInterface - Technical support interface
    └── DisplayScreen - Public order status display
```

## 2. Component Hierarchy

### Authentication Components
```
LoginPage
└── AuthService - JWT authentication service
```

### Landing Page Components
```
LandingPage
├── Role Selection Interface
    ├── Barista Role Card
    ├── Organiser Role Card
    ├── Support Role Card
    └── Display Screen Card
```

### Barista Interface Components
```
BaristaInterface
├── ApiNotificationBanner - API connection status
├── SystemModeToggle - Switch between production and demo mode
├── StationCapabilities - Station information
├── OrderManagement
│   ├── PendingOrdersSection - Orders waiting to be made
│   │   ├── RegularOrdersList
│   │   ├── VipOrdersList
│   │   └── BatchGroupsList - Orders that can be made together
│   ├── CurrentOrderSection - Currently in-progress order
│   │   └── InProgressOrder
│   └── StockManagementSection - Inventory management
├── Communication
│   ├── StationChat - Communication between baristas
│   ├── MessageHistory - Past messages
│   └── OrderNotificationHandler - SMS notifications
├── Settings
│   ├── SMSSettingsPanel
│   ├── MilkColorSettings
│   └── SessionControlPanel
└── Utilities
    ├── ApiDebugPanel - Troubleshooting tools
    └── Tooltip - UI helper component
```

### Organiser Interface Components
```
OrganiserInterface
├── Dashboard - Statistics and overview
├── StationManagement
│   ├── StationManagementPanel
│   ├── StationLoadBalancer - Distribute orders across stations
│   └── StockManagementSection - Inventory management
├── OrderManagement
│   └── GroupOrdersTab - Manage group/batch orders
├── UserManagement - Staff and user controls
├── ScheduleManagement - Staff scheduling
├── MessageCenter - Communication hub
└── Settings - System configuration
```

### Support Interface Components
```
SupportInterface
├── SupportApiNotificationBanner
├── ApiDebugPanel - Technical diagnostics
└── SystemMonitoring
```

### Display Screen Components
```
DisplayScreen
├── DisplaySelector - Choose display mode
└── OrderStatusDisplay - Public-facing order status
```

## 3. Service Layer

The service layer facilitates communication between frontend components and backend API endpoints:

```
Services
├── ApiService - Base HTTP client with authentication
├── AuthService - Login, token management
├── OrderDataService - Order operations
├── StationsService - Station management
├── StockService - Inventory management
├── ScheduleService - Staff scheduling
├── SettingsService - System settings
├── MessageService - Communication
├── ChatService - Staff messaging
└── ServiceFactory - Service configuration
```

## 4. Context and Hooks

```
Context
└── AppContext - Global application state
    └── APP_MODES - Production vs Demo mode

Hooks
├── useAuth - Authentication state
├── useOrders - Order management
├── useStations - Station management
├── useStock - Inventory management
├── useSchedule - Scheduling
├── useSettings - System configuration
└── useMessages - Communication
```

## 5. Utility Components

```
Utilities
├── frontend-auth.js - Authentication helpers
├── milkConfig.js - Milk type configuration
├── orderUtils.js - Order processing helpers
└── qrCodeUtils.js - QR code generation
```