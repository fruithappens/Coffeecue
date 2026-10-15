# Expresso Coffee Ordering System - Complete Documentation

## Table of Contents
1. [System Overview](#system-overview)
2. [Architecture](#architecture)
3. [Key Features](#key-features)
4. [Technology Stack](#technology-stack)
5. [File Structure](#file-structure)
6. [Core Components](#core-components)
7. [API Endpoints](#api-endpoints)
8. [Database Schema](#database-schema)
9. [Authentication & Security](#authentication--security)
10. [SMS Integration](#sms-integration)
11. [Real-time Features](#real-time-features)
12. [Frontend Components](#frontend-components)
13. [Development Guide](#development-guide)
14. [Testing](#testing)
15. [Deployment](#deployment)

---

## System Overview

Expresso is a comprehensive coffee ordering system designed for events and conferences. It enables attendees to order coffee via SMS, track their orders in real-time, and helps baristas manage orders efficiently across multiple stations.

### Key User Roles
1. **Customers** - Order via SMS, track orders via QR codes
2. **Baristas** - Process orders at coffee stations
3. **Organizers** - Manage event settings, view analytics
4. **Support Staff** - Monitor system health, manage operations
5. **Admin** - Full system configuration and management

### Core Workflow
1. Customer sends SMS with coffee order (e.g., "large oat latte 1 sugar")
2. System parses order, assigns to optimal station based on capabilities
3. Barista sees order on their interface, prepares coffee
4. Customer receives SMS when order is ready with pickup location
5. Real-time updates throughout the process

---

## Architecture

### Backend (Flask/Python)
```
├── app.py                 # Main Flask application
├── run_server.py          # Server runner with auto-reload
├── auth.py                # JWT authentication setup
├── config.py              # Configuration management
├── models/                # Database models
│   ├── orders.py          # Order model
│   ├── stations.py        # Station model
│   ├── users.py           # User & settings models
│   └── inventory.py       # Stock management
├── routes/                # API endpoints
│   ├── consolidated_api_routes.py  # Main API routes
│   ├── sms_routes.py      # Twilio SMS webhook
│   ├── auth_routes.py     # Authentication
│   ├── websocket_routes.py # Real-time updates
│   └── settings_api_routes.py # Settings management
├── services/              # Business logic
│   ├── coffee_system.py   # Core order processing
│   ├── nlp.py            # Natural language parsing
│   ├── messaging.py       # SMS handling
│   └── websocket.py      # WebSocket service
└── utils/                 # Utilities
    ├── database.py        # Database connections
    └── helpers.py         # Helper functions
```

### Frontend (React)
```
Barista Front End/
├── src/
│   ├── App.js             # Main React app
│   ├── components/        # UI components
│   │   ├── BaristaInterface.js    # Main barista view
│   │   ├── OrganiserInterface.js  # Event organizer view
│   │   ├── SupportInterface.js    # Support dashboard
│   │   ├── auth/          # Authentication components
│   │   └── barista-tabs/  # Tab components
│   ├── services/          # API & data services
│   │   ├── ApiService.js  # HTTP client with auth
│   │   ├── OrderDataService.js # Order management
│   │   ├── AuthService.js # Authentication
│   │   └── WebSocketService.js # Real-time updates
│   ├── hooks/             # Custom React hooks
│   │   ├── useOrders.js   # Order state management
│   │   ├── useStations.js # Station management
│   │   └── useAuth.js     # Authentication hook
│   └── config/            # Configuration
│       └── apiConfig.js   # API endpoints
```

---

## Key Features

### 1. Smart SMS Ordering
- Natural language processing for order parsing
- Supports abbreviations (e.g., "cap" → "cappuccino")
- Dynamic menu based on available stock and station capabilities
- Group ordering support
- Order modification and cancellation

### 2. Intelligent Station Assignment
- Load balancing across stations
- Capability-based routing (e.g., only Station 2 has oat milk)
- VIP order prioritization
- Real-time queue management
- Automatic wait time calculation

### 3. Real-time Updates
- WebSocket connections for instant updates
- Order status changes broadcast to all interfaces
- Station availability updates
- Live analytics dashboard

### 4. Offline Support
- Frontend caches data for offline operation
- Graceful degradation when backend unavailable
- Queue for pending operations
- Automatic sync when connection restored

### 5. Multi-interface System
- **Barista Interface**: Order processing, station management
- **Organizer Interface**: Event settings, analytics, user management
- **Support Interface**: System monitoring, real-time operations
- **Display Screens**: Public order status displays
- **Mobile Web**: Order tracking via QR codes

---

## Technology Stack

### Backend
- **Framework**: Flask 2.3.3
- **Database**: PostgreSQL (primary), SQLite (development)
- **Authentication**: Flask-JWT-Extended
- **WebSockets**: Flask-SocketIO
- **SMS**: Twilio API
- **Task Queue**: Background jobs for SMS processing

### Frontend
- **Framework**: React 18.2
- **State Management**: React Context + Custom Hooks
- **Styling**: Tailwind CSS v3
- **Real-time**: Socket.IO Client
- **HTTP Client**: Axios (via custom ApiService)
- **Build Tool**: Create React App

### Infrastructure
- **Development**: ngrok for SMS webhook testing
- **Production**: Deployable to Heroku, AWS, or VPS
- **Monitoring**: Built-in error tracking and analytics

---

## Core Components

### 1. Coffee System (services/coffee_system.py)
Central service handling:
- SMS conversation state management
- Order processing and validation
- Station assignment logic
- Natural language understanding
- Customer preferences tracking

### 2. Order Data Service (OrderDataService.js)
Frontend service managing:
- Order CRUD operations
- Real-time order updates
- Offline data caching
- API communication

### 3. Authentication System
- JWT tokens with refresh mechanism
- Role-based access control (RBAC)
- Session management
- Secure password hashing

### 4. Station Management
- Dynamic capability configuration
- Real-time load monitoring
- Milk type availability tracking
- Staff assignment

---

## API Endpoints

### Authentication
- `POST /api/auth/login` - User login
- `POST /api/auth/refresh` - Refresh JWT token
- `POST /api/auth/logout` - Logout user

### Orders
- `GET /api/orders` - List all orders
- `GET /api/orders/pending` - Pending orders by station
- `GET /api/orders/in-progress` - Active orders
- `POST /api/orders` - Create new order
- `PUT /api/orders/:id/status` - Update order status
- `PUT /api/orders/:id/claim` - Barista claims order

### Stations
- `GET /api/stations` - List all stations
- `GET /api/stations/:id` - Station details
- `PUT /api/stations/:id` - Update station
- `GET /api/stations/:id/orders` - Station's orders

### Settings
- `GET /api/settings` - Get all settings
- `PUT /api/settings` - Update settings
- `PUT /api/settings/wait-time` - Update wait times
- `PUT /api/settings/milk-colors` - Configure milk colors

### SMS
- `POST /sms` - Twilio webhook for incoming SMS
- `POST /api/sms/send` - Send SMS message
- `GET /api/sms/history` - SMS conversation history

---

## Database Schema

### Core Tables

#### orders
```sql
- id (SERIAL PRIMARY KEY)
- order_number (VARCHAR UNIQUE)
- phone (VARCHAR)
- customer_name (VARCHAR)
- order_details (JSONB) -- {type, milk, size, sugar, notes}
- status (VARCHAR) -- pending, in_progress, ready, completed
- station_id (INTEGER)
- barista_id (INTEGER)
- created_at (TIMESTAMP)
- completed_at (TIMESTAMP)
```

#### stations
```sql
- id (SERIAL PRIMARY KEY)
- name (VARCHAR)
- location (VARCHAR)
- capabilities (JSONB) -- {coffee_types[], milk_types[], capacity}
- current_status (VARCHAR) -- active, inactive, maintenance
- created_at (TIMESTAMP)
```

#### users
```sql
- id (SERIAL PRIMARY KEY)
- username (VARCHAR UNIQUE)
- email (VARCHAR)
- password_hash (VARCHAR)
- role (VARCHAR) -- admin, organizer, barista, support
- full_name (VARCHAR)
- created_at (TIMESTAMP)
- last_login (TIMESTAMP)
```

#### customer_preferences
```sql
- id (SERIAL PRIMARY KEY)
- phone (VARCHAR)
- name (VARCHAR)
- preferred_drink (VARCHAR)
- preferred_milk (VARCHAR)
- preferred_size (VARCHAR)
- preferred_sugar (VARCHAR)
- total_orders (INTEGER)
- last_order_date (TIMESTAMP)
```

---

## SMS Integration

### Conversation Flow
1. **Welcome**: "Welcome to ANZCA ASM 2025! ☕ What's your first name?"
2. **Order Prompt**: "Hi Steve! What are the details for your coffee?"
3. **Smart Parsing**: Handles natural language like "oat latte 1 sugar"
4. **Confirmation**: Shows order details, identifies unique station assignments
5. **Group Orders**: Support for ordering for friends
6. **Status Updates**: Real-time SMS notifications

### Commands
- `STATUS` - Check order status
- `CANCEL` - Cancel pending order
- `OPTIONS` or `MENU` - View available options
- `USUAL` - Order usual coffee
- `FRIEND` - Add order for friend

### Smart Features
- Detects station mentions in messages
- Validates against available inventory
- Handles misspellings and abbreviations
- Maintains conversation context

---

## Real-time Features

### WebSocket Events
- `order_created` - New order placed
- `order_updated` - Status change
- `station_updated` - Station status/capability change
- `settings_updated` - Configuration changes
- `notification` - System notifications

### Implementation
```javascript
// Frontend connection
const socket = io(WS_URL, {
  auth: { token: localStorage.getItem('token') }
});

socket.on('order_created', (order) => {
  // Update UI with new order
});
```

---

## Frontend Components

### Key Components

#### BaristaInterface
- Order queue management
- Drag-and-drop order claiming
- Station switching
- Real-time order updates
- Quick actions (complete, cancel)

#### OrganiserInterface
- Event configuration
- User management
- Analytics dashboard
- Station management
- SMS template configuration

#### SupportInterface
- System health monitoring
- Real-time operations dashboard
- Error tracking
- Performance analytics
- Communication hub

### Custom Hooks
- `useOrders` - Order state management with real-time updates
- `useStations` - Station data and management
- `useAuth` - Authentication state and methods
- `useSettings` - System settings management
- `useWebSocket` - WebSocket connection management

---

## Development Guide

### Setup
```bash
# Backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python pg_init.py
python create_admin.py
python run_server.py

# Frontend
cd "Barista Front End"
npm install
npm start

# Full system
./start_expresso.sh  # macOS script to start everything
```

### Key Development Patterns

#### API Service Pattern
```javascript
class OrderDataService {
  constructor() {
    this.apiService = ApiService; // Singleton
    this.cache = new Map();
  }
  
  async getOrders() {
    try {
      const response = await this.apiService.get('/orders');
      this.updateCache(response.data);
      return response.data;
    } catch (error) {
      return this.getCachedData('orders');
    }
  }
}
```

#### Hook Pattern
```javascript
function useOrders() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    const unsubscribe = OrderDataService.subscribe((data) => {
      setOrders(data);
    });
    
    return unsubscribe;
  }, []);
  
  return { orders, loading };
}
```

---

## Testing

### Test Structure
```
tests/
├── backend/
│   ├── test_sms_integration.py
│   ├── test_auth_flow.py
│   ├── test_order_processing.py
│   └── test_station_assignment.py
├── frontend/
│   ├── components/
│   └── services/
└── e2e/
    └── cypress/
```

### Running Tests
```bash
# Backend tests
python -m pytest tests/

# Frontend tests
npm test

# E2E tests
npm run cypress:open
```

---

## Deployment

### Environment Variables
```
# Backend
DATABASE_URL=postgresql://user:pass@host/db
JWT_SECRET_KEY=your-secret-key
TWILIO_ACCOUNT_SID=your-sid
TWILIO_AUTH_TOKEN=your-token
TWILIO_PHONE_NUMBER=+1234567890

# Frontend
REACT_APP_API_URL=https://api.example.com
REACT_APP_WS_URL=wss://api.example.com
```

### Production Considerations
1. Use PostgreSQL for production
2. Enable SSL for all connections
3. Configure proper CORS settings
4. Set up monitoring and logging
5. Implement rate limiting
6. Regular database backups
7. Load balancer for multiple instances

---

## Support Interface Development Direction

The Support Interface should focus on:

### 1. Real-time Monitoring
- System health dashboard
- Active order tracking
- Station performance metrics
- Error rate monitoring
- API response times

### 2. Operational Tools
- Bulk order management
- Station reassignment
- Manual order creation
- Emergency broadcasts
- System maintenance mode

### 3. Analytics & Reporting
- Order volume trends
- Popular items analysis
- Peak time identification
- Station efficiency metrics
- Customer satisfaction tracking

### 4. Communication Hub
- Inter-station messaging
- Customer support chat
- Announcement system
- Issue tracking
- Staff coordination

### 5. Advanced Features
- Predictive analytics for wait times
- Automated issue detection
- Performance optimization suggestions
- Capacity planning tools
- Integration with external systems

---

## Future Enhancements

1. **Mobile Apps**: Native iOS/Android barista apps
2. **Payment Integration**: Stripe/Square for prepayment
3. **Loyalty Program**: Points and rewards system
4. **Multi-venue Support**: Chain management
5. **AI Improvements**: Better order prediction and routing
6. **Voice Ordering**: Phone call integration
7. **Kitchen Display System**: For food items
8. **Inventory Automation**: Automatic reordering
9. **Customer App**: Direct ordering without SMS
10. **Analytics API**: External reporting tools

---

## Conclusion

Expresso is a robust, scalable coffee ordering system with real-time capabilities, intelligent routing, and comprehensive management tools. The modular architecture allows for easy extension and customization for different event types and scales.