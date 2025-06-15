// generate-documentation.js
// Script to generate the Coffee Cue system documentation Excel file
// Run with: node generate-documentation.js

const ExcelJS = require('exceljs');
const fs = require('fs');

async function generateDocumentation() {
  // Create a new workbook
  const workbook = new ExcelJS.Workbook();
  
  // Add workbook properties
  workbook.creator = 'Coffee Cue Team';
  workbook.lastModifiedBy = 'Documentation Generator';
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.properties.date1904 = true;

  // =====================================================
  // File Components Sheet
  // =====================================================
  const fileComponentsSheet = workbook.addWorksheet('File Components', {
    properties: { tabColor: { argb: '2E75B6' } },
    views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }]
  });

  // Define columns
  fileComponentsSheet.columns = [
    { header: 'File Path', key: 'filePath', width: 30 },
    { header: 'File Name', key: 'fileName', width: 30 },
    { header: 'Purpose/Description', key: 'purpose', width: 50 },
    { header: 'Type', key: 'type', width: 20 },
    { header: 'Dependencies', key: 'dependencies', width: 40 },
    { header: 'Last Modified Date', key: 'lastModified', width: 20 },
    { header: 'Responsible Developer', key: 'developer', width: 20 },
    { header: 'Notes', key: 'notes', width: 30 }
  ];

  // Style the header row
  fileComponentsSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFF' } };
  fileComponentsSheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: '2E75B6' }
  };

  // Add frontend files data
  const frontendFiles = [
    { filePath: 'src/components', fileName: 'BaristaInterface.js', purpose: 'Main barista dashboard UI', type: 'Component', dependencies: 'useOrders, OrderDataService, MessageService', lastModified: new Date() },
    { filePath: 'src/components', fileName: 'BatchGroupsList.js', purpose: 'Displays orders grouped by batch', type: 'Component', dependencies: 'orderUtils', lastModified: new Date() },
    { filePath: 'src/components', fileName: 'CurrentOrderSection.js', purpose: 'Displays current in-progress order', type: 'Component', dependencies: '', lastModified: new Date() },
    { filePath: 'src/components', fileName: 'PendingOrdersSection.js', purpose: 'Displays pending orders queue', type: 'Component', dependencies: 'VipOrdersList, BatchGroupsList, RegularOrdersList', lastModified: new Date() },
    { filePath: 'src/components', fileName: 'VipOrdersList.js', purpose: 'Displays VIP orders', type: 'Component', dependencies: '', lastModified: new Date() },
    { filePath: 'src/components', fileName: 'RegularOrdersList.js', purpose: 'Displays regular orders', type: 'Component', dependencies: '', lastModified: new Date() },
    { filePath: 'src/components', fileName: 'StationChat.js', purpose: 'Chat interface between stations', type: 'Component', dependencies: '', lastModified: new Date() },
    { filePath: 'src/components/dialogs', fileName: 'MessageDialog.js', purpose: 'Dialog for sending customer messages', type: 'Component', dependencies: '', lastModified: new Date() },
    { filePath: 'src/components/dialogs', fileName: 'WaitTimeDialog.js', purpose: 'Dialog for adjusting wait times', type: 'Component', dependencies: '', lastModified: new Date() },
    { filePath: 'src/components/dialogs', fileName: 'WalkInOrderDialog.js', purpose: 'Dialog for adding walk-in orders', type: 'Component', dependencies: '', lastModified: new Date() },
    { filePath: 'src/components/dialogs', fileName: 'HelpDialog.js', purpose: 'Help assistance dialog', type: 'Component', dependencies: '', lastModified: new Date() },
    { filePath: 'src/components/dialogs', fileName: 'DisplayScreen.js', purpose: 'Customer-facing display screen', type: 'Component', dependencies: '', lastModified: new Date() },
    { filePath: 'src/components', fileName: 'OrderNotificationHandler.js', purpose: 'Manages order notifications', type: 'Component', dependencies: '', lastModified: new Date() },
    { filePath: 'src/components', fileName: 'SupportInterface.js', purpose: 'Support and admin interface', type: 'Component', dependencies: '', lastModified: new Date() },
    { filePath: 'src/components', fileName: 'SystemModeToggle.js', purpose: 'Toggle for system operation modes', type: 'Component', dependencies: '', lastModified: new Date() },
    { filePath: 'src/components', fileName: 'Tooltip.js', purpose: 'Reusable tooltip component', type: 'Component', dependencies: '', lastModified: new Date() },
    { filePath: 'src/services', fileName: 'AuthService.js', purpose: 'Handles authentication with JWT', type: 'Service', dependencies: 'OrderDataService', lastModified: new Date() },
    { filePath: 'src/services', fileName: 'OrderDataService.js', purpose: 'Manages order data and API requests', type: 'Service', dependencies: 'sampleData', lastModified: new Date() },
    { filePath: 'src/services', fileName: 'MessageService.js', purpose: 'Handles SMS and notifications', type: 'Service', dependencies: '', lastModified: new Date() },
    { filePath: 'src/services', fileName: 'ScheduleService.js', purpose: 'Manages barista schedules', type: 'Service', dependencies: '', lastModified: new Date() },
    { filePath: 'src/services', fileName: 'StockService.js', purpose: 'Manages inventory', type: 'Service', dependencies: '', lastModified: new Date() },
    { filePath: 'src/hooks', fileName: 'useAuth.js', purpose: 'Authentication hook', type: 'Hook', dependencies: 'AuthService, apiConfig', lastModified: new Date() },
    { filePath: 'src/hooks', fileName: 'useOrders.js', purpose: 'Orders management hook', type: 'Hook', dependencies: 'OrderDataService', lastModified: new Date() },
    { filePath: 'src/hooks', fileName: 'useStock.js', purpose: 'Stock management hook', type: 'Hook', dependencies: 'StockService', lastModified: new Date() },
    { filePath: 'src/hooks', fileName: 'useMessages.js', purpose: 'Messaging and notifications hook', type: 'Hook', dependencies: 'MessageService', lastModified: new Date() },
    { filePath: 'src/config', fileName: 'apiConfig.js', purpose: 'API configuration and endpoints', type: 'Configuration', dependencies: '', lastModified: new Date() },
    { filePath: 'src/data', fileName: 'sampleData.js', purpose: 'Fallback sample data for development/offline mode', type: 'Data', dependencies: '', lastModified: new Date() },
    { filePath: 'src/data', fileName: 'sampleOrders.js', purpose: 'Sample order data', type: 'Data', dependencies: '', lastModified: new Date() },
    { filePath: 'src/data', fileName: 'SampleStockData.js', purpose: 'Sample inventory data', type: 'Data', dependencies: '', lastModified: new Date() },
    { filePath: 'src/utils', fileName: 'orderUtils.js', purpose: 'Utilities for order processing', type: 'Utility', dependencies: '', lastModified: new Date() },
    { filePath: 'src/utils', fileName: 'frontend-auth.js', purpose: 'Frontend authentication utilities', type: 'Utility', dependencies: '', lastModified: new Date() },
    { filePath: 'src/pages', fileName: 'Login.js', purpose: 'Login page', type: 'Page', dependencies: 'useAuth', lastModified: new Date() },
    { filePath: 'src', fileName: 'App.js', purpose: 'Main application component', type: 'Core', dependencies: 'AppRouter', lastModified: new Date() },
    { filePath: 'src', fileName: 'AppRouter.js', purpose: 'Application routing configuration', type: 'Core', dependencies: 'React Router, Pages', lastModified: new Date() },
    { filePath: 'src', fileName: 'index.js', purpose: 'Application entry point', type: 'Core', dependencies: 'App', lastModified: new Date() },
    { filePath: 'src', fileName: 'setupProxy.js', purpose: 'Development proxy configuration', type: 'Configuration', dependencies: '', lastModified: new Date() }
  ];

  // Add backend files data
  const backendFiles = [
    { filePath: '/', fileName: 'app.py', purpose: 'Main application entry point', type: 'Core', dependencies: 'Flask, all routes, services', lastModified: new Date() },
    { filePath: '/', fileName: 'config.py', purpose: 'Configuration settings', type: 'Core', dependencies: '', lastModified: new Date() },
    { filePath: '/', fileName: 'auth.py', purpose: 'JWT authentication implementation', type: 'Core', dependencies: 'Flask-JWT-Extended', lastModified: new Date() },
    { filePath: '/', fileName: 'middleware.py', purpose: 'Request middleware for auth and permissions', type: 'Core', dependencies: 'auth.py', lastModified: new Date() },
    { filePath: '/', fileName: 'pg_init.py', purpose: 'Database initialization script', type: 'Core', dependencies: 'PostgreSQL', lastModified: new Date() },
    { filePath: 'routes', fileName: 'api_routes.py', purpose: 'Core API endpoints', type: 'Route', dependencies: 'models/*, database.py', lastModified: new Date() },
    { filePath: 'routes', fileName: 'auth_routes.py', purpose: 'Authentication endpoints', type: 'Route', dependencies: 'auth.py, models/users.py', lastModified: new Date() },
    { filePath: 'routes', fileName: 'barista_routes.py', purpose: 'Barista-specific endpoints', type: 'Route', dependencies: 'models/orders.py, models/stations.py', lastModified: new Date() },
    { filePath: 'routes', fileName: 'admin_routes.py', purpose: 'Admin-specific endpoints', type: 'Route', dependencies: 'models/users.py, models/settings.py', lastModified: new Date() },
    { filePath: 'routes', fileName: 'customer_routes.py', purpose: 'Customer-facing endpoints', type: 'Route', dependencies: 'models/orders.py', lastModified: new Date() },
    { filePath: 'routes', fileName: 'sms_routes.py', purpose: 'SMS handling endpoints', type: 'Route', dependencies: 'services/messaging.py', lastModified: new Date() },
    { filePath: 'routes', fileName: 'display_routes.py', purpose: 'Display screen endpoints', type: 'Route', dependencies: 'models/orders.py', lastModified: new Date() },
    { filePath: 'routes', fileName: 'track_routes.py', purpose: 'Order tracking endpoints', type: 'Route', dependencies: 'models/orders.py', lastModified: new Date() },
    { filePath: 'models', fileName: 'orders.py', purpose: 'Order and customer models', type: 'Model', dependencies: 'database.py', lastModified: new Date() },
    { filePath: 'models', fileName: 'users.py', purpose: 'User and authentication models', type: 'Model', dependencies: 'database.py', lastModified: new Date() },
    { filePath: 'models', fileName: 'stations.py', purpose: 'Coffee station models', type: 'Model', dependencies: 'database.py', lastModified: new Date() },
    { filePath: 'models', fileName: 'settings.py', purpose: 'System settings model', type: 'Model', dependencies: 'database.py', lastModified: new Date() },
    { filePath: 'services', fileName: 'coffee_system.py', purpose: 'Core business logic', type: 'Service', dependencies: 'models/*', lastModified: new Date() },
    { filePath: 'services', fileName: 'messaging.py', purpose: 'SMS and notification service', type: 'Service', dependencies: 'Twilio', lastModified: new Date() },
    { filePath: 'services', fileName: 'nlp.py', purpose: 'Natural language processing for orders', type: 'Service', dependencies: '', lastModified: new Date() },
    { filePath: 'services', fileName: 'advanced_nlp.py', purpose: 'Enhanced NLP using external APIs', type: 'Service', dependencies: 'services/nlp.py', lastModified: new Date() },
    { filePath: 'utils', fileName: 'database.py', purpose: 'Database connection and utilities', type: 'Utility', dependencies: 'PostgreSQL', lastModified: new Date() },
    { filePath: 'utils', fileName: 'helpers.py', purpose: 'Shared helper functions', type: 'Utility', dependencies: '', lastModified: new Date() },
    { filePath: 'include', fileName: 'websocket.py', purpose: 'WebSocket functionality', type: 'Utility', dependencies: 'eventlet', lastModified: new Date() },
    { filePath: 'include', fileName: 'loyalty.py', purpose: 'Loyalty program functionality', type: 'Utility', dependencies: 'models/orders.py', lastModified: new Date() },
    { filePath: 'include', fileName: 'stock_management.py', purpose: 'Inventory management', type: 'Utility', dependencies: '', lastModified: new Date() },
    { filePath: 'migrations', fileName: 'create_schema.py', purpose: 'Database schema creation', type: 'Migration', dependencies: 'database.py', lastModified: new Date() },
    { filePath: 'scripts', fileName: 'sqlite-to-postgres.py', purpose: 'Database migration utility', type: 'Script', dependencies: '', lastModified: new Date() },
    { filePath: 'scripts', fileName: 'reset_admin.py', purpose: 'Admin user reset utility', type: 'Script', dependencies: '', lastModified: new Date() },
    { filePath: 'scripts', fileName: 'create_admin_user.py', purpose: 'Admin user creation', type: 'Script', dependencies: '', lastModified: new Date() }
  ];

  // Add template files
  const templateFiles = [
    { filePath: 'templates/auth', fileName: 'login.html', purpose: 'Login page template', type: 'Template', dependencies: 'base.html', lastModified: new Date() },
    { filePath: 'templates/auth', fileName: 'reset_password.html', purpose: 'Password reset template', type: 'Template', dependencies: 'base.html', lastModified: new Date() },
    { filePath: 'templates/auth', fileName: 'forgot_password.html', purpose: 'Forgot password template', type: 'Template', dependencies: 'base.html', lastModified: new Date() },
    { filePath: 'templates/barista', fileName: 'dashboard.html', purpose: 'Barista dashboard template', type: 'Template', dependencies: 'base.html', lastModified: new Date() },
    { filePath: 'templates/barista', fileName: 'order_details.html', purpose: 'Order details template', type: 'Template', dependencies: 'base.html', lastModified: new Date() },
    { filePath: 'templates/staff', fileName: 'dashboard.html', purpose: 'Staff dashboard template', type: 'Template', dependencies: 'base.html', lastModified: new Date() },
    { filePath: 'templates/admin', fileName: 'system_settings.html', purpose: 'System settings template', type: 'Template', dependencies: 'base.html', lastModified: new Date() },
    { filePath: 'templates/track', fileName: 'order.html', purpose: 'Order tracking template', type: 'Template', dependencies: 'base.html', lastModified: new Date() }
  ];

  // Add static files
  const staticFiles = [
    { filePath: 'static/js', fileName: 'auth-client.js', purpose: 'Authentication client-side logic', type: 'Static', dependencies: '', lastModified: new Date() },
    { filePath: 'static/js', fileName: 'frontend-auth.js', purpose: 'Frontend authentication utilities', type: 'Static', dependencies: '', lastModified: new Date() },
    { filePath: 'static/js', fileName: 'barista.js', purpose: 'Barista UI functionality', type: 'Static', dependencies: '', lastModified: new Date() },
    { filePath: 'static/js', fileName: 'offline-manager.js', purpose: 'Offline mode handling', type: 'Static', dependencies: '', lastModified: new Date() },
    { filePath: 'static/js', fileName: 'service-worker.js', purpose: 'PWA service worker', type: 'Static', dependencies: '', lastModified: new Date() },
    { filePath: 'static/css', fileName: 'base.css', purpose: 'Base styling', type: 'Static', dependencies: '', lastModified: new Date() },
    { filePath: 'static/css', fileName: 'barista.css', purpose: 'Barista-specific styling', type: 'Static', dependencies: 'base.css', lastModified: new Date() },
    { filePath: 'static/css', fileName: 'track.css', purpose: 'Order tracking styling', type: 'Static', dependencies: 'base.css', lastModified: new Date() },
    { filePath: 'static/audio', fileName: 'order-ready.mp3', purpose: 'Order ready notification sound', type: 'Static', dependencies: '', lastModified: new Date() },
    { filePath: 'static/audio', fileName: 'error.mp3', purpose: 'Error notification sound', type: 'Static', dependencies: '', lastModified: new Date() },
    { filePath: 'static/audio', fileName: 'payment.mp3', purpose: 'Payment received sound', type: 'Static', dependencies: '', lastModified: new Date() },
    { filePath: 'static/audio', fileName: 'scan-success.mp3', purpose: 'Scan success sound', type: 'Static', dependencies: '', lastModified: new Date() }
  ];

  // Add all files to the sheet
  fileComponentsSheet.addRows(frontendFiles);
  fileComponentsSheet.addRows(backendFiles);
  fileComponentsSheet.addRows(templateFiles);
  fileComponentsSheet.addRows(staticFiles);

  // Apply conditional formatting to highlight different types
  fileComponentsSheet.addConditionalFormatting({
    ref: 'D2:D1000',
    rules: [
      {
        type: 'containsText',
        operator: 'containsText',
        text: 'Component',
        style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFE6F0FF' } } },
      },
      {
        type: 'containsText',
        operator: 'containsText',
        text: 'Service',
        style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFE6FFEF' } } },
      },
      {
        type: 'containsText',
        operator: 'containsText',
        text: 'Hook',
        style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFFF1E6' } } },
      },
      {
        type: 'containsText',
        operator: 'containsText',
        text: 'Model',
        style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFE6EEFF' } } },
      },
      {
        type: 'containsText',
        operator: 'containsText',
        text: 'Route',
        style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFFF0F0' } } },
      },
      {
        type: 'containsText',
        operator: 'containsText',
        text: 'Template',
        style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFFD8E4' } } },
      }
    ]
  });

  // =====================================================
  // Frontend Architecture Sheet
  // =====================================================
  const frontendArchSheet = workbook.addWorksheet('Frontend Architecture', {
    properties: { tabColor: { argb: '5B9BD5' } },
    views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }]
  });

  // Define columns
  frontendArchSheet.columns = [
    { header: 'Component Name', key: 'componentName', width: 30 },
    { header: 'Parent Component', key: 'parentComponent', width: 30 },
    { header: 'Function/Class', key: 'functionClass', width: 20 },
    { header: 'Props/Parameters', key: 'props', width: 40 },
    { header: 'State Management', key: 'stateManagement', width: 30 },
    { header: 'API Endpoints Used', key: 'apiEndpoints', width: 40 },
    { header: 'Related Files', key: 'relatedFiles', width: 40 },
    { header: 'Notes', key: 'notes', width: 30 }
  ];

  // Style the header row
  frontendArchSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFF' } };
  frontendArchSheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: '5B9BD5' }
  };

  // Add frontend architecture data
  const frontendArchData = [
    {
      componentName: 'BaristaInterface',
      parentComponent: 'App',
      functionClass: 'Function Component',
      props: 'None',
      stateManagement: 'useState, useOrders hook',
      apiEndpoints: '/api/orders/*, /api/chat/messages',
      relatedFiles: 'useOrders.js, OrderDataService.js, MessageService.js',
      notes: 'Main dashboard for baristas'
    },
    {
      componentName: 'PendingOrdersSection',
      parentComponent: 'BaristaInterface',
      functionClass: 'Function Component',
      props: 'orders, filter, onFilterChange, onStartOrder, onProcessBatch',
      stateManagement: 'Passed from parent',
      apiEndpoints: 'None (uses parent data)',
      relatedFiles: 'VipOrdersList.js, BatchGroupsList.js, RegularOrdersList.js',
      notes: 'Displays all pending orders'
    },
    {
      componentName: 'BatchGroupsList',
      parentComponent: 'PendingOrdersSection',
      functionClass: 'Function Component',
      props: 'batchGroups, onStartOrder, onProcessBatch',
      stateManagement: 'Passed from parent',
      apiEndpoints: 'None (uses parent data)',
      relatedFiles: 'orderUtils.js',
      notes: 'Groups similar orders for batch processing'
    },
    {
      componentName: 'VipOrdersList',
      parentComponent: 'PendingOrdersSection',
      functionClass: 'Function Component',
      props: 'orders, onStartOrder',
      stateManagement: 'Passed from parent',
      apiEndpoints: 'None (uses parent data)',
      relatedFiles: 'orderUtils.js',
      notes: 'Displays priority orders'
    },
    {
      componentName: 'RegularOrdersList',
      parentComponent: 'PendingOrdersSection',
      functionClass: 'Function Component',
      props: 'orders, onStartOrder',
      stateManagement: 'Passed from parent',
      apiEndpoints: 'None (uses parent data)',
      relatedFiles: 'orderUtils.js',
      notes: 'Displays standard orders'
    },
    {
      componentName: 'CurrentOrderSection',
      parentComponent: 'BaristaInterface',
      functionClass: 'Function Component',
      props: 'currentOrder, onCompleteOrder',
      stateManagement: 'Passed from parent',
      apiEndpoints: 'None (uses parent data)',
      relatedFiles: 'useOrders.js',
      notes: 'Shows the active order being prepared'
    },
    {
      componentName: 'OrderNotificationHandler',
      parentComponent: 'BaristaInterface',
      functionClass: 'Function Component',
      props: 'onSendMessage, onUpdateSettings',
      stateManagement: 'None',
      apiEndpoints: 'None (uses callbacks)',
      relatedFiles: 'MessageService.js',
      notes: 'Handles notifications for completed orders'
    },
    {
      componentName: 'StationChat',
      parentComponent: 'BaristaInterface',
      functionClass: 'Function Component',
      props: 'onClose, onMessageRead',
      stateManagement: 'useState for messages',
      apiEndpoints: '/api/chat/messages',
      relatedFiles: 'MessageService.js',
      notes: 'Communication between stations'
    },
    {
      componentName: 'MessageDialog',
      parentComponent: 'BaristaInterface',
      functionClass: 'Function Component',
      props: 'order, onSubmit, onClose',
      stateManagement: 'useState for message content',
      apiEndpoints: 'None (uses callbacks)',
      relatedFiles: 'None',
      notes: 'Modal for sending customer messages'
    },
    {
      componentName: 'WalkInOrderDialog',
      parentComponent: 'BaristaInterface',
      functionClass: 'Function Component',
      props: 'onSubmit, onClose',
      stateManagement: 'useState for form fields',
      apiEndpoints: 'None (uses callbacks)',
      relatedFiles: 'None',
      notes: 'Modal for creating walk-in orders'
    },
    {
      componentName: 'WaitTimeDialog',
      parentComponent: 'BaristaInterface',
      functionClass: 'Function Component',
      props: 'currentWaitTime, onSubmit, onClose',
      stateManagement: 'useState for waitTime',
      apiEndpoints: 'None (uses callbacks)',
      relatedFiles: 'None',
      notes: 'Modal for adjusting wait time'
    },
    {
      componentName: 'DisplayScreen',
      parentComponent: 'App (separate route)',
      functionClass: 'Function Component',
      props: 'None',
      stateManagement: 'useState, useEffect for polling',
      apiEndpoints: '/api/orders/completed',
      relatedFiles: 'OrderDataService.js',
      notes: 'Customer-facing screen showing ready orders'
    },
    {
      componentName: 'SupportInterface',
      parentComponent: 'App (separate route)',
      functionClass: 'Function Component',
      props: 'None',
      stateManagement: 'useState for admin options',
      apiEndpoints: 'Various admin endpoints',
      relatedFiles: 'AuthService.js',
      notes: 'Admin dashboard for system management'
    }
  ];

  // Add frontend architecture data to sheet
  frontendArchSheet.addRows(frontendArchData);

  // =====================================================
  // Backend Architecture Sheet
  // =====================================================
  const backendArchSheet = workbook.addWorksheet('Backend Architecture', {
    properties: { tabColor: { argb: '70AD47' } },
    views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }]
  });

  // Define columns
  backendArchSheet.columns = [
    { header: 'Route Name', key: 'routeName', width: 30 },
    { header: 'HTTP Method', key: 'httpMethod', width: 15 },
    { header: 'Endpoint Path', key: 'endpointPath', width: 40 },
    { header: 'Controller/Handler', key: 'controller', width: 30 },
    { header: 'Required Auth Role', key: 'authRole', width: 20 },
    { header: 'Request Parameters', key: 'requestParams', width: 40 },
    { header: 'Response Structure', key: 'responseStructure', width: 40 },
    { header: 'Database Operations', key: 'dbOperations', width: 30 },
    { header: 'Notes', key: 'notes', width: 30 }
  ];

  // Style the header row
  backendArchSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFF' } };
  backendArchSheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: '70AD47' }
  };

  // Add backend architecture data
  const backendArchData = [
    {
      routeName: 'get_pending_orders',
      httpMethod: 'GET',
      endpointPath: '/api/orders/pending',
      controller: 'api_routes.py',
      authRole: 'barista, admin',
      requestParams: 'None',
      responseStructure: 'JSON array of order objects',
      dbOperations: 'SELECT from orders WHERE status=pending',
      notes: 'Used by barista dashboard'
    },
    {
      routeName: 'get_in_progress_orders',
      httpMethod: 'GET',
      endpointPath: '/api/orders/in-progress',
      controller: 'api_routes.py',
      authRole: 'barista, admin',
      requestParams: 'None',
      responseStructure: 'JSON array of order objects',
      dbOperations: 'SELECT from orders WHERE status=in-progress',
      notes: 'Used by barista dashboard'
    },
    {
      routeName: 'get_completed_orders',
      httpMethod: 'GET',
      endpointPath: '/api/orders/completed',
      controller: 'api_routes.py',
      authRole: 'barista, admin',
      requestParams: 'None',
      responseStructure: 'JSON array of order objects',
      dbOperations: 'SELECT from orders WHERE status=completed',
      notes: 'Used by barista dashboard and display screen'
    },
    {
      routeName: 'start_order',
      httpMethod: 'POST',
      endpointPath: '/api/orders/<order_id>/start',
      controller: 'api_routes.py',
      authRole: 'barista, admin',
      requestParams: 'order_id (URL parameter)',
      responseStructure: 'JSON success status',
      dbOperations: 'UPDATE orders SET status=in-progress',
      notes: 'Changes order status from pending to in-progress'
    },
    {
      routeName: 'complete_order',
      httpMethod: 'POST',
      endpointPath: '/api/orders/<order_id>/complete',
      controller: 'api_routes.py',
      authRole: 'barista, admin',
      requestParams: 'order_id (URL parameter)',
      responseStructure: 'JSON success status',
      dbOperations: 'UPDATE orders SET status=completed',
      notes: 'Changes order status from in-progress to completed'
    },
    {
      routeName: 'batch_process_orders',
      httpMethod: 'POST',
      endpointPath: '/api/orders/batch',
      controller: 'api_routes.py',
      authRole: 'barista, admin',
      requestParams: 'order_ids (array), action (string)',
      responseStructure: 'JSON success status',
      dbOperations: 'UPDATE multiple orders',
      notes: 'Batch updates order statuses'
    },
    {
      routeName: 'sms_webhook',
      httpMethod: 'POST',
      endpointPath: '/sms',
      controller: 'sms_routes.py',
      authRole: 'None (public)',
      requestParams: 'From, Body (Twilio parameters)',
      responseStructure: 'TwiML response',
      dbOperations: 'INSERT into sms_messages',
      notes: 'Handles incoming SMS from customers'
    },
    {
      routeName: 'login',
      httpMethod: 'POST',
      endpointPath: '/api/auth/login',
      controller: 'auth_routes.py',
      authRole: 'None (public)',
      requestParams: 'username, password',
      responseStructure: 'JWT tokens and user data',
      dbOperations: 'SELECT from users',
      notes: 'User authentication'
    },
    {
      routeName: 'refresh_token',
      httpMethod: 'POST',
      endpointPath: '/api/auth/refresh',
      controller: 'auth_routes.py',
      authRole: 'None (uses refresh token)',
      requestParams: 'refreshToken',
      responseStructure: 'New JWT token',
      dbOperations: 'None',
      notes: 'Refreshes expired JWT token'
    },
    {
      routeName: 'barista_view',
      httpMethod: 'GET',
      endpointPath: '/barista/',
      controller: 'barista_routes.py',
      authRole: 'barista, admin',
      requestParams: 'station (query parameter)',
      responseStructure: 'HTML template',
      dbOperations: 'SELECT active orders by station',
      notes: 'Barista dashboard view'
    },
    {
      routeName: 'update_status',
      httpMethod: 'POST',
      endpointPath: '/barista/update_status/<order_id>/<status>',
      controller: 'barista_routes.py',
      authRole: 'barista, admin',
      requestParams: 'order_id, status (URL parameters)',
      responseStructure: 'JSON success status',
      dbOperations: 'UPDATE orders SET status',
      notes: 'Update order status from barista UI'
    },
    {
      routeName: 'chat_messages',
      httpMethod: 'GET',
      endpointPath: '/api/chat/messages',
      controller: 'api_routes.py',
      authRole: 'barista, admin',
      requestParams: 'None',
      responseStructure: 'JSON array of messages',
      dbOperations: 'SELECT from chat_messages',
      notes: 'Get chat messages between stations'
    }
  ];

  // Add backend architecture data to sheet
  backendArchSheet.addRows(backendArchData);

  // =====================================================
  // Database Schema Sheet
  // =====================================================
  const dbSchemaSheet = workbook.addWorksheet('Database Schema', {
    properties: { tabColor: { argb: 'A5A5A5' } },
    views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }]
  });

  // Define columns
  dbSchemaSheet.columns = [
    { header: 'Table Name', key: 'tableName', width: 25 },
    { header: 'Column Name', key: 'columnName', width: 25 },
    { header: 'Data Type', key: 'dataType', width: 20 },
    { header: 'Constraints', key: 'constraints', width: 25 },
    { header: 'References', key: 'references', width: 25 },
    { header: 'Purpose', key: 'purpose', width: 40 },
    { header: 'Related Models', key: 'relatedModels', width: 25 },
    { header: 'Notes', key: 'notes', width: 30 }
  ];

  // Style the header row
  dbSchemaSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFF' } };
  dbSchemaSheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'A5A5A5' }
  };

  // Add database schema data - orders table
  const dbSchemaData = [
    {
      tableName: 'orders',
      columnName: 'id',
      dataType: 'SERIAL',
      constraints: 'PRIMARY KEY',
      references: '',
      purpose: 'Unique identifier for orders',
      relatedModels: 'models/orders.py',
      notes: ''
    },
    {
      tableName: 'orders',
      columnName: 'order_number',
      dataType: 'VARCHAR(20)',
      constraints: 'UNIQUE NOT NULL',
      references: '',
      purpose: 'Customer-facing order ID',
      relatedModels: 'models/orders.py',
      notes: ''
    },
    {
      tableName: 'orders',
      columnName: 'phone',
      dataType: 'VARCHAR(20)',
      constraints: 'NOT NULL',
      references: '',
      purpose: 'Customer phone number',
      relatedModels: 'models/orders.py',
      notes: ''
    },
    {
      tableName: 'orders',
      columnName: 'order_details',
      dataType: 'JSONB',
      constraints: 'NOT NULL',
      references: '',
      purpose: 'Details of the coffee order',
      relatedModels: 'models/orders.py',
      notes: 'Contains type, milk, sugar, etc.'
    },
    {
      tableName: 'orders',
      columnName: 'status',
      dataType: 'VARCHAR(20)',
      constraints: 'NOT NULL',
      references: '',
      purpose: 'Current order status',
      relatedModels: 'models/orders.py',
      notes: 'pending, in-progress, completed, cancelled'
    },
    {
      tableName: 'orders',
      columnName: 'station_id',
      dataType: 'INTEGER',
      constraints: 'NOT NULL',
      references: '',
      purpose: 'Station assigned to the order',
      relatedModels: 'models/orders.py',
      notes: ''
    },
    {
      tableName: 'orders',
      columnName: 'created_at',
      dataType: 'TIMESTAMP',
      constraints: 'DEFAULT CURRENT_TIMESTAMP',
      references: '',
      purpose: 'When the order was created',
      relatedModels: 'models/orders.py',
      notes: ''
    },
    {
      tableName: 'orders',
      columnName: 'updated_at',
      dataType: 'TIMESTAMP',
      constraints: 'DEFAULT CURRENT_TIMESTAMP',
      references: '',
      purpose: 'When the order was last updated',
      relatedModels: 'models/orders.py',
      notes: ''
    },
    {
      tableName: 'orders',
      columnName: 'completed_at',
      dataType: 'TIMESTAMP',
      constraints: '',
      references: '',
      purpose: 'When the order was completed',
      relatedModels: 'models/orders.py',
      notes: ''
    },
    {
      tableName: 'orders',
      columnName: 'queue_priority',
      dataType: 'INTEGER',
      constraints: 'NOT NULL DEFAULT 5',
      references: '',
      purpose: 'Priority level (1=highest)',
      relatedModels: 'models/orders.py',
      notes: 'Lower number = higher priority'
    },
    {
      tableName: 'orders',
      columnName: 'payment_status',
      dataType: 'VARCHAR(20)',
      constraints: "DEFAULT 'pending'",
      references: '',
      purpose: 'Current payment status',
      relatedModels: 'models/orders.py',
      notes: 'pending, paid, failed'
    },
    
    // Users table
    {
      tableName: 'users',
      columnName: 'id',
      dataType: 'SERIAL',
      constraints: 'PRIMARY KEY',
      references: '',
      purpose: 'Unique identifier for users',
      relatedModels: 'models/users.py',
      notes: ''
    },
    {
      tableName: 'users',
      columnName: 'username',
      dataType: 'VARCHAR(50)',
      constraints: 'UNIQUE NOT NULL',
      references: '',
      purpose: 'Login username',
      relatedModels: 'models/users.py',
      notes: ''
    },
    {
      tableName: 'users',
      columnName: 'email',
      dataType: 'VARCHAR(100)',
      constraints: 'UNIQUE NOT NULL',
      references: '',
      purpose: 'User email address',
      relatedModels: 'models/users.py',
      notes: ''
    },
    {
      tableName: 'users',
      columnName: 'password_hash',
      dataType: 'TEXT',
      constraints: 'NOT NULL',
      references: '',
      purpose: 'Hashed password',
      relatedModels: 'models/users.py',
      notes: ''
    },
    {
      tableName: 'users',
      columnName: 'role',
      dataType: 'VARCHAR(20)',
      constraints: 'NOT NULL',
      references: '',
      purpose: 'User role for permissions',
      relatedModels: 'models/users.py',
      notes: 'admin, staff, barista, support, display'
    },
    
    // Station stats table
    {
      tableName: 'station_stats',
      columnName: 'station_id',
      dataType: 'INTEGER',
      constraints: 'PRIMARY KEY',
      references: '',
      purpose: 'Unique identifier for station',
      relatedModels: 'models/stations.py',
      notes: ''
    },
    {
      tableName: 'station_stats',
      columnName: 'current_load',
      dataType: 'INTEGER',
      constraints: 'DEFAULT 0',
      references: '',
      purpose: 'Current number of orders',
      relatedModels: 'models/stations.py',
      notes: ''
    },
    {
      tableName: 'station_stats',
      columnName: 'status',
      dataType: 'VARCHAR(20)',
      constraints: "DEFAULT 'active'",
      references: '',
      purpose: 'Current station status',
      relatedModels: 'models/stations.py',
      notes: 'active, inactive, maintenance'
    },
    
    // Customer preferences table
    {
      tableName: 'customer_preferences',
      columnName: 'phone',
      dataType: 'VARCHAR(20)',
      constraints: 'PRIMARY KEY',
      references: '',
      purpose: 'Customer phone number',
      relatedModels: 'models/orders.py',
      notes: ''
    },
    {
      tableName: 'customer_preferences',
      columnName: 'name',
      dataType: 'VARCHAR(100)',
      constraints: '',
      references: '',
      purpose: 'Customer name',
      relatedModels: 'models/orders.py',
      notes: ''
    },
    {
      tableName: 'customer_preferences',
      columnName: 'preferred_drink',
      dataType: 'VARCHAR(50)',
      constraints: '',
      references: '',
      purpose: 'Favorite coffee type',
      relatedModels: 'models/orders.py',
      notes: ''
    },
    {
      tableName: 'customer_preferences',
      columnName: 'loyalty_points',
      dataType: 'INTEGER',
      constraints: 'DEFAULT 0',
      references: '',
      purpose: 'Accumulated loyalty points',
      relatedModels: 'models/orders.py',
      notes: ''
    },
    
    // Settings table
    {
      tableName: 'settings',
      columnName: 'key',
      dataType: 'VARCHAR(100)',
      constraints: 'PRIMARY KEY',
      references: '',
      purpose: 'Setting identifier',
      relatedModels: 'models/settings.py',
      notes: ''
    },
    {
      tableName: 'settings',
      columnName: 'value',
      dataType: 'TEXT',
      constraints: 'NOT NULL',
      references: '',
      purpose: 'Setting value',
      relatedModels: 'models/settings.py',
      notes: ''
    }
  ];

  // Add database schema data to sheet
  dbSchemaSheet.addRows(dbSchemaData);

  // Add conditional formatting to highlight different tables
  dbSchemaSheet.addConditionalFormatting({
    ref: 'A2:A1000',
    rules: [
      {
        type: 'containsText',
        operator: 'containsText',
        text: 'orders',
        style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFFF1E6' } } },
      },
      {
        type: 'containsText',
        operator: 'containsText',
        text: 'users',
        style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFE6F0FF' } } },
      },
      {
        type: 'containsText',
        operator: 'containsText',
        text: 'station',
        style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFE6FFEF' } } },
      },
      {
        type: 'containsText',
        operator: 'containsText',
        text: 'customer',
        style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFE6EEFF' } } },
      },
      {
        type: 'containsText',
        operator: 'containsText',
        text: 'settings',
        style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFFF0F0' } } },
      }
    ]
  });

  // =====================================================
  // API Endpoints Sheet
  // =====================================================
  const apiEndpointsSheet = workbook.addWorksheet('API Endpoints', {
    properties: { tabColor: { argb: 'ED7D31' } },
    views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }]
  });

  // Define columns
  apiEndpointsSheet.columns = [
    { header: 'Path', key: 'path', width: 40 },
    { header: 'Method', key: 'method', width: 15 },
    { header: 'Description', key: 'description', width: 40 },
    { header: 'Request Format', key: 'requestFormat', width: 30 },
    { header: 'Response Format', key: 'responseFormat', width: 30 },
    { header: 'Auth Required', key: 'authRequired', width: 15 },
    { header: 'Used By (Frontend)', key: 'usedBy', width: 30 },
    { header: 'Notes', key: 'notes', width: 30 }
  ];

  // Style the header row
  apiEndpointsSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFF' } };
  apiEndpointsSheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'ED7D31' }
  };

  // Add API endpoints data
  const apiEndpointsData = [
    {
      path: '/api/orders/pending',
      method: 'GET',
      description: 'Get all pending orders',
      requestFormat: 'None',
      responseFormat: 'JSON Array of order objects',
      authRequired: 'Yes - barista',
      usedBy: 'PendingOrdersSection',
      notes: 'Sorted by priority and creation time'
    },
    {
      path: '/api/orders/in-progress',
      method: 'GET',
      description: 'Get all in-progress orders',
      requestFormat: 'None',
      responseFormat: 'JSON Array of order objects',
      authRequired: 'Yes - barista',
      usedBy: 'BaristaInterface',
      notes: 'Currently being prepared'
    },
    {
      path: '/api/orders/completed',
      method: 'GET',
      description: 'Get recently completed orders',
      requestFormat: 'None',
      responseFormat: 'JSON Array of order objects',
      authRequired: 'Yes - barista',
      usedBy: 'BaristaInterface',
      notes: 'Limited to last 20 orders'
    },
    {
      path: '/api/orders/{order_id}/start',
      method: 'POST',
      description: 'Start an order (move to in-progress)',
      requestFormat: 'None (URL parameter)',
      responseFormat: '{"success": true/false}',
      authRequired: 'Yes - barista',
      usedBy: 'useOrders.startOrder()',
      notes: ''
    },
    {
      path: '/api/orders/{order_id}/complete',
      method: 'POST',
      description: 'Complete an order',
      requestFormat: 'None (URL parameter)',
      responseFormat: '{"success": true/false}',
      authRequired: 'Yes - barista',
      usedBy: 'useOrders.completeOrder()',
      notes: 'Records completion time'
    },
    {
      path: '/api/orders/batch',
      method: 'POST',
      description: 'Process multiple orders at once',
      requestFormat: '{"order_ids": [], "action": "start/complete"}',
      responseFormat: '{"success": true/false}',
      authRequired: 'Yes - barista',
      usedBy: 'useOrders.processBatch()',
      notes: 'Used for batch processing'
    },
    {
      path: '/api/chat/messages',
      method: 'GET',
      description: 'Get station chat messages',
      requestFormat: 'None',
      responseFormat: 'JSON Array of message objects',
      authRequired: 'Yes - barista',
      usedBy: 'StationChat',
      notes: 'Inter-station communication'
    },
    {
      path: '/api/auth/login',
      method: 'POST',
      description: 'User login',
      requestFormat: '{"username": string, "password": string}',
      responseFormat: '{"token": string, "refreshToken": string, "user": object}',
      authRequired: 'No',
      usedBy: 'AuthService.login()',
      notes: 'Returns JWT tokens'
    },
    {
      path: '/api/auth/refresh',
      method: 'POST',
      description: 'Refresh JWT token',
      requestFormat: '{"refreshToken": string}',
      responseFormat: '{"token": string}',
      authRequired: 'No (uses refresh token)',
      usedBy: 'AuthService.refreshToken()',
      notes: 'Used when token expires'
    },
    {
      path: '/api/auth/logout',
      method: 'POST',
      description: 'Logout user',
      requestFormat: '{"refreshToken": string}',
      responseFormat: '{"success": true/false}',
      authRequired: 'Yes',
      usedBy: 'AuthService.logout()',
      notes: 'Invalidates tokens'
    },
    {
      path: '/sms',
      method: 'POST',
      description: 'Handle incoming SMS',
      requestFormat: 'Twilio webhook format',
      responseFormat: 'TwiML response',
      authRequired: 'No (public endpoint)',
      usedBy: 'None (external Twilio service)',
      notes: 'Webhook for Twilio'
    },
    {
      path: '/api/settings/wait-time',
      method: 'POST',
      description: 'Update wait time',
      requestFormat: '{"waitTime": number}',
      responseFormat: '{"success": true/false}',
      authRequired: 'Yes - barista',
      usedBy: 'BaristaInterface',
      notes: 'Update estimated wait time'
    }
  ];

  // Add API endpoints data to sheet
  apiEndpointsSheet.addRows(apiEndpointsData);

  // =====================================================
  // Authentication Flow Sheet
  // =====================================================
  const authFlowSheet = workbook.addWorksheet('Authentication Flow', {
    properties: { tabColor: { argb: 'FFC000' } },
    views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }]
  });

  // Define columns
  authFlowSheet.columns = [
    { header: 'Process Step', key: 'processStep', width: 30 },
    { header: 'Frontend Component', key: 'frontendComponent', width: 30 },
    { header: 'Backend Route', key: 'backendRoute', width: 30 },
    { header: 'Required Data', key: 'requiredData', width: 30 },
    { header: 'Response Data', key: 'responseData', width: 30 },
    { header: 'Security Measures', key: 'securityMeasures', width: 30 },
    { header: 'Notes', key: 'notes', width: 30 }
  ];

  // Style the header row
  authFlowSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFF' } };
  authFlowSheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFC000' }
  };

  // Add authentication flow data
  const authFlowData = [
    {
      processStep: 'User Login',
      frontendComponent: 'LoginPage.jsx',
      backendRoute: '/api/auth/login',
      requiredData: 'username, password',
      responseData: 'JWT token, refresh token, user object',
      securityMeasures: 'Password hashing, HTTPS',
      notes: 'Initiates user session'
    },
    {
      processStep: 'Token Storage',
      frontendComponent: 'AuthService.js',
      backendRoute: 'N/A',
      requiredData: 'JWT token, refresh token',
      responseData: 'N/A',
      securityMeasures: 'localStorage for tokens',
      notes: 'Stores tokens for subsequent requests'
    },
    {
      processStep: 'Authenticated Request',
      frontendComponent: 'OrderDataService.js',
      backendRoute: 'Any protected route',
      requiredData: 'JWT token in Authorization header',
      responseData: 'Requested resource data',
      securityMeasures: 'JWT verification, role checking',
      notes: 'Every API request after login'
    },
    {
      processStep: 'Token Expiry Check',
      frontendComponent: 'AuthService.isTokenExpired()',
      backendRoute: 'N/A',
      requiredData: 'JWT token',
      responseData: 'Boolean (expired or not)',
      securityMeasures: 'Checking JWT expiration claim',
      notes: 'Checks before each request'
    },
    {
      processStep: 'Token Refresh',
      frontendComponent: 'AuthService.refreshToken()',
      backendRoute: '/api/auth/refresh',
      requiredData: 'Refresh token',
      responseData: 'New JWT token',
      securityMeasures: 'Refresh token validation',
      notes: 'When access token expires'
    },
    {
      processStep: 'User Logout',
      frontendComponent: 'AuthService.logout()',
      backendRoute: '/api/auth/logout',
      requiredData: 'Refresh token',
      responseData: 'Success status',
      securityMeasures: 'Removing tokens from localStorage',
      notes: 'Ends user session'
    },
    {
      processStep: 'Password Reset Request',
      frontendComponent: 'ForgotPassword.jsx',
      backendRoute: '/api/auth/forgot-password',
      requiredData: 'email',
      responseData: 'Success status',
      securityMeasures: 'Email verification',
      notes: 'Sends reset link to user email'
    },
    {
      processStep: 'Password Reset',
      frontendComponent: 'ResetPassword.jsx',
      backendRoute: '/api/auth/reset-password',
      requiredData: 'token, new password',
      responseData: 'Success status',
      securityMeasures: 'Token validation, password strength check',
      notes: 'Completes password reset process'
    }
  ];

  // Add authentication flow data to sheet
  authFlowSheet.addRows(authFlowData);

  // =====================================================
  // User Workflows Sheet
  // =====================================================
  const workflowsSheet = workbook.addWorksheet('User Workflows', {
    properties: { tabColor: { argb: '7030A0' } },
    views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }]
  });

  // Define columns
  workflowsSheet.columns = [
    { header: 'Workflow Name', key: 'workflowName', width: 30 },
    { header: 'Actor', key: 'actor', width: 20 },
    { header: 'Step Number', key: 'stepNumber', width: 15 },
    { header: 'Action', key: 'action', width: 40 },
    { header: 'Frontend Component', key: 'frontendComponent', width: 30 },
    { header: 'Backend Route', key: 'backendRoute', width: 30 },
    { header: 'Notes/Expected Behavior', key: 'notes', width: 40 }
  ];

  // Style the header row
  workflowsSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFF' } };
  workflowsSheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: '7030A0' }
  };

  // Add user workflow data
  const workflowsData = [
    {
      workflowName: 'Process Order',
      actor: 'Barista',
      stepNumber: 1,
      action: 'View pending orders',
      frontendComponent: 'PendingOrdersSection',
      backendRoute: '/api/orders/pending',
      notes: 'Lists all orders waiting to be prepared'
    },
    {
      workflowName: 'Process Order',
      actor: 'Barista',
      stepNumber: 2,
      action: 'Start preparing an order',
      frontendComponent: 'startOrder function',
      backendRoute: '/api/orders/{id}/start',
      notes: 'Moves order to in-progress status'
    },
    {
      workflowName: 'Process Order',
      actor: 'Barista',
      stepNumber: 3,
      action: 'Make the coffee',
      frontendComponent: 'N/A',
      backendRoute: 'N/A',
      notes: 'Physical action'
    },
    {
      workflowName: 'Process Order',
      actor: 'Barista',
      stepNumber: 4,
      action: 'Mark order as complete',
      frontendComponent: 'completeOrder function',
      backendRoute: '/api/orders/{id}/complete',
      notes: 'Triggers customer notification'
    },
    {
      workflowName: 'Batch Processing',
      actor: 'Barista',
      stepNumber: 1,
      action: 'Select batch mode',
      frontendComponent: 'toggleBatchMode function',
      backendRoute: 'N/A',
      notes: 'Enables multi-select of orders'
    },
    {
      workflowName: 'Batch Processing',
      actor: 'Barista',
      stepNumber: 2,
      action: 'Select multiple orders',
      frontendComponent: 'toggleOrderSelection function',
      backendRoute: 'N/A',
      notes: 'Builds set of selected order IDs'
    },
    {
      workflowName: 'Batch Processing',
      actor: 'Barista',
      stepNumber: 3,
      action: 'Process selected orders',
      frontendComponent: 'processBatchSelection function',
      backendRoute: '/api/orders/batch',
      notes: 'Updates multiple orders at once'
    },
    {
      workflowName: 'Add Walk-in Order',
      actor: 'Barista',
      stepNumber: 1,
      action: 'Open walk-in dialog',
      frontendComponent: 'WalkInOrderDialog',
      backendRoute: 'N/A',
      notes: 'Opens dialog to enter order details'
    },
    {
      workflowName: 'Add Walk-in Order',
      actor: 'Barista',
      stepNumber: 2,
      action: 'Submit order details',
      frontendComponent: 'handleWalkInOrder function',
      backendRoute: '/api/orders/walk-in',
      notes: 'Creates new order in the system'
    },
    {
      workflowName: 'Customer SMS Order',
      actor: 'Customer',
      stepNumber: 1,
      action: 'Send order text message',
      frontendComponent: 'N/A',
      backendRoute: '/sms',
      notes: 'Customer texts their order'
    },
    {
      workflowName: 'Customer SMS Order',
      actor: 'System',
      stepNumber: 2,
      action: 'Process order text',
      frontendComponent: 'N/A',
      backendRoute: '/sms',
      notes: 'NLP service extracts order details'
    },
    {
      workflowName: 'Customer SMS Order',
      actor: 'System',
      stepNumber: 3,
      action: 'Create order in system',
      frontendComponent: 'N/A',
      backendRoute: 'coffee_system.create_order',
      notes: 'Creates pending order'
    },
    {
      workflowName: 'Customer SMS Order',
      actor: 'System',
      stepNumber: 4,
      action: 'Send confirmation text',
      frontendComponent: 'N/A',
      backendRoute: 'messaging.send_order_confirmation',
      notes: 'Confirms order with customer'
    }
  ];

  // Add user workflow data to sheet
  workflowsSheet.addRows(workflowsData);

  // =====================================================
  // Dependencies Sheet
  // =====================================================
  const dependenciesSheet = workbook.addWorksheet('Dependencies', {
    properties: { tabColor: { argb: '4472C4' } },
    views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }]
  });

  // Define columns
  dependenciesSheet.columns = [
    { header: 'Package Name', key: 'packageName', width: 30 },
    { header: 'Version', key: 'version', width: 15 },
    { header: 'Purpose', key: 'purpose', width: 40 },
    { header: 'Used By', key: 'usedBy', width: 30 },
    { header: 'Installation Notes', key: 'installationNotes', width: 30 },
    { header: 'Alternatives', key: 'alternatives', width: 20 },
    { header: 'Notes', key: 'notes', width: 30 }
  ];

  // Style the header row
  dependenciesSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFF' } };
  dependenciesSheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: '4472C4' }
  };

  // Add dependencies data
  const dependenciesData = [
    {
      packageName: 'React',
      version: '^18.2.0',
      purpose: 'Frontend UI library',
      usedBy: 'All frontend components',
      installationNotes: 'npm install react react-dom',
      alternatives: 'Vue, Angular',
      notes: 'Core UI framework'
    },
    {
      packageName: 'Flask',
      version: '^2.0.0',
      purpose: 'Backend web framework',
      usedBy: 'app.py and all routes',
      installationNotes: 'pip install Flask',
      alternatives: 'Django, FastAPI',
      notes: 'Core backend framework'
    },
    {
      packageName: 'Flask-JWT-Extended',
      version: '^4.0.0',
      purpose: 'JWT authentication for Flask',
      usedBy: 'auth.py',
      installationNotes: 'pip install flask-jwt-extended',
      alternatives: 'PyJWT with custom implementation',
      notes: 'Handles JWT auth'
    },
    {
      packageName: 'psycopg2',
      version: '^2.9.0',
      purpose: 'PostgreSQL adapter for Python',
      usedBy: 'database.py',
      installationNotes: 'pip install psycopg2-binary',
      alternatives: 'SQLAlchemy',
      notes: 'Database driver'
    },
    {
      packageName: 'Twilio',
      version: '^7.0.0',
      purpose: 'SMS service integration',
      usedBy: 'messaging.py',
      installationNotes: 'pip install twilio',
      alternatives: 'Custom SMS gateway',
      notes: 'For customer notifications'
    },
    {
      packageName: 'lucide-react',
      version: '^0.263.1',
      purpose: 'Icon library',
      usedBy: 'All frontend components',
      installationNotes: 'npm install lucide-react',
      alternatives: 'react-icons, @heroicons/react',
      notes: 'UI icons'
    },
    {
      packageName: 'Papa Parse',
      version: '^5.0.0',
      purpose: 'CSV parsing library',
      usedBy: 'Various components',
      installationNotes: 'npm install papaparse',
      alternatives: 'csv-parse',
      notes: 'For CSV data handling'
    },
    {
      packageName: 'eventlet',
      version: '^0.33.0',
      purpose: 'Concurrent networking library',
      usedBy: 'app.py, websocket.py',
      installationNotes: 'pip install eventlet',
      alternatives: 'gevent',
      notes: 'For WebSocket support'
    },
    {
      packageName: 'qrcode',
      version: '^7.3.1',
      purpose: 'QR code generation',
      usedBy: 'messaging.py',
      installationNotes: 'pip install qrcode[pil]',
      alternatives: 'pyqrcode',
      notes: 'For order QR codes'
    }
  ];

  // Add dependencies data to sheet
  dependenciesSheet.addRows(dependenciesData);

  // =====================================================
  // Version History Sheet
  // =====================================================
  const versionHistorySheet = workbook.addWorksheet('Version History', {
    properties: { tabColor: { argb: 'C00000' } },
    views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }]
  });

  // Define columns
  versionHistorySheet.columns = [
    { header: 'Version', key: 'version', width: 15 },
    { header: 'Date', key: 'date', width: 20 },
    { header: 'Author', key: 'author', width: 20 },
    { header: 'Description', key: 'description', width: 60 },
    { header: 'Major Changes', key: 'majorChanges', width: 50 }
  ];

  // Style the header row
  versionHistorySheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFF' } };
  versionHistorySheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'C00000' }
  };

  // Add version history data
  const versionHistoryData = [
    {
      version: '1.0.0',
      date: new Date().toISOString().split('T')[0],
      author: 'Coffee Cue Team',
      description: 'Initial documentation structure',
      majorChanges: 'Created Excel documentation'
    }
  ];

  // Add version history data to sheet
  versionHistorySheet.addRows(versionHistoryData);

  // Save the workbook
  await workbook.xlsx.writeFile('CoffeeCueSystemDocumentation.xlsx');
  console.log('Excel workbook saved as CoffeeCueSystemDocumentation.xlsx');
}

// Check if ExcelJS is installed, if not provide installation instructions
try {
  require.resolve('exceljs');
  generateDocumentation()
    .then(() => console.log('Documentation generation complete!'))
    .catch(err => console.error('Error generating documentation:', err));
} catch (e) {
  console.error('\nExcelJS library is required to run this script.');
  console.log('\nPlease install it using npm:');
  console.log('\n    npm install exceljs');
  console.log('\nThen run this script again:');
  console.log('\n    node generate-documentation.js\n');
}
