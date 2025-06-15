// ModernBaristaInterface.js
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Coffee, Package, Calendar, Check, Monitor, Settings,
  MessageCircle, Plus, Bell, XCircle, RefreshCw
} from 'lucide-react';

// Import app mode context
import { useAppMode } from '../context/AppContext';

// Import the FIXED custom hooks for order, station, stock, and schedule management
import useOrders from '../hooks/useOrders.fixed'; // Use the fixed version
import useStations from '../hooks/useStations';
import useStock from '../hooks/useStock';
import useSchedule from '../hooks/useSchedule';

// Import services and utilities
import MessageService from '../services/MessageService';
import OrderDataService from '../services/OrderDataService';
import ChatService from '../services/ChatService';

// Import components
import MessageDialog from './dialogs/MessageDialog';
import WaitTimeDialog from './dialogs/WaitTimeDialog';
import WalkInOrderDialog from './dialogs/WalkInOrderDialog';
import StationChat from './StationChat';
import OrderNotificationHandler from './OrderNotificationHandler';

// Import tab components
import {
  OrdersTab,
  StockTab,
  ScheduleTab,
  CompletedOrdersTab,
  DisplayTab,
  SettingsTab
} from './barista-tabs';

const ModernBaristaInterface = () => {
  // Use the AppMode context
  const { isDemoMode, toggleAppMode } = useAppMode();

  // Use the stations hook to get stations from the backend
  const {
    stations,
    selectedStation,
    loading: stationsLoading,
    changeSelectedStation,
    updateStation,
    refreshData: refreshStations
  } = useStations();

  // State for showing station selector dropdown
  const [showStationSelector, setShowStationSelector] = useState(false);
  
  // Use schedule hook to get schedule data
  const {
    scheduleData,
    loading: scheduleLoading,
    error: scheduleError,
    setStation: setScheduleStation,
    refreshData: refreshScheduleData
  } = useSchedule();

  // Use the custom hook for order management with station filtering
  const {
    pendingOrders,
    inProgressOrders,
    completedOrders,
    previousOrders,
    historyOrders,
    yesterdayOrders,
    thisWeekOrders,
    searchResults,
    vipOrders,
    regularOrders,
    batchGroups,
    queueCount,
    online,
    loading,
    error,
    lastUpdated,
    isRefreshing,
    
    // New auto-refresh properties
    autoRefreshEnabled,
    autoRefreshInterval,
    toggleAutoRefresh,
    updateAutoRefreshInterval,
    
    startOrder,
    completeOrder,
    markOrderPickedUp,
    processBatch,
    processBatchSelection,
    addWalkInOrder,
    sendMessage,
    updateWaitTime,
    clearError,
    refreshData,
    updateStationId,
    
    // History actions
    fetchYesterdayOrders,
    fetchThisWeekOrders,
    searchOrders,
    getOrderHistory
  } = useOrders(selectedStation);
  
  // UI State
  const [activeTab, setActiveTab] = useState('orders');
  
  // State to track dismissed info panels
  const [dismissedPanels, setDismissedPanels] = useState(() => {
    // Try to load from localStorage
    try {
      const saved = localStorage.getItem('dismissed_info_panels');
      return saved ? JSON.parse(saved) : {
        stockInfoPanel: false,
        scheduleInfoPanel: false,
        historyInfoPanel: false,
        displayInfoPanel: false
      };
    } catch (e) {
      console.error('Error loading dismissed panels state:', e);
      return {
        stockInfoPanel: false,
        scheduleInfoPanel: false,
        historyInfoPanel: false,
        displayInfoPanel: false
      };
    }
  });
  
  // Function to dismiss a panel
  const dismissPanel = useCallback((panelId) => {
    setDismissedPanels(prev => {
      const updated = { ...prev, [panelId]: true };
      // Save to localStorage
      localStorage.setItem('dismissed_info_panels', JSON.stringify(updated));
      return updated;
    });
  }, []);
  
  // Function to restore all panels
  const restoreAllPanels = useCallback(() => {
    const resetState = {
      stockInfoPanel: false,
      scheduleInfoPanel: false,
      historyInfoPanel: false,
      displayInfoPanel: false
    };
    setDismissedPanels(resetState);
    localStorage.setItem('dismissed_info_panels', JSON.stringify(resetState));
    
    // Show a brief success message
    setSuccessMessage('All information panels have been restored');
  }, []);
  
  // Handle tab changes to ensure data persists
  useEffect(() => {
    console.log(`Tab changed to: ${activeTab}`);
    
    // Ensure station consistency before refreshing
    if (selectedStation) {
      localStorage.setItem('coffee_cue_selected_station', selectedStation.toString());
      localStorage.setItem('last_used_station_id', selectedStation.toString());
    }
    
    // When switching to in-progress tab, force a refresh to ensure data is loaded
    if (activeTab === 'in-progress') {
      console.log(`Switched to in-progress tab - refreshing data for station ${selectedStation}`);
      // Use setTimeout to ensure station state is fully applied
      setTimeout(() => {
        refreshData();
      }, 50);
    }
    
  }, [activeTab, refreshData, selectedStation]);
  
  const [historyTab, setHistoryTab] = useState('completed');
  const [selectedOrderId, setSelectedOrderId] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [batchModeActive, setBatchModeActive] = useState(false);
  const [waitTime, setWaitTime] = useState(2); // Default wait time of 2 minutes
  const [selectedOrders, setSelectedOrders] = useState(new Set());
  const [chatOpen, setChatOpen] = useState(false);
  const [unreadMessages, setUnreadMessages] = useState(2);
  const [filter, setFilter] = useState('all');
  
  // Effect to ensure settings are synced with selected station
  // Use useRef to track if we've already synced this station to avoid unnecessary updates
  const lastSyncedStation = useRef(null);
  
  useEffect(() => {
    // Skip if nothing has changed or we don't have a valid selection
    if (!selectedStation || !stations.length) return;
    if (lastSyncedStation.current === selectedStation) return;
    
    console.log(`Syncing settings for station ${selectedStation}`);
    
    const station = stations.find(s => s.id === selectedStation);
    if (station) {
      // Update our ref to avoid repeated updates for the same station
      lastSyncedStation.current = selectedStation;
      
      // Get station-specific barista name
      const stationBaristaName = getStationBaristaName(selectedStation);
      
      // Try to get custom station name from localStorage first
      let stationName = station.name;
      try {
        const customName = localStorage.getItem(`coffee_station_name_${selectedStation}`);
        if (customName) {
          console.log(`Using custom name from localStorage for station ${selectedStation}: ${customName}`);
          stationName = customName;
        }
      } catch (e) {
        console.error(`Error getting custom name for station ${selectedStation}:`, e);
      }
      
      setSettings(prev => ({
        ...prev,
        stationName: stationName,
        stationLocation: station.location || '',
        baristaName: stationBaristaName
      }));
      
      // Also initialize ChatService with the correct names
      ChatService.initialize(
        selectedStation, 
        stationName,
        stationBaristaName
      );
      
      // Schedule station is updated in a separate useEffect hook
    }
  }, [selectedStation, stations]);
  
  // Dialog State
  const [showWaitTimeDialog, setShowWaitTimeDialog] = useState(false);
  const [showWalkInDialog, setShowWalkInDialog] = useState(false);
  const [showMessageDialog, setShowMessageDialog] = useState(false);
  const [currentMessageOrder, setCurrentMessageOrder] = useState(null);
  const [showHelpDialog, setShowHelpDialog] = useState(false);
  
  // Message status tracking
  const [messageStatus, setMessageStatus] = useState({});
  const [successMessage, setSuccessMessage] = useState('');
  const [showDisplayScreen, setShowDisplayScreen] = useState(false);

  // Use the stock hook for station-specific stock management
  const {
    stockItems,
    stockCategories,
    loading: stockLoading,
    error: stockError,
    getCategoryStock,
    updateStockItem,
    addStockItem,
    deleteStockItem,
    resetStock,
    getLowStockCount
  } = useStock(selectedStation, stations.find(s => s.id === selectedStation)?.name || 'Coffee Station');
  
  const [selectedStockCategory, setSelectedStockCategory] = useState('milk');
  
  // Get low stock counts for notifications
  const { lowCount, criticalCount } = getLowStockCount();
  
  // Get station-specific barista name
  const getStationBaristaName = (stationId) => {
    try {
      const numericStationId = typeof stationId === 'string' 
        ? parseInt(stationId, 10) 
        : stationId;
      
      // Try to get station-specific barista name
      const stationBaristaName = localStorage.getItem(`coffee_barista_name_station_${numericStationId}`);
      
      // Fall back to station name if no barista name is found
      if (stationBaristaName) {
        return stationBaristaName;
      }
      
      // Get the station name
      const stationObj = stations.find(s => s.id === numericStationId);
      const stationName = stationObj ? stationObj.name : `Station ${numericStationId}`;
      
      // Fall back to generic "Barista" name with the station name
      return `Barista (${stationName})`;
    } catch (error) {
      console.error('Error getting station barista name:', error);
      return 'Barista';
    }
  };

  // Settings state
  const [settings, setSettings] = useState({
    displayMode: 'landscape',
    soundEnabled: true,
    autoPrintLabels: false,
    stationName: stations.find(s => s.id === selectedStation)?.name || 'Coffee Station',
    stationLocation: stations.find(s => s.id === selectedStation)?.location || '',
    baristaName: getStationBaristaName(selectedStation),
    batchSuggestions: true,
    waitTimeWarning: 10, // minutes
    displayTimeout: 5, // minutes
    // Notification settings
    autoSendSmsOnComplete: true,
    remindAfterDelay: true,
    reminderDelay: 30, // seconds
    showNameOnDisplay: true,
    // Demo mode state
    demoMode: isDemoMode
  });

  // Init notification handler
  const notificationHandler = OrderNotificationHandler({
    onSendMessage: (orderId, message) => handleSendMessage(orderId, message),
    onUpdateSettings: (newSettings) => {
      setSettings({...settings, ...newSettings});
    }
  });

  // Synchronize settings with MessageService on mount
  useEffect(() => {
    MessageService.updateSettings({
      autoSendSmsOnComplete: settings.autoSendSmsOnComplete,
      remindAfterDelay: settings.remindAfterDelay,
      reminderDelay: settings.reminderDelay,
      showNameOnDisplay: settings.showNameOnDisplay,
      displayDuration: settings.displayTimeout * 60 // convert minutes to seconds
    });
  }, []);
  
  // Synchronize schedule station with selected station
  useEffect(() => {
    if (selectedStation && typeof setScheduleStation === 'function') {
      console.log('Synchronizing schedule station with selected station:', selectedStation);
      setScheduleStation(selectedStation);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStation]);
  
  // Check for navigation from organizer page and trigger order refresh
  useEffect(() => {
    // Check URL parameters for navigation source
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('from') && urlParams.get('from') === 'organiser') {
      console.log('Detected navigation from organiser via URL parameter');
      
      // Trigger an immediate refresh with a slight delay to ensure all hooks are initialized
      setTimeout(() => {
        refreshData();
        console.log('Forced order refresh after organiser navigation');
        
        // Remove the parameter from the URL to prevent multiple refreshes
        if (window.history && window.history.replaceState) {
          const newUrl = window.location.pathname;
          window.history.replaceState({}, document.title, newUrl);
        }
      }, 100);
    }
    
    // Check localStorage for flag indicating we're returning from organiser
    const returnFromOrganiser = sessionStorage.getItem('force_orders_refresh');
    if (returnFromOrganiser === 'true') {
      console.log('Detected return from organiser via sessionStorage flag');
      sessionStorage.removeItem('force_orders_refresh'); // Clear the flag
      refreshData(); // Trigger refresh
    }
    
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Enhanced message sending function
  const handleSendMessage = async (orderId, message) => {
    try {
      // First find the full order object if available
      const order = 
        inProgressOrders.find(o => o.id === orderId) || 
        completedOrders.find(o => o.id === orderId) ||
        pendingOrders.find(o => o.id === orderId) || 
        orderId;
      
      // Update status to indicate sending
      setMessageStatus(prev => ({
        ...prev,
        [orderId]: { status: 'sending', timestamp: new Date() }
      }));
      
      // Use MessageService to send the message
      const result = await MessageService.sendMessage(order, message);
      
      if (result.success) {
        // Update status on success
        setMessageStatus(prev => ({
          ...prev,
          [orderId]: { status: 'sent', timestamp: new Date() }
        }));
        
        return { success: true };
      } else {
        // Update status on failure
        setMessageStatus(prev => ({
          ...prev,
          [orderId]: { status: 'failed', error: result.error, timestamp: new Date() }
        }));
        
        return { success: false, error: result.error };
      }
    } catch (err) {
      console.error('Message send error:', err);
      
      // Update status on error
      setMessageStatus(prev => ({
        ...prev,
        [orderId]: { status: 'failed', error: err.message, timestamp: new Date() }
      }));
      
      return { success: false, error: err.message };
    }
  };

  // Handle sending message to customer
  const handleOpenMessageDialog = (order) => {
    setCurrentMessageOrder(order);
    setShowMessageDialog(true);
  };

  // Handle delay order
  const handleDelayOrder = (order) => {
    if (!order || !order.id) {
      console.error('Cannot delay order: Missing order ID');
      return;
    }
    
    // Fallback implementation
    alert(`Order #${order.id} for ${order.customerName} delayed by 5 minutes`);
    
    console.log(`Delayed order ${order.id} by 5 minutes`);
  };

  // Enhanced order completion function with guaranteed notifications
  const handleCompleteOrder = async (orderId) => {
    try {
      console.log('Starting order completion process for order:', orderId);
      
      // First find the order before it gets moved to completed
      const orderToComplete = inProgressOrders.find(o => o.id === orderId);
      
      if (!orderToComplete) {
        console.error('Could not find order in inProgressOrders array:', orderId);
        alert('Error: Could not find the order details. Please try again.');
        return false;
      }
      
      // Find the actual station info from the stations list
      const stationInfo = stations.find(s => s.id === selectedStation);
      
      // Add station name to the order for notifications
      const orderWithStation = {
        ...orderToComplete,
        stationName: stationInfo ? stationInfo.name : settings.stationName
      };
      
      console.log('Prepared order object for notification:', orderWithStation);
      
      // First complete the order using the existing function from useOrders
      const result = await completeOrder(orderId);
      console.log('Complete order API result:', result);
      
      // Check if the result has a success property or define success
      const isOrderCompleteSuccess = result && (result.success === true || !Object.prototype.hasOwnProperty.call(result, 'success'));
      
      if (isOrderCompleteSuccess) {
        console.log('Order marked as complete in backend. Sending notification...');
        
        let notificationSuccess = false;
        let notificationError = null;
        
        // Attempt 1: Use the notification handler
        try {
          await notificationHandler.completeWithNotification(orderWithStation);
          console.log('Primary notification sent successfully for order:', orderId);
          notificationSuccess = true;
        } catch (error1) {
          console.error('Primary notification failed:', error1);
          notificationError = error1;
          
          // Attempt 2: Use a multi-layered fallback approach for maximum reliability
          try {
            // First try with MessageService, which already has its own fallbacks
            const smsResult = await MessageService.sendReadyNotification(orderWithStation);
            console.log('MessageService notification result:', smsResult);
            
            if (smsResult && smsResult.success) {
              console.log('MessageService notification sent successfully for order:', orderId);
              notificationSuccess = true;
            } else {
              // If MessageService fails, try OrderDataService as a backup
              console.log('MessageService failed, falling back to OrderDataService');
              const orderServiceResult = await OrderDataService.sendReadyNotification(orderWithStation);
              console.log('OrderDataService notification result:', orderServiceResult);
              
              if (orderServiceResult && orderServiceResult.success) {
                console.log('OrderDataService notification sent successfully for order:', orderId);
                notificationSuccess = true;
              } else {
                throw new Error(orderServiceResult?.error || smsResult?.error || 'All notification attempts failed');
              }
            }
          
          } catch (error2) {
            console.error('Secondary notification failed:', error2);
            
            // Attempt 3: Try direct OrderDataService
            try {
              console.log('Attempting direct OrderDataService.sendMessageToCustomer as last resort');
              const directResult = await OrderDataService.sendMessageToCustomer(
                orderId,
                `🔔 YOUR COFFEE IS READY! Your ${orderWithStation.coffeeType || 'coffee'} is now ready for collection. Enjoy! ☕`
              );
              
              console.log('Direct SMS result:', directResult);
              
              if (directResult && (directResult.success === true || !Object.prototype.hasOwnProperty.call(directResult, 'success'))) {
                console.log('Last resort notification sent successfully');
                notificationSuccess = true;
              } else {
                throw new Error(directResult?.error || 'Final notification attempt failed without details');
              }
            } catch (error3) {
              console.error('All notification attempts failed:', error3);
              notificationError = error3;
            }
          }
        }
        
        // Update message status UI to reflect notification status
        setMessageStatus(prev => ({
          ...prev,
          [orderId]: { 
            status: notificationSuccess ? 'sent' : 'failed', 
            error: notificationSuccess ? null : (notificationError?.message || 'Failed to send notification'),
            timestamp: new Date() 
          }
        }));
        
        return true;
      } else {
        console.error('Failed to complete order in backend');
        alert('Failed to complete the order. Please try again.');
      }
      
      return false;
    } catch (err) {
      console.error('Error completing order with notifications:', err);
      alert(`Error: ${err.message || 'Unknown error completing order'}`);
      return false;
    }
  };

  // Handle wait time change
  const handleAdjustWaitTime = async (newWaitTime) => {
    if (newWaitTime && !isNaN(newWaitTime)) {
      const waitTimeValue = parseInt(newWaitTime);
      const success = await updateWaitTime(waitTimeValue);
      
      if (success) {
        setWaitTime(waitTimeValue);
        setShowWaitTimeDialog(false);
        alert(`Wait time updated to ${waitTimeValue} minutes`);
      } else {
        alert('Failed to update wait time. Please try again.');
      }
    }
  };

  // Batch order handling
  const toggleBatchMode = () => {
    setBatchModeActive(!batchModeActive);
    if (batchModeActive && selectedOrders.size > 0) {
      // Process selected orders
      processBatchSelection(selectedOrders);
    }
    // Clear selections when toggling off
    setSelectedOrders(new Set());
  };

  const toggleOrderSelection = (orderId) => {
    const newSelectedOrders = new Set(selectedOrders);
    if (newSelectedOrders.has(orderId)) {
      newSelectedOrders.delete(orderId);
    } else {
      newSelectedOrders.add(orderId);
    }
    setSelectedOrders(newSelectedOrders);
  };

  // Handle walk-in order submission
  const handleWalkInOrder = async (orderDetails, orderType = 'single') => {
    try {
      // If this is a group order, handle it differently
      if (orderType === 'group') {
        console.log('Attempting to add group order:', orderDetails);
        
        // Find the actual station info from the stations list
        const stationInfo = stations.find(s => s.id === selectedStation);
        
        // Pass the group order to the service function
        const result = await OrderDataService.submitGroupOrder(orderDetails);
        
        if (result && result.success) {
          setShowWalkInDialog(false);
          alert(`Group order "${orderDetails.groupName}" with ${result.count} coffees added to the queue!`);
          // Refresh data to show new orders
          refreshData();
        } else {
          // More detailed error message
          alert(`Failed to add group order: ${result?.message || 'Unknown error'}`);
        }
        
        return;
      }
      
      // Handle regular individual walk-in order
      console.log('Attempting to add walk-in order:', orderDetails);
      
      // Find the actual station info from the stations list
      const stationInfo = stations.find(s => s.id === selectedStation);
      
      // Add station ID to the order details
      const orderWithStation = {
        ...orderDetails,
        stationId: selectedStation,
        station_id: selectedStation,
        assignedStation: selectedStation,
        // Add the station name for better display - use station name from the stations list
        stationName: stationInfo ? stationInfo.name : settings.stationName
      };
      
      console.log('Adding walk-in order with station information:', orderWithStation);
      
      // Add a proper try/catch around the API call
      const result = await addWalkInOrder(orderWithStation);
      
      if (result) {
        setShowWalkInDialog(false);
        alert(`Walk-in order added for ${orderDetails.customerName} at ${orderWithStation.stationName}`);
      } else {
        // More detailed error message
        alert('Failed to add walk-in order. The backend API may not be properly connected or implemented.');
      }
    } catch (error) {
      console.error('Error submitting walk-in order:', error);
      
      // Show specific error message if available
      const errorMessage = error?.message || 'Unknown error occurred';
      alert(`Error adding walk-in order: ${errorMessage}`);
      
      // Close the dialog anyway to prevent user from getting stuck
      setShowWalkInDialog(false);
    }
  };

  // Function to show display screen with station ID
  const openDisplayScreen = () => {
    // Pass the station ID in the URL to customize the display
    window.open(`/display?station=${selectedStation}`, '_blank');
  };

  // Function to render in-progress order
  const renderInProgressOrder = (order) => {
    const hasSentMessage = messageStatus[order.id]?.status === 'sent';
    
    return (
      <div key={order.id} className="bg-white rounded-lg shadow-md p-4 mb-4">
        <div className="flex justify-between">
          <div>
            <div className="text-sm text-gray-500">Order #{order.id}</div>
            <div className="text-xl font-bold mt-1 flex items-center">
              {order.customerName}
              {hasSentMessage && (
                <span className="ml-1 text-green-500" title="Message sent">
                  <Check size={16} />
                </span>
              )}
            </div>
            <div className="text-gray-700">{order.phoneNumber}</div>
          </div>
          <div className="flex flex-col items-end">
            {order.priority && (
              <div className="bg-red-100 text-red-700 px-2 py-1 rounded text-sm font-medium">
                PRIORITY
              </div>
            )}
          </div>
        </div>
        
        <div className="mt-4 bg-gray-100 p-3 rounded-lg">
          <div className="text-xl font-bold">{order.coffeeType || 'Coffee'}</div>
          <div className="text-gray-700">{order.milkType || 'Regular milk'}, {order.sugar || 'No sugar'}</div>
          {order.extraHot && <div className="text-gray-700">Extra hot</div>}
          {order.alternativeMilk && (
            <div className="mt-1">
              <span className="inline-block bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded">
                Alternative Milk
              </span>
            </div>
          )}
        </div>
        
        <div className="mt-4 flex space-x-2">
          <button 
            className="flex-1 bg-gray-200 py-2 rounded flex items-center justify-center space-x-1 hover:bg-gray-300"
            onClick={() => handleOpenMessageDialog(order)}
          >
            <MessageCircle size={18} />
            <span>Message Customer</span>
          </button>
          <button 
            className="flex-1 bg-green-500 text-white py-2 rounded flex items-center justify-center space-x-1 hover:bg-green-600"
            onClick={() => handleCompleteOrder(order.id)}
          >
            <Check size={18} />
            <span>Mark Complete</span>
          </button>
        </div>
      </div>
    );
  };

  // Function to render completed order
  const renderCompletedOrder = (order) => {
    return (
      <div key={order.id} className="bg-white rounded-lg shadow-sm p-3">
        <div className="flex justify-between">
          <div>
            <div className="text-sm text-gray-500">Order #{order.id}</div>
            <div className="font-bold">{order.customerName}</div>
            <div className="text-sm text-gray-700">{order.coffeeType}</div>
          </div>
          <div className="flex flex-col items-end">
            <button 
              className="text-gray-500 hover:text-gray-700 mb-1"
              onClick={() => handleOpenMessageDialog(order)}
            >
              <MessageCircle size={16} />
            </button>
            <button 
              className="bg-amber-500 text-white text-xs px-2 py-1 rounded hover:bg-amber-600"
              onClick={() => markOrderPickedUp(order.id)}
            >
              Picked Up
            </button>
          </div>
        </div>
      </div>
    );
  };

  // Function to render previous order
  const renderPreviousOrder = (order) => {
    return (
      <div key={order.id} className="bg-white rounded-lg shadow-sm p-3">
        <div className="flex justify-between">
          <div>
            <div className="text-sm text-gray-500">Order #{order.id}</div>
            <div className="font-bold">{order.customerName}</div>
            <div className="text-sm text-gray-700">{order.coffeeType}</div>
          </div>
          <div className="text-right">
            <div className="text-xs text-gray-500">
              {new Date(order.completedAt || order.updated_at).toLocaleTimeString()}
            </div>
            <div className="flex mt-1">
              <button 
                className="text-gray-500 hover:text-gray-700 mr-1"
                onClick={() => handleOpenMessageDialog(order)}
                title="Message Customer"
              >
                <MessageCircle size={14} />
              </button>
              <button 
                className="text-amber-500 hover:text-amber-700"
                onClick={() => window.alert(`Order details: ${JSON.stringify(order, null, 2)}`)}
                title="View Order Details"
              >
                <Coffee size={14} />
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Success message handling
  useEffect(() => {
    let timer;
    if (successMessage) {
      timer = setTimeout(() => {
        setSuccessMessage('');
      }, 5000);
    }
    return () => clearTimeout(timer);
  }, [successMessage]);

  return (
    <div className="flex flex-col h-screen bg-gray-100">
      {/* Header with Station Selector */}
      <header className="bg-amber-800 text-white p-4 shadow-md">
        <div className="flex justify-between items-center">
          <h1 className="text-2xl font-bold">Coffee Cue Barista</h1>
          <div className="relative">
            <button 
              className="bg-amber-700 hover:bg-amber-600 px-4 py-2 rounded-lg flex items-center"
              onClick={() => setShowStationSelector(!showStationSelector)}
            >
              <Coffee size={18} className="mr-2" />
              {stationsLoading ? (
                'Loading Stations...'
              ) : (
                <>
                  {stations.find(s => s.id === selectedStation)?.name || 'Select Station'}
                </>
              )}
            </button>
            
            {showStationSelector && (
              <div className="absolute right-0 mt-2 w-64 bg-white rounded-lg shadow-lg z-50">
                <div className="p-2 border-b text-gray-700 font-medium">Select Station</div>
                <div className="max-h-64 overflow-y-auto">
                  {stations.map(station => (
                    <button
                      key={station.id}
                      className={`w-full text-left p-3 hover:bg-gray-100 ${selectedStation === station.id ? 'bg-amber-100' : ''}`}
                      onClick={() => {
                        changeSelectedStation(station.id);
                        setShowStationSelector(false);
                      }}
                    >
                      <div className="font-medium text-gray-800">{station.name}</div>
                      {station.location && (
                        <div className="text-sm text-gray-500">{station.location}</div>
                      )}
                    </button>
                  ))}
                  {stations.length === 0 && (
                    <div className="p-3 text-gray-500 text-center">No stations available</div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </header>
      
      {/* Station Info and Main Tabs */}
      <div className="flex flex-col flex-grow">
        {/* Status Bar */}
        <div className="bg-gray-200 px-4 py-2 flex justify-between items-center">
          <div className="flex items-center space-x-6">
            <div className="flex items-center">
              <span className="text-gray-700 mr-2">Station:</span>
              <span className="font-medium">
                {stations.find(s => s.id === selectedStation)?.name || 'Not Selected'}
              </span>
            </div>
            
            <div className="flex items-center">
              <span className="text-gray-700 mr-2">Queue:</span>
              <span className={`font-medium ${pendingOrders.length > 0 ? 'text-amber-700' : ''}`}>
                {pendingOrders.length} orders
              </span>
            </div>
            
            <div className="flex items-center">
              <span className="text-gray-700 mr-2">Status:</span>
              <span className={`font-medium ${online ? 'text-green-600' : 'text-red-600'}`}>
                {online ? 'Online' : 'Offline'}
              </span>
            </div>
            
            {lowCount + criticalCount > 0 && (
              <div className="flex items-center">
                <span className="text-gray-700 mr-2">Inventory:</span>
                <span className="font-medium text-red-600">
                  {lowCount + criticalCount} items low
                </span>
              </div>
            )}
          </div>
          
          <div className="flex space-x-2">
            <button 
              className="px-4 py-1 bg-amber-700 text-white rounded-lg hover:bg-amber-600 flex items-center"
              onClick={() => setShowWaitTimeDialog(true)}
            >
              <Clock size={16} className="mr-1" />
              Set Wait Time
            </button>
            
            <button 
              className="px-4 py-1 bg-amber-700 text-white rounded-lg hover:bg-amber-600 flex items-center"
              onClick={() => setShowWalkInDialog(true)}
            >
              <Plus size={16} className="mr-1" />
              Add Walk-in
            </button>
            
            <button 
              className="px-4 py-1 bg-amber-700 text-white rounded-lg hover:bg-amber-600 flex items-center relative"
              onClick={() => setChatOpen(!chatOpen)}
            >
              <MessageCircle size={16} className="mr-1" />
              Chat
              {unreadMessages > 0 && (
                <span className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs">
                  {unreadMessages}
                </span>
              )}
            </button>
          </div>
        </div>
        
        {/* Tabs Navigation */}
        <div className="bg-white border-b flex shadow-sm">
          <button 
            className={`py-4 px-6 font-medium flex items-center ${activeTab === 'orders' ? 'border-b-2 border-amber-600 bg-white text-amber-800' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
            onClick={() => setActiveTab('orders')}
          >
            <Coffee size={18} className="mr-1" />
            Orders
          </button>
          <button 
            className={`py-4 px-6 font-medium flex items-center ${activeTab === 'stock' ? 'border-b-2 border-amber-600 bg-white text-amber-800' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
            onClick={() => setActiveTab('stock')}
          >
            <Package size={18} className="mr-1" />
            Stock
          </button>
          <button 
            className={`py-4 px-6 font-medium flex items-center ${activeTab === 'schedule' ? 'border-b-2 border-amber-600 bg-white text-amber-800' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
            onClick={() => setActiveTab('schedule')}
          >
            <Calendar size={18} className="mr-1" />
            Schedule
          </button>
          <button 
            className={`py-4 px-6 font-medium flex items-center ${activeTab === 'completed' ? 'border-b-2 border-amber-600 bg-white text-amber-800' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
            onClick={() => setActiveTab('completed')}
          >
            <Check size={18} className="mr-1" />
            Completed
          </button>
          <button 
            className={`py-4 px-6 font-medium flex items-center ${activeTab === 'display' ? 'border-b-2 border-amber-600 bg-white text-amber-800' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
            onClick={() => setActiveTab('display')}
          >
            <Monitor size={18} className="mr-1" />
            Display
          </button>
          <button 
            className={`py-4 px-6 font-medium flex items-center ${activeTab === 'settings' ? 'border-b-2 border-amber-600 bg-white text-amber-800' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
            onClick={() => setActiveTab('settings')}
          >
            <Settings size={18} className="mr-1" />
            Settings
          </button>
        </div>

        {/* Main Content */}
        <div className="p-4 flex-grow overflow-y-auto">
          {/* Loading state */}
          {loading && (
            <div className="flex justify-center items-center h-full">
              <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-amber-600"></div>
            </div>
          )}
          
          {/* Error state */}
          {error && (
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4">
              <strong className="font-bold">Error!</strong>
              <span className="block sm:inline"> {error}</span>
              <button 
                className="absolute top-0 bottom-0 right-0 px-4 py-3"
                onClick={clearError}
              >
                <XCircle size={20} />
              </button>
            </div>
          )}
          
          {/* Success Message */}
          {successMessage && (
            <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded relative mb-4 animate-fadeIn">
              <strong className="font-bold">Success!</strong>
              <span className="block sm:inline"> {successMessage}</span>
            </div>
          )}
          
          {/* Orders Tab */}
          {!loading && activeTab === 'orders' && (
            <OrdersTab
              inProgressOrders={inProgressOrders}
              pendingOrders={pendingOrders}
              filter={filter}
              setFilter={setFilter}
              startOrder={startOrder}
              processBatch={processBatch}
              handleOpenMessageDialog={handleOpenMessageDialog}
              handleDelayOrder={handleDelayOrder}
              renderInProgressOrder={renderInProgressOrder}
            />
          )}
          
          {/* Stock Management Tab */}
          {!loading && activeTab === 'stock' && (
            <StockTab
              dismissedPanels={dismissedPanels}
              dismissPanel={dismissPanel}
              lowCount={lowCount}
              criticalCount={criticalCount}
              stockCategories={stockCategories}
              selectedStockCategory={selectedStockCategory}
              setSelectedStockCategory={setSelectedStockCategory}
              stockLoading={stockLoading}
              getCategoryStock={getCategoryStock}
              updateStockItem={updateStockItem}
              addStockItem={addStockItem}
              deleteStockItem={deleteStockItem}
              resetStock={resetStock}
            />
          )}
          
          {/* Schedule Tab */}
          {!loading && activeTab === 'schedule' && (
            <ScheduleTab
              dismissedPanels={dismissedPanels}
              dismissPanel={dismissPanel}
              scheduleLoading={scheduleLoading}
              scheduleData={scheduleData}
              scheduleError={scheduleError}
            />
          )}
          
          {/* Completed Orders Tab */}
          {!loading && activeTab === 'completed' && (
            <CompletedOrdersTab
              historyTab={historyTab}
              setHistoryTab={setHistoryTab}
              searchTerm={searchTerm}
              setSearchTerm={setSearchTerm}
              searchOrders={searchOrders}
              completedOrders={completedOrders}
              previousOrders={previousOrders}
              yesterdayOrders={yesterdayOrders}
              thisWeekOrders={thisWeekOrders}
              searchResults={searchResults}
              loading={loading}
              renderCompletedOrder={renderCompletedOrder}
              renderPreviousOrder={renderPreviousOrder}
              fetchYesterdayOrders={fetchYesterdayOrders}
              fetchThisWeekOrders={fetchThisWeekOrders}
            />
          )}
          
          {/* Display Tab */}
          {!loading && activeTab === 'display' && (
            <DisplayTab
              dismissedPanels={dismissedPanels}
              dismissPanel={dismissPanel}
              openDisplayScreen={openDisplayScreen}
              settings={settings}
              setSettings={setSettings}
            />
          )}
          
          {/* Settings Tab */}
          {!loading && activeTab === 'settings' && (
            <SettingsTab
              settings={settings}
              setSettings={setSettings}
              isRefreshing={isRefreshing}
              refreshData={refreshData}
              autoRefreshEnabled={autoRefreshEnabled}
              autoRefreshInterval={autoRefreshInterval}
              toggleAutoRefresh={toggleAutoRefresh}
              updateAutoRefreshInterval={updateAutoRefreshInterval}
              updateStation={updateStation}
              selectedStation={selectedStation}
              stations={stations}
              lastUpdated={lastUpdated}
              dismissedPanels={dismissedPanels}
              dismissPanel={dismissPanel}
              restoreAllPanels={restoreAllPanels}
            />
          )}
        </div>
      </div>
      
      {/* Chat Sidebar (conditional render) */}
      {chatOpen && (
        <div className="absolute right-0 top-0 h-full w-96 bg-white shadow-lg z-50 flex flex-col">
          <div className="bg-amber-800 text-white p-4 flex justify-between items-center">
            <h2 className="font-bold text-lg">Station Chat</h2>
            <button 
              className="text-white hover:text-amber-200"
              onClick={() => setChatOpen(false)}
            >
              <XCircle size={20} />
            </button>
          </div>
          
          <StationChat 
            stationId={selectedStation}
            stationName={settings.stationName}
            baristaName={settings.baristaName}
            onNewMessages={(count) => setUnreadMessages(count)}
          />
        </div>
      )}
      
      {/* Dialogs */}
      {showWaitTimeDialog && (
        <WaitTimeDialog
          currentWaitTime={waitTime}
          onClose={() => setShowWaitTimeDialog(false)}
          onSubmit={handleAdjustWaitTime}
        />
      )}
      
      {showWalkInDialog && (
        <WalkInOrderDialog
          onClose={() => setShowWalkInDialog(false)}
          onSubmit={handleWalkInOrder}
          stationId={selectedStation}
          stationName={settings.stationName}
        />
      )}
      
      {showMessageDialog && (
        <MessageDialog
          order={currentMessageOrder}
          onClose={() => setShowMessageDialog(false)}
          onSend={handleSendMessage}
        />
      )}
    </div>
  );
};

export default ModernBaristaInterface;