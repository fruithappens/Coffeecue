# Support Interface - Detailed Implementation Plan

## Overview
The Support Interface should be the mission control center for managing all aspects of the Expresso system, from real-time monitoring to emergency interventions.

## Proposed Tab Structure

### 1. **Dashboard** (Home)
Real-time system overview with critical metrics and alerts

### 2. **Operations**
Live order management and station control

### 3. **System Health**
Deep monitoring of all system components

### 4. **Communications**
SMS/Twilio management and customer support

### 5. **Users & Access**
User management, permissions, and security

### 6. **Configuration**
System settings, branding, and customization

### 7. **Diagnostics**
Troubleshooting tools and system logs

### 8. **Emergency**
Quick actions for critical situations

---

## Detailed Features by Tab

### 1. Dashboard Tab
```
┌─────────────────────────────────────────────────────────────┐
│ System Status: ● Online  | Orders Today: 1,247 | Uptime: 99.8% │
├─────────────────────────────────────────────────────────────┤
│ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────┐ │
│ │ Active Orders│ │Avg Wait Time │ │ Error Rate  │ │ Revenue │ │
│ │     127     │ │   8.5 min    │ │   0.02%     │ │ $4,231  │ │
│ └─────────────┘ └─────────────┘ └─────────────┘ └─────────┘ │
│                                                              │
│ Recent Alerts ▼                     Quick Actions ▼          │
│ ⚠ Station 3 offline (2m ago)       🔴 Pause All Orders      │
│ ⚠ High queue at Station 1          📢 Broadcast Message     │
│ ✓ Backup completed                  🔄 Restart Services      │
└─────────────────────────────────────────────────────────────┘
```

**Features:**
- Real-time metrics dashboard
- System health indicators
- Active alerts with severity
- Quick action buttons
- Live order flow visualization
- Performance graphs (last hour)

### 2. Operations Tab

#### Sub-tabs:
- **Order Management**
  - Live order grid with filters
  - Bulk selection and actions
  - Manual order creation
  - Order history search
  - Export capabilities

- **Station Control**
  ```javascript
  // Station control features
  - Enable/disable stations
  - Reassign all orders from station
  - Update station capabilities
  - Set custom wait times
  - Force logout barista
  - Remote restart station app
  ```

- **Queue Management**
  - Drag-and-drop order reassignment
  - Priority override controls
  - Batch processing tools
  - Load balancing wizard

### 3. System Health Tab

#### Components to Monitor:
```javascript
const systemComponents = {
  'API Server': {
    status: 'healthy',
    responseTime: '45ms',
    errorRate: '0.01%',
    uptime: '72h 15m'
  },
  'Database': {
    status: 'healthy',
    connections: '12/100',
    queryTime: '3ms',
    size: '1.2GB'
  },
  'SMS Gateway (Twilio)': {
    status: 'healthy',
    balance: '$123.45',
    messagestoday: '3,421',
    deliveryRate: '99.2%'
  },
  'WebSocket Server': {
    status: 'healthy',
    connections: '87',
    messages/sec: '125',
    memory: '234MB'
  },
  'Redis Cache': {
    status: 'healthy',
    memory: '128MB/512MB',
    hitRate: '94%',
    keys: '10,234'
  }
};
```

**Features:**
- Component health cards
- Performance metrics
- Resource usage graphs
- Alert thresholds configuration
- Automatic health checks
- Dependency mapping

### 4. Communications Tab

#### Twilio Management
```javascript
// Twilio configuration panel
{
  phoneNumbers: [
    {
      number: '+1234567890',
      status: 'active',
      monthlyMessages: 45000,
      capabilities: ['SMS', 'MMS']
    }
  ],
  settings: {
    accountSid: '***hidden***',
    authToken: '***hidden***',
    messagingServiceSid: 'MGxxxxx',
    statusCallbackUrl: 'https://api.example.com/sms/status'
  },
  actions: [
    'Add Phone Number',
    'Update Credentials',
    'Test SMS Send',
    'View Logs',
    'Check Balance'
  ]
}
```

#### Customer Support Tools
- SMS conversation viewer
- Failed message queue
- Customer lookup by phone
- Message templates editor
- Broadcast messaging
- Auto-response configuration

### 5. Users & Access Tab

