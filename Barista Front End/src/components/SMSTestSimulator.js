import React, { useState, useEffect } from 'react';
import { 
  MessageSquare, Send, Users, Crown, Clock, Calendar,
  Coffee, CheckCircle, AlertCircle, Info, Package,
  Activity, Settings, Play, RefreshCw, Phone, Globe
} from 'lucide-react';
import ApiService from '../services/ApiService';
import OrderDataService from '../services/OrderDataService';
import StationsService from '../services/StationsService';

const SMSTestSimulator = () => {
  // Test Configuration
  const [testConfig, setTestConfig] = useState({
    // Customer Details
    customerPhone: '+1234567890',
    customerName: 'Test Customer',
    isVIP: false,
    isGroupOrder: false,
    groupSize: 1,
    language: 'en',
    
    // Order Details
    orderType: 'coffee',
    coffeeType: 'latte',
    size: 'medium',
    milkType: 'almond',
    extras: [],
    quantity: 1,
    specialInstructions: '',
    
    // System Configuration
    testDateTime: (() => {
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      const hours = String(now.getHours()).padStart(2, '0');
      const minutes = String(now.getMinutes()).padStart(2, '0');
      return `${year}-${month}-${day}T${hours}:${minutes}`;
    })(),
    simulateDelay: true,
    delaySeconds: 2,
    testStockLevels: 'normal', // 'normal', 'low', 'critical', 'out'
    activeStations: 'all', // 'all', 'some', 'none'
    selectedStations: [],
    
    // Event Settings
    eventName: 'Test Event',
    eventPhase: 'peak', // 'opening', 'normal', 'peak', 'closing'
    queueLength: 5,
    estimatedWaitTime: 15
  });
  
  // Test Results
  const [testResults, setTestResults] = useState({
    stages: [],
    currentStage: null,
    isRunning: false,
    success: false,
    error: null
  });
  
  // Available Options
  const [menuItems, setMenuItems] = useState([]);
  const [stations, setStations] = useState([]);
  const [availableMilk, setAvailableMilk] = useState([]);
  const [smsSettings, setSmsSettings] = useState({});
  
  // Load initial data
  useEffect(() => {
    loadTestData();
  }, []);
  
  const loadTestData = async () => {
    try {
      // Load stations
      const stationsData = await StationsService.getStations();
      setStations(stationsData || []);
      
      // Load menu items
      const savedMenu = localStorage.getItem('event_menu');
      if (savedMenu) {
        const menu = JSON.parse(savedMenu);
        setMenuItems(Object.values(menu).filter(item => item.enabled));
      }
      
      // Load available milk types from inventory
      const inventory = localStorage.getItem('event_inventory');
      if (inventory) {
        const inv = JSON.parse(inventory);
        setAvailableMilk(inv.milk?.filter(m => m.enabled) || []);
      }
      
      // Load SMS settings
      const settings = localStorage.getItem('sms_settings');
      if (settings) {
        setSmsSettings(JSON.parse(settings));
      }
    } catch (error) {
      console.error('Error loading test data:', error);
    }
  };
  
  // Add test stage result
  const addTestStage = (stage, status, details) => {
    setTestResults(prev => ({
      ...prev,
      stages: [...prev.stages, {
        stage,
        status, // 'running', 'success', 'warning', 'error'
        details,
        timestamp: new Date() // Store as Date object for local display
      }],
      currentStage: stage
    }));
  };
  
  // Simulate SMS order flow
  const runSMSTest = async () => {
    setTestResults({
      stages: [],
      currentStage: null,
      isRunning: true,
      success: false,
      error: null
    });
    
    try {
      // Stage 1: SMS Reception
      addTestStage('SMS Reception', 'running', 'Simulating incoming SMS...');
      await simulateDelay();
      
      const smsContent = buildSMSContent();
      addTestStage('SMS Reception', 'success', {
        from: testConfig.customerPhone,
        message: smsContent,
        timestamp: testConfig.testDateTime
      });
      
      // Stage 2: Parse SMS
      addTestStage('SMS Parsing', 'running', 'Parsing order details...');
      await simulateDelay();
      
      const parsedOrder = parseSMSOrder(smsContent);
      addTestStage('SMS Parsing', 'success', {
        parsed: parsedOrder,
        confidence: '95%'
      });
      
      // Stage 3: Check Customer Status
      addTestStage('Customer Verification', 'running', 'Checking customer status...');
      await simulateDelay();
      
      addTestStage('Customer Verification', 'success', {
        isVIP: testConfig.isVIP,
        previousOrders: Math.floor(Math.random() * 50),
        loyaltyPoints: Math.floor(Math.random() * 1000)
      });
      
      // Stage 4: Check Stock Availability
      addTestStage('Stock Check', 'running', 'Verifying inventory levels...');
      await simulateDelay();
      
      const stockStatus = checkStockAvailability();
      addTestStage('Stock Check', stockStatus.hasStock ? 'success' : 'warning', stockStatus);
      
      // Stage 5: Station Selection
      addTestStage('Station Assignment', 'running', 'Finding available stations...');
      await simulateDelay();
      
      const stationAssignment = await assignStation();
      addTestStage('Station Assignment', stationAssignment.assigned ? 'success' : 'error', stationAssignment);
      
      if (!stationAssignment.assigned) {
        throw new Error('No stations available to handle order');
      }
      
      // Stage 6: Create Order
      addTestStage('Order Creation', 'running', 'Creating order in system...');
      await simulateDelay();
      
      const order = await createTestOrder(parsedOrder, stationAssignment.stationId);
      addTestStage('Order Creation', 'success', {
        orderId: order.id,
        orderNumber: order.orderNumber,
        status: 'pending'
      });
      
      // Stage 7: Send Confirmation SMS
      addTestStage('SMS Confirmation', 'running', 'Sending confirmation to customer...');
      await simulateDelay();
      
      const confirmationSMS = buildConfirmationSMS(order);
      addTestStage('SMS Confirmation', 'success', {
        to: testConfig.customerPhone,
        message: confirmationSMS,
        language: testConfig.language
      });
      
      // Stage 8: Station Notification
      addTestStage('Station Notification', 'running', 'Notifying assigned station...');
      await simulateDelay();
      
      addTestStage('Station Notification', 'success', {
        stationId: stationAssignment.stationId,
        stationName: stationAssignment.stationName,
        notificationType: 'websocket',
        priority: testConfig.isVIP ? 'high' : 'normal'
      });
      
      // Stage 9: Queue Management
      addTestStage('Queue Management', 'running', 'Calculating wait time...');
      await simulateDelay();
      
      const queueInfo = calculateQueueInfo();
      addTestStage('Queue Management', 'success', queueInfo);
      
      // Stage 10: Test Complete
      setTestResults(prev => ({
        ...prev,
        isRunning: false,
        success: true,
        currentStage: null
      }));
      
    } catch (error) {
      console.error('Test failed:', error);
      addTestStage('Test Failed', 'error', error.message);
      setTestResults(prev => ({
        ...prev,
        isRunning: false,
        success: false,
        error: error.message,
        currentStage: null
      }));
    }
  };
  
  // Helper: Simulate delay
  const simulateDelay = () => {
    if (!testConfig.simulateDelay) return Promise.resolve();
    return new Promise(resolve => setTimeout(resolve, testConfig.delaySeconds * 1000));
  };
  
  // Helper: Build SMS content
  const buildSMSContent = () => {
    const { coffeeType, size, milkType, quantity, specialInstructions } = testConfig;
    let message = `${quantity > 1 ? quantity + ' ' : ''}${size} ${milkType} ${coffeeType}`;
    
    if (testConfig.extras.length > 0) {
      message += ` with ${testConfig.extras.join(', ')}`;
    }
    
    if (specialInstructions) {
      message += `. ${specialInstructions}`;
    }
    
    if (testConfig.isGroupOrder) {
      message = `GROUP ${testConfig.groupSize}: ${message}`;
    }
    
    return message;
  };
  
  // Helper: Parse SMS order
  const parseSMSOrder = (smsContent) => {
    return {
      customerPhone: testConfig.customerPhone,
      customerName: testConfig.customerName,
      items: [{
        type: testConfig.coffeeType,
        size: testConfig.size,
        milk: testConfig.milkType,
        extras: testConfig.extras,
        quantity: testConfig.quantity
      }],
      isGroup: testConfig.isGroupOrder,
      groupSize: testConfig.groupSize,
      isVIP: testConfig.isVIP,
      specialInstructions: testConfig.specialInstructions,
      parsedAt: new Date().toISOString()
    };
  };
  
  // Helper: Check stock availability
  const checkStockAvailability = () => {
    const stockLevel = testConfig.testStockLevels;
    const items = {
      coffee: stockLevel === 'out' ? 0 : stockLevel === 'critical' ? 0.5 : stockLevel === 'low' ? 2 : 5,
      milk: {
        [testConfig.milkType]: stockLevel === 'out' ? 0 : stockLevel === 'critical' ? 0.2 : stockLevel === 'low' ? 1 : 5
      },
      cups: {
        [testConfig.size]: stockLevel === 'out' ? 0 : stockLevel === 'critical' ? 5 : stockLevel === 'low' ? 20 : 100
      }
    };
    
    const hasStock = items.coffee > 0 && items.milk[testConfig.milkType] > 0 && items.cups[testConfig.size] > 0;
    
    return {
      hasStock,
      items,
      warnings: stockLevel === 'low' || stockLevel === 'critical' ? [`${stockLevel} stock levels`] : []
    };
  };
  
  // Helper: Assign station
  const assignStation = async () => {
    let availableStations = stations;
    
    if (testConfig.activeStations === 'some') {
      availableStations = stations.filter(s => testConfig.selectedStations.includes(s.id));
    } else if (testConfig.activeStations === 'none') {
      availableStations = [];
    }
    
    // Filter by capabilities
    availableStations = availableStations.filter(station => {
      // Check if station can make the drink
      return station.isActive && !station.isMaintenance;
    });
    
    if (availableStations.length === 0) {
      return { assigned: false, reason: 'No stations available' };
    }
    
    // Simple load balancing - pick station with least orders
    const selectedStation = availableStations[0];
    
    return {
      assigned: true,
      stationId: selectedStation.id,
      stationName: selectedStation.name,
      currentLoad: Math.floor(Math.random() * 10),
      estimatedPrepTime: 3 + Math.floor(Math.random() * 5)
    };
  };
  
  // Helper: Create test order
  const createTestOrder = async (parsedOrder, stationId) => {
    const order = {
      id: `TEST-${Date.now()}`,
      orderNumber: `T${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`,
      customerPhone: parsedOrder.customerPhone,
      customerName: parsedOrder.customerName,
      items: parsedOrder.items,
      status: 'pending',
      stationId: stationId,
      isVIP: parsedOrder.isVIP,
      isGroup: parsedOrder.isGroup,
      groupSize: parsedOrder.groupSize,
      createdAt: testConfig.testDateTime,
      estimatedCompletionTime: new Date(Date.now() + testConfig.estimatedWaitTime * 60000).toISOString()
    };
    
    // In a real implementation, this would call OrderDataService.createOrder()
    return order;
  };
  
  // Helper: Build confirmation SMS
  const buildConfirmationSMS = (order) => {
    const messages = {
      en: `Order ${order.orderNumber} confirmed! Estimated wait: ${testConfig.estimatedWaitTime} mins. We'll SMS when ready.`,
      es: `Pedido ${order.orderNumber} confirmado! Espera estimada: ${testConfig.estimatedWaitTime} mins. Te avisaremos por SMS.`,
      fr: `Commande ${order.orderNumber} confirmée! Attente estimée: ${testConfig.estimatedWaitTime} mins. SMS à la fin.`
    };
    
    return messages[testConfig.language] || messages.en;
  };
  
  // Helper: Calculate queue info
  const calculateQueueInfo = () => {
    const baseWait = testConfig.estimatedWaitTime;
    const eventMultiplier = {
      opening: 0.5,
      normal: 1,
      peak: 1.5,
      closing: 0.8
    };
    
    const adjustedWait = Math.round(baseWait * eventMultiplier[testConfig.eventPhase]);
    
    return {
      queueLength: testConfig.queueLength,
      position: testConfig.queueLength + 1,
      estimatedWaitTime: adjustedWait,
      eventPhase: testConfig.eventPhase,
      rushStatus: testConfig.eventPhase === 'peak' ? 'high' : 'normal'
    };
  };
  
  return (
    <div className="bg-white rounded-lg shadow-lg p-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-gray-800 flex items-center">
          <MessageSquare className="mr-3 text-blue-600" />
          SMS Order Test Simulator
        </h2>
        <button
          onClick={runSMSTest}
          disabled={testResults.isRunning}
          className={`px-6 py-2 rounded-md flex items-center ${
            testResults.isRunning 
              ? 'bg-gray-300 cursor-not-allowed' 
              : 'bg-green-500 hover:bg-green-600 text-white'
          }`}
        >
          {testResults.isRunning ? (
            <>
              <RefreshCw className="mr-2 animate-spin" size={20} />
              Running Test...
            </>
          ) : (
            <>
              <Play className="mr-2" size={20} />
              Run Test
            </>
          )}
        </button>
      </div>
      
      <div className="grid grid-cols-2 gap-6">
        {/* Test Configuration */}
        <div className="space-y-6">
          {/* Customer Configuration */}
          <div className="bg-gray-50 p-4 rounded-lg">
            <h3 className="text-lg font-semibold mb-4 flex items-center">
              <Users className="mr-2 text-gray-600" size={20} />
              Customer Configuration
            </h3>
            
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Phone Number
                </label>
                <input
                  type="tel"
                  value={testConfig.customerPhone}
                  onChange={(e) => setTestConfig({...testConfig, customerPhone: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Customer Name
                </label>
                <input
                  type="text"
                  value={testConfig.customerName}
                  onChange={(e) => setTestConfig({...testConfig, customerName: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                />
              </div>
              
              <div className="flex items-center space-x-4">
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={testConfig.isVIP}
                    onChange={(e) => setTestConfig({...testConfig, isVIP: e.target.checked})}
                    className="mr-2"
                  />
                  <Crown className="mr-1 text-yellow-500" size={16} />
                  VIP Customer
                </label>
                
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={testConfig.isGroupOrder}
                    onChange={(e) => setTestConfig({...testConfig, isGroupOrder: e.target.checked})}
                    className="mr-2"
                  />
                  Group Order
                </label>
              </div>
              
              {testConfig.isGroupOrder && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Group Size
                  </label>
                  <input
                    type="number"
                    min="2"
                    value={testConfig.groupSize}
                    onChange={(e) => setTestConfig({...testConfig, groupSize: parseInt(e.target.value) || 2})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  />
                </div>
              )}
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <Globe className="inline mr-1" size={16} />
                  Language
                </label>
                <select
                  value={testConfig.language}
                  onChange={(e) => setTestConfig({...testConfig, language: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                >
                  <option value="en">English</option>
                  <option value="es">Spanish</option>
                  <option value="fr">French</option>
                </select>
              </div>
            </div>
          </div>
          
          {/* Order Configuration */}
          <div className="bg-gray-50 p-4 rounded-lg">
            <h3 className="text-lg font-semibold mb-4 flex items-center">
              <Coffee className="mr-2 text-gray-600" size={20} />
              Order Details
            </h3>
            
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Coffee Type
                </label>
                <select
                  value={testConfig.coffeeType}
                  onChange={(e) => setTestConfig({...testConfig, coffeeType: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                >
                  {menuItems.map(item => (
                    <option key={item.id} value={item.id}>{item.name}</option>
                  ))}
                </select>
              </div>
              
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Size
                  </label>
                  <select
                    value={testConfig.size}
                    onChange={(e) => setTestConfig({...testConfig, size: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  >
                    <option value="small">Small</option>
                    <option value="medium">Medium</option>
                    <option value="large">Large</option>
                  </select>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Quantity
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={testConfig.quantity}
                    onChange={(e) => setTestConfig({...testConfig, quantity: parseInt(e.target.value) || 1})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  />
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Milk Type
                </label>
                <select
                  value={testConfig.milkType}
                  onChange={(e) => setTestConfig({...testConfig, milkType: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                >
                  {availableMilk.map(milk => (
                    <option key={milk.id} value={milk.name.toLowerCase()}>
                      {milk.name}
                    </option>
                  ))}
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Special Instructions
                </label>
                <textarea
                  value={testConfig.specialInstructions}
                  onChange={(e) => setTestConfig({...testConfig, specialInstructions: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  rows="2"
                  placeholder="e.g., Extra hot, no foam..."
                />
              </div>
            </div>
          </div>
          
          {/* System Configuration */}
          <div className="bg-gray-50 p-4 rounded-lg">
            <h3 className="text-lg font-semibold mb-4 flex items-center">
              <Settings className="mr-2 text-gray-600" size={20} />
              System Configuration
            </h3>
            
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <Calendar className="inline mr-1" size={16} />
                  Test Date/Time (Local)
                </label>
                <input
                  type="datetime-local"
                  value={(() => {
                    // Convert ISO string back to local datetime-local format
                    const date = new Date(testConfig.testDateTime);
                    const year = date.getFullYear();
                    const month = String(date.getMonth() + 1).padStart(2, '0');
                    const day = String(date.getDate()).padStart(2, '0');
                    const hours = String(date.getHours()).padStart(2, '0');
                    const minutes = String(date.getMinutes()).padStart(2, '0');
                    return `${year}-${month}-${day}T${hours}:${minutes}`;
                  })()}
                  onChange={(e) => {
                    // Keep the local time as entered without timezone conversion
                    const localDate = e.target.value;
                    setTestConfig({...testConfig, testDateTime: localDate});
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <Package className="inline mr-1" size={16} />
                  Stock Levels
                </label>
                <select
                  value={testConfig.testStockLevels}
                  onChange={(e) => setTestConfig({...testConfig, testStockLevels: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                >
                  <option value="normal">Normal</option>
                  <option value="low">Low</option>
                  <option value="critical">Critical</option>
                  <option value="out">Out of Stock</option>
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Active Stations
                </label>
                <select
                  value={testConfig.activeStations}
                  onChange={(e) => setTestConfig({...testConfig, activeStations: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                >
                  <option value="all">All Stations</option>
                  <option value="some">Selected Stations</option>
                  <option value="none">No Stations</option>
                </select>
              </div>
              
              {testConfig.activeStations === 'some' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Select Stations
                  </label>
                  <div className="space-y-2 max-h-32 overflow-y-auto border border-gray-200 rounded p-2">
                    {stations.map(station => (
                      <label key={station.id} className="flex items-center">
                        <input
                          type="checkbox"
                          checked={testConfig.selectedStations.includes(station.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setTestConfig({
                                ...testConfig,
                                selectedStations: [...testConfig.selectedStations, station.id]
                              });
                            } else {
                              setTestConfig({
                                ...testConfig,
                                selectedStations: testConfig.selectedStations.filter(id => id !== station.id)
                              });
                            }
                          }}
                          className="mr-2"
                        />
                        {station.name}
                      </label>
                    ))}
                  </div>
                </div>
              )}
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Event Phase
                </label>
                <select
                  value={testConfig.eventPhase}
                  onChange={(e) => setTestConfig({...testConfig, eventPhase: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                >
                  <option value="opening">Opening (Low Traffic)</option>
                  <option value="normal">Normal</option>
                  <option value="peak">Peak Hours</option>
                  <option value="closing">Closing</option>
                </select>
              </div>
              
              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="simulateDelay"
                  checked={testConfig.simulateDelay}
                  onChange={(e) => setTestConfig({...testConfig, simulateDelay: e.target.checked})}
                  className="mr-2"
                />
                <label htmlFor="simulateDelay" className="text-sm text-gray-700">
                  Simulate Processing Delays ({testConfig.delaySeconds}s per stage)
                </label>
              </div>
            </div>
          </div>
        </div>
        
        {/* Test Results */}
        <div className="bg-gray-50 rounded-lg p-4">
          <h3 className="text-lg font-semibold mb-4 flex items-center">
            <Activity className="mr-2 text-gray-600" size={20} />
            Test Results
          </h3>
          
          {testResults.stages.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <MessageSquare size={48} className="mx-auto mb-4 text-gray-300" />
              <p>Configure test parameters and click "Run Test" to begin</p>
            </div>
          ) : (
            <div className="space-y-3 max-h-[600px] overflow-y-auto">
              {testResults.stages.map((stage, index) => (
                <div
                  key={index}
                  className={`p-3 rounded-md border ${
                    stage.status === 'running' ? 'bg-blue-50 border-blue-200' :
                    stage.status === 'success' ? 'bg-green-50 border-green-200' :
                    stage.status === 'warning' ? 'bg-yellow-50 border-yellow-200' :
                    stage.status === 'error' ? 'bg-red-50 border-red-200' :
                    'bg-gray-50 border-gray-200'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-start">
                      {stage.status === 'running' && <RefreshCw className="mr-2 mt-0.5 animate-spin text-blue-500" size={16} />}
                      {stage.status === 'success' && <CheckCircle className="mr-2 mt-0.5 text-green-500" size={16} />}
                      {stage.status === 'warning' && <AlertCircle className="mr-2 mt-0.5 text-yellow-500" size={16} />}
                      {stage.status === 'error' && <AlertCircle className="mr-2 mt-0.5 text-red-500" size={16} />}
                      
                      <div className="flex-1">
                        <h4 className="font-medium text-gray-800">{stage.stage}</h4>
                        {typeof stage.details === 'string' ? (
                          <p className="text-sm text-gray-600 mt-1">{stage.details}</p>
                        ) : (
                          <div className="text-sm text-gray-600 mt-1">
                            <pre className="whitespace-pre-wrap font-mono text-xs bg-white bg-opacity-50 p-2 rounded mt-1">
                              {JSON.stringify(stage.details, null, 2)}
                            </pre>
                          </div>
                        )}
                      </div>
                    </div>
                    <span className="text-xs text-gray-500">
                      {stage.timestamp.toLocaleTimeString()}
                    </span>
                  </div>
                </div>
              ))}
              
              {testResults.success && (
                <div className="mt-4 p-4 bg-green-100 border border-green-300 rounded-md">
                  <h4 className="font-semibold text-green-800 flex items-center">
                    <CheckCircle className="mr-2" size={20} />
                    Test Completed Successfully
                  </h4>
                  <p className="text-sm text-green-700 mt-1">
                    All stages passed. The order would be successfully processed.
                  </p>
                </div>
              )}
              
              {testResults.error && (
                <div className="mt-4 p-4 bg-red-100 border border-red-300 rounded-md">
                  <h4 className="font-semibold text-red-800 flex items-center">
                    <AlertCircle className="mr-2" size={20} />
                    Test Failed
                  </h4>
                  <p className="text-sm text-red-700 mt-1">{testResults.error}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      
      {/* Test Summary */}
      {testResults.stages.length > 0 && !testResults.isRunning && (
        <div className="mt-6 p-4 bg-blue-50 rounded-lg">
          <h4 className="font-semibold text-blue-800 mb-2">Test Summary</h4>
          <div className="grid grid-cols-4 gap-4 text-sm">
            <div>
              <span className="text-gray-600">Total Stages:</span>
              <span className="ml-2 font-medium">{testResults.stages.length}</span>
            </div>
            <div>
              <span className="text-gray-600">Successful:</span>
              <span className="ml-2 font-medium text-green-600">
                {testResults.stages.filter(s => s.status === 'success').length}
              </span>
            </div>
            <div>
              <span className="text-gray-600">Warnings:</span>
              <span className="ml-2 font-medium text-yellow-600">
                {testResults.stages.filter(s => s.status === 'warning').length}
              </span>
            </div>
            <div>
              <span className="text-gray-600">Errors:</span>
              <span className="ml-2 font-medium text-red-600">
                {testResults.stages.filter(s => s.status === 'error').length}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SMSTestSimulator;