# Expresso Technical Architecture

## System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                           CLIENTS                                     │
├─────────────────┬─────────────────┬─────────────────┬──────────────┤
│   SMS (Twilio)  │  Web Browser    │  Display Screen │  Mobile Web  │
└────────┬────────┴────────┬────────┴────────┬────────┴──────┬───────┘
         │                 │                 │                │
         ▼                 ▼                 ▼                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        LOAD BALANCER / NGINX                         │
└─────────────────────────────┬───────────────────────────────────────┘
                             │
         ┌───────────────────┴───────────────────┐
         │                                       │
         ▼                                       ▼
┌──────────────────────┐               ┌──────────────────────┐
│   Flask Backend      │               │   React Frontend     │
├──────────────────────┤               ├──────────────────────┤
│ • REST API           │               │ • SPA Application    │
│ • WebSocket Server   │               │ • Service Workers    │
│ • JWT Auth           │               │ • Local Storage      │
│ • SMS Processing     │               │ • WebSocket Client   │
└──────────┬───────────┘               └──────────────────────┘
           │
           ▼
┌──────────────────────┐
│     PostgreSQL       │
├──────────────────────┤
│ • Orders             │
│ • Stations           │
│ • Users              │
│ • Settings           │
│ • Inventory          │
└──────────────────────┘
```

## Data Flow Patterns

### 1. SMS Order Flow
```
Customer Phone → Twilio → POST /sms → Coffee System Service
                                    ↓
                              NLP Processing
                                    ↓
                            Station Assignment
                                    ↓
                              Create Order
                                    ↓
                         WebSocket Broadcast → All Clients
                                    ↓
                            SMS Response → Twilio → Customer
```

### 2. Real-time Update Flow
```
Order Status Change → Database Update → WebSocket Event
                                     ↓
                    ┌────────────────┼────────────────┐
                    ▼                ▼                ▼
            Barista Interface  Display Screen  Support Dashboard
```

### 3. Authentication Flow
```
Login Request → Validate Credentials → Generate JWT
                                    ↓
                            Return Access + Refresh Token
                                    ↓
                        Client Stores in localStorage
                                    ↓
                    All API Requests Include Bearer Token
                                    ↓
                        Token Refresh Before Expiry
```

## Service Architecture

### Backend Services

#### 1. Coffee System Service (Singleton)
```python
class CoffeeOrderSystem:
    def __init__(self, db, config):
        self.db = db
        self.nlp = NLPService()
        self.conversation_states = {}  # Phone -> State
        
    def handle_sms(self, phone, message, messaging_service):
        # Stateful conversation management
        # Smart order parsing and routing
        # Station assignment logic
```

#### 2. Messaging Service
```python
class MessagingService:
    def __init__(self, config):
        self.twilio_client = Client(sid, token)
        self.phone_number = config['TWILIO_PHONE']
        
    def send_message(self, to, body):
        # Send SMS via Twilio
        # Handle delivery status
```

#### 3. WebSocket Service
```python
@socketio.on('connect')
def handle_connect(auth):
    # Verify JWT token
    # Join appropriate rooms
    # Send initial state
    
@socketio.on('order_update')
def handle_order_update(data):
    # Broadcast to relevant clients
    # Update database
```

### Frontend Services

#### 1. API Service (Singleton)
```javascript
class ApiService {
  constructor() {
    if (ApiService.instance) {
      return ApiService.instance;
    }
    this.baseUrl = '/api';
    this.token = localStorage.getItem('token');
    this.setupInterceptors();
    ApiService.instance = this;
  }
  
  async request(endpoint, options = {}) {
    // Add auth header
    // Handle token refresh
    // Implement retry logic
    // Fallback to cache on failure
  }
}
```

#### 2. Order Data Service
```javascript
class OrderDataService {
  constructor() {
    this.apiService = ApiService;
    this.cache = new Map();
    this.subscribers = new Set();
  }
  
  subscribeToUpdates(callback) {
    // Real-time order updates
    // WebSocket integration
    // Cache management
  }
}
```

#### 3. WebSocket Service
```javascript
class WebSocketService {
  constructor() {
    this.socket = io(WS_URL, {
      auth: { token: this.getToken() }
    });
    this.setupEventHandlers();
  }
  
  on(event, callback) {
    this.socket.on(event, callback);
  }
}
```

## Database Design

### Normalized Schema
```sql
-- Core entities
orders (id, order_number, phone, status, station_id, ...)
stations (id, name, capabilities, current_status, ...)
users (id, username, email, role, password_hash, ...)

-- Relationships
station_staff (station_id, user_id, assigned_at)
order_items (order_id, item_type, modifications)
station_capabilities (station_id, capability_type, capability_value)

-- Tracking tables
order_status_history (order_id, status, changed_at, changed_by)
sms_messages (id, phone, message, direction, processed)
system_logs (id, level, message, context, created_at)
```

### JSONB Usage
```sql
-- Flexible data storage
order_details JSONB -- {type, milk, size, sugar, temp, notes}
station_capabilities JSONB -- {coffee_types: [], milk_types: []}
user_preferences JSONB -- {theme, notifications, shortcuts}
system_settings JSONB -- Complex nested configuration
```

## State Management

### Frontend State Architecture
```javascript
// Global App Context
AppContext = {
  user: { id, name, role, token },
  theme: 'light',
  connectionStatus: 'online',
  notifications: []
}