#### User Management Grid
```
┌────────────────────────────────────────────────────────────┐
│ Username │ Role      │ Last Login │ Status │ Actions      │
├──────────┼───────────┼────────────┼────────┼──────────────┤
│ john.doe │ Barista   │ 2m ago     │ Active │ Edit|Disable │
│ jane.sm  │ Organizer │ 1h ago     │ Active │ Edit|Reset   │
│ admin    │ Admin     │ Online now │ Active │ Edit|2FA     │
└────────────────────────────────────────────────────────────┘
```

**Features:**
- User CRUD operations
- Role management
- Permission matrix editor
- Password reset tools
- Session management
- Activity logs
- 2FA configuration
- Bulk user import/export

### 6. Configuration Tab

#### System Settings
```javascript
const configSections = {
  'Event Settings': {
    eventName: 'ANZCA ASM 2025',
    timezone: 'Australia/Sydney',
    currency: 'AUD',
    language: 'en'
  },
  'Branding': {
    primaryColor: '#D97706',
    logo: 'uploadable',
    customCSS: 'editor',
    emailTemplates: 'customizable'
  },
  'Order Settings': {
    maxOrdersPerPhone: 10,
    orderTimeout: 30, // minutes
    allowCancellation: true,
    requireConfirmation: true
  },
  'Station Defaults': {
    defaultCapacity: 10,
    autoAssignment: true,
    loadBalancing: 'round-robin'
  }
};
```

#### Features:
- Visual theme editor
- Logo/branding upload
- SMS template management
- Email configuration
- Integration settings
- Feature flags
- Backup/restore settings
- Export/import configuration

### 7. Diagnostics Tab

#### Diagnostic Tools
```javascript
// Available diagnostic tools
const diagnosticTools = [
  {
    name: 'Connection Tester',
    tests: ['Database', 'Redis', 'Twilio', 'WebSocket'],
    action: 'runConnectionTests()'
  },
  {
    name: 'SMS Debugger',
    features: ['Send test SMS', 'View raw webhooks', 'Trace message flow'],
    action: 'openSMSDebugger()'
  },
  {
    name: 'Order Tracer',
    description: 'Trace complete order lifecycle',
    action: 'traceOrder(orderId)'
  },
  {
    name: 'Performance Profiler',
    metrics: ['API response times', 'Database queries', 'Memory usage'],
    action: 'runPerformanceProfile()'
  }
];
```

#### Log Viewer
- Real-time log streaming
- Log level filtering
- Search and regex support
- Export logs
- Error stack traces
- Correlation ID tracking

### 8. Emergency Tab

#### Emergency Controls
```
┌─────────────────────────────────────────────────────────────┐
│                    ⚠️  EMERGENCY CONTROLS ⚠️                 │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  🔴 STOP ALL ORDERS          🟡 PAUSE STATIONS             │
│  [Confirm Stop]              [Select Stations]              │
│                                                             │
│  📢 BROADCAST ALERT          🔄 RESTART SYSTEM             │
│  [Type: Critical]            [Select Components]            │
│  [Message: _____]                                          │
│                                                             │
│  💾 EMERGENCY BACKUP         🚨 EVACUATE MODE              │
│  [Backup Now]                [Enable Evacuation]           │
│                                                             │
│  📞 SUPPORT HOTLINE: +61 xxx xxx xxx                       │
└─────────────────────────────────────────────────────────────┘
```

**Features:**
- One-click emergency stop
- Broadcast critical alerts
- System component restart
- Backup on demand
- Maintenance mode toggle
- Clear all queues
- Export current state

---

## Implementation Components

### 1. Support Dashboard Component
```javascript
// SupportDashboard.js
import React, { useState, useEffect } from 'react';
import { Tabs, Tab, TabPanel } from './ui/Tabs';
import DashboardTab from './support-tabs/DashboardTab';
import OperationsTab from './support-tabs/OperationsTab';
import SystemHealthTab from './support-tabs/SystemHealthTab';
import CommunicationsTab from './support-tabs/CommunicationsTab';
import UsersAccessTab from './support-tabs/UsersAccessTab';
import ConfigurationTab from './support-tabs/ConfigurationTab';
import DiagnosticsTab from './support-tabs/DiagnosticsTab';
import EmergencyTab from './support-tabs/EmergencyTab';

const SupportDashboard = () => {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [systemStatus, setSystemStatus] = useState({});
  const [alerts, setAlerts] = useState([]);
  
  // WebSocket for real-time updates
  useEffect(() => {
    const ws = new WebSocketService();
    ws.on('support:update', handleSupportUpdate);
    ws.on('system:alert', handleSystemAlert);
    
    return () => ws.disconnect();
  }, []);
  
  return (
    <div className="support-interface">
      <Tabs value={activeTab} onChange={setActiveTab}>
        <Tab value="dashboard" icon="📊">Dashboard</Tab>
        <Tab value="operations" icon="⚙️">Operations</Tab>
        <Tab value="health" icon="💚">System Health</Tab>
        <Tab value="communications" icon="📱">Communications</Tab>
        <Tab value="users" icon="👥">Users & Access</Tab>
        <Tab value="config" icon="🔧">Configuration</Tab>
        <Tab value="diagnostics" icon="🔍">Diagnostics</Tab>
        <Tab value="emergency" icon="🚨">Emergency</Tab>
      </Tabs>
      
      <TabPanel value="dashboard" current={activeTab}>
        <DashboardTab status={systemStatus} alerts={alerts} />
      </TabPanel>
      {/* ... other tab panels ... */}
    </div>
  );
};
```

### 2. Support API Service
```javascript
// SupportApiService.js
class SupportApiService extends ApiService {
  // System monitoring
  async getSystemHealth() {
    return this.get('/support/system/health');
  }
  
  // Emergency actions
  async emergencyStop() {
    return this.post('/support/emergency/stop');
  }
  
  // Twilio management
  async updateTwilioConfig(config) {
    return this.put('/support/twilio/config', config);
  }
  
  // User management
  async createUser(userData) {
    return this.post('/support/users', userData);
  }
  
  async resetUserPassword(userId) {
    return this.post(`/support/users/${userId}/reset-password`);
  }
  
  // Diagnostics
  async runDiagnostic(type) {
    return this.post('/support/diagnostics/run', { type });
  }
  
  // Configuration
  async updateSystemConfig(section, config) {
    return this.put(`/support/config/${section}`, config);
  }
}
```

### 3. Backend Support Routes
```python
# support_routes.py
@bp.route('/api/support/system/health')
@role_required(['admin', 'support'])
def get_system_health():
    """Get comprehensive system health status"""
    health_status = {
        'api': check_api_health(),
        'database': check_database_health(),
        'redis': check_redis_health(),
        'twilio': check_twilio_health(),
        'websocket': check_websocket_health()
    }
    return jsonify(health_status)

@bp.route('/api/support/emergency/stop', methods=['POST'])
@role_required(['admin', 'support'])
def emergency_stop():
    """Emergency stop all operations"""
    # Pause all order processing
    # Notify all connected clients
    # Log emergency action
    return jsonify({'status': 'stopped'})

@bp.route('/api/support/diagnostics/run', methods=['POST'])
@role_required(['admin', 'support'])
def run_diagnostic():
    """Run system diagnostic"""
    diagnostic_type = request.json.get('type')
    results = run_diagnostic_test(diagnostic_type)
    return jsonify(results)
```

---

## Priority Implementation Order

### Phase 1 (Week 1) - Core Monitoring
1. Dashboard with real-time metrics
2. System health monitoring
3. Basic emergency controls
4. Alert system

### Phase 2 (Week 2) - Management Tools
1. User management interface
2. Station control panel
3. Order management grid
4. Basic diagnostics

### Phase 3 (Week 3) - Communications
1. Twilio configuration
2. SMS debugging tools
3. Customer support features
4. Message templates

### Phase 4 (Week 4) - Advanced Features
1. Configuration management
2. Advanced diagnostics
3. Performance profiling
4. Backup/restore tools

---

## Security Considerations

1. **Role-based Access**
   - Support role with specific permissions
   - Audit logging for all actions
   - Two-factor authentication for critical operations

2. **Sensitive Data**
   - Mask Twilio credentials
   - Encrypt stored passwords
   - Secure WebSocket connections

3. **Emergency Actions**
   - Require confirmation for destructive actions
   - Log all emergency operations
   - Notification to admin on critical actions

---

## Success Metrics

- Reduce incident resolution time by 50%
- Achieve 99.9% system uptime
- Handle 90% of issues without developer intervention
- Decrease customer support tickets by 40%
- Improve system performance by 25%