// Feature-specific Hooks
useOrders() → { orders, loading, error, actions }
useStations() → { stations, updateStation, getStationOrders }
useSettings() → { settings, updateSetting, resetSettings }

// Local Component State
useState() → UI state (modals, forms, selections)
```

### Backend State Management
```python
# Application State
app.config['coffee_system'] = CoffeeOrderSystem(db, config)
app.config['messaging_service'] = MessagingService(config)
app.config['socketio'] = SocketIO(app)

# Request Context
g.current_user = get_jwt_identity()
g.db = get_db_connection()

# Conversation State (Persistent)
conversation_states[phone] = {
    'state': 'awaiting_coffee_type',
    'temp_data': {'name': 'Steve', 'order_details': {...}}
}
```

## Security Architecture

### Authentication Layers
1. **JWT Tokens**
   - Access Token: 15 minutes expiry
   - Refresh Token: 7 days expiry
   - Signed with HS256 algorithm

2. **Role-Based Access Control**
   ```python
   @role_required(['admin', 'organizer'])
   def sensitive_endpoint():
       # Only admin and organizer can access
   ```

3. **API Security**
   - CORS configuration
   - Rate limiting
   - Input validation
   - SQL injection prevention
   - XSS protection

### Data Security
- Passwords: bcrypt hashing
- Sensitive data: Encrypted at rest
- PII: Minimal storage, quick purge
- Audit logs: All critical actions

## Performance Optimization

### Backend Optimizations
1. **Database**
   - Connection pooling
   - Indexed queries
   - Materialized views for analytics
   - Query optimization

2. **Caching**
   - Redis for session storage
   - In-memory cache for settings
   - Query result caching

3. **Async Processing**
   - Background jobs for SMS
   - Async WebSocket broadcasts
   - Deferred analytics calculation

### Frontend Optimizations
1. **Code Splitting**
   - Lazy loading routes
   - Dynamic imports
   - Tree shaking

2. **Data Management**
   - Virtual scrolling for long lists
   - Debounced API calls
   - Optimistic UI updates
   - Progressive data loading

3. **Caching Strategy**
   - Service Worker caching
   - localStorage for offline
   - Memory cache for active data

## Scalability Considerations

### Horizontal Scaling
```
                    Load Balancer
                         │
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
     Flask App #1   Flask App #2   Flask App #3
          │              │              │
          └──────────────┼──────────────┘
                         ▼
                 PostgreSQL Primary
                         │
                    Read Replicas
```

### Microservices Future
- SMS Service (separate service)
- Analytics Service (data warehouse)
- Notification Service (multi-channel)
- Payment Service (when added)

## Monitoring & Observability

### Application Monitoring
```python
# Custom metrics
order_processing_time = Histogram('order_processing_seconds')
active_orders = Gauge('active_orders_count')
sms_sent = Counter('sms_messages_sent')

# Health checks
@app.route('/health')
def health_check():
    return {
        'status': 'healthy',
        'database': check_db(),
        'cache': check_cache(),
        'sms': check_twilio()
    }
```

### Logging Strategy
```python
# Structured logging
logger.info('Order created', extra={
    'order_id': order_id,
    'customer': phone,
    'station': station_id,
    'processing_time': time_taken
})

# Log aggregation
- Application logs → CloudWatch/ELK
- Access logs → Nginx logs
- Error tracking → Sentry/Rollbar
```

## Development Workflow

### Git Branch Strategy
```
main
  ├── develop
  │     ├── feature/sms-improvements
  │     ├── feature/support-dashboard
  │     └── bugfix/websocket-auth
  └── release/v1.2.0
```

### CI/CD Pipeline
1. **Development**
   - Local development
   - Unit tests
   - Integration tests

2. **Staging**
   - Automated deployment
   - E2E tests
   - Performance tests

3. **Production**
   - Blue-green deployment
   - Database migrations
   - Feature flags

## Technology Decisions & Rationale

### Why Flask?
- Lightweight and flexible
- Excellent ecosystem
- Easy WebSocket integration
- Simple deployment

### Why React?
- Component reusability
- Strong ecosystem
- Good offline support
- Fast development

### Why PostgreSQL?
- JSONB support
- ACID compliance
- Advanced queries
- Scalability

### Why Twilio?
- Reliable SMS delivery
- Good API
- Global coverage
- Webhook support

## Future Architecture Evolution

### Phase 1 (Current)
- Monolithic backend
- Single database
- Server-side sessions

### Phase 2 (6 months)
- API Gateway
- Microservices extraction
- Redis caching layer
- CDN for static assets

### Phase 3 (1 year)
- Event-driven architecture
- Message queue (RabbitMQ/Kafka)
- GraphQL API
- Kubernetes deployment

### Phase 4 (2 years)
- Multi-region deployment
- Data lake for analytics
- ML-powered predictions
- Native mobile apps