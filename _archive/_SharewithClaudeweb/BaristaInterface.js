// components/BaristaInterface.js
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Coffee, Package, Calendar, Check, Monitor, Settings,
  MessageCircle, Printer, Plus, Clock,
  Bell, XCircle, RefreshCw, Edit, ArrowLeft, ChevronDown,
  Send, CheckCircle
} from 'lucide-react';

// Import app mode context
import { useAppMode } from '../context/AppContext';

// Import the custom hooks for order, station, stock, and schedule management
import useOrders from '../hooks/useOrders';
import useStations from '../hooks/useStations';
import useStock from '../hooks/useStock';
import useSchedule from '../hooks/useSchedule';
import { 
  getOrderBackgroundColor, 
  getTimeRatioColor, 
  formatTimeSince, 
  formatBatchName,
  calculateMinutesDiff
} from '../utils/orderUtils';

// Import services and utilities
import MessageService from '../services/MessageService';
import OrderDataService from '../services/OrderDataService';
import ChatService from '../services/ChatService';

// Import components
import MessageDialog from './dialogs/MessageDialog';
import WaitTimeDialog from './dialogs/WaitTimeDialog';
import WalkInOrderDialog from './dialogs/WalkInOrderDialog';
// Using inline help dialog instead of importing external component
import StationChat from './StationChat';
import OrderNotificationHandler from './OrderNotificationHandler';
import PendingOrdersSection from './PendingOrdersSection';

const BaristaInterface = () => {
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
  
  // NEW: Message status tracking
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

  // Settings state (moved to a SettingsService in a full implementation)
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
    showNameOnDisplay: true
  });

  // Schedule data is initialized at the top of the component

  // NEW: Init notification handler
  const notificationHandler = OrderNotificationHandler({
    onSendMessage: (orderId, message) => handleSendMessage(orderId, message),
    onUpdateSettings: (newSettings) => {
      setSettings({...settings, ...newSettings});
    }
  });

  // Load station-specific settings on mount
  useEffect(() => {
    // This effect only needs to run once on initial component mount
    // We'll handle station changes in the other useEffect
  }, []);
  
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

  // NEW: Enhanced message sending function using the suggested pattern
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
        
        // No need to close dialog, it will close itself on success
        
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

  // NEW: Handle sending message to customer (simplified version)
  const handleOpenMessageDialog = (order) => {
    setCurrentMessageOrder(order);
    setShowMessageDialog(true);
  };

  // NEW: Handle delay order
  const handleDelayOrder = (order) => {
    if (!order || !order.id) {
      // Use the clearError function from useOrders instead of undefined setError
      console.error('Cannot delay order: Missing order ID');
      return;
    }
    
    // Since we don't have a delayOrder function in useOrders,
    // we'll just use the fallback for now
    // In a real implementation, you would add delayOrder to useOrders.js
    
    // Fallback implementation
    alert(`Order #${order.id} for ${order.customerName} delayed by 5 minutes`);
    
    // Optional: If you want to show this in the UI, you could update the order locally
    // This would be temporary until the next data refresh
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
        
        // We already have the order with station info, now send notifications
        // Multiple SMS delivery attempts for maximum reliability
        
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

  // Handle walk-in order submission with better error handling
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
                  <CheckCircle size={16} />
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
            <button 
              className="mt-2 text-gray-500 hover:text-gray-700"
              onClick={() => {
                // Show order edit dialog
                alert(`Edit order #${order.id}`);
              }}
            >
              <Edit size={16} />
            </button>
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
            className="flex-1 bg-gray-200 py-2 rounded flex items-center justify-center space-x-1 hover:bg-gray-300"
            onClick={() => {
              console.log(`Printing label for order #${order.id}`);
              alert(`Printing label for ${order.coffeeType || 'Coffee'}`);
            }}
          >
            <Printer size={18} />
            <span>Print Label</span>
          </button>
        </div>
        
        <button 
          className="mt-3 w-full bg-green-500 text-white py-3 rounded-lg font-bold text-lg hover:bg-green-600"
          onClick={() => handleCompleteOrder(order.id)}
        >
          COMPLETE ORDER
        </button>
        
        {/* Time pressure bar */}
        <div className="mt-3 flex items-center space-x-2">
          <div className="text-sm">Time pressure:</div>
          <div className="flex-grow bg-gray-200 h-2 rounded-full overflow-hidden">
            <div 
              className={`h-2 ${getTimeRatioColor(order.waitTime, order.promisedTime)}`}
              style={{ width: `${(order.waitTime / order.promisedTime) * 100}%` }}
            ></div>
          </div>
          <div className="text-sm">{Math.floor((order.waitTime / order.promisedTime) * 100)}%</div>
        </div>
      </div>
    );
  };

  // Function to render completed order card
  const renderCompletedOrder = (order) => {
    const minutesWaiting = order.completedAt ? calculateMinutesDiff(order.completedAt) : 0;
    const hasSentMessage = messageStatus[order.id]?.status === 'sent';
    
    return (
      <div key={order.id} className="border-l-4 border-green-500 bg-white rounded-lg shadow-sm p-3 mb-2">
        <div className="flex justify-between items-center">
          <div className="font-bold flex items-center">
            Order #{order.id}
            {hasSentMessage && (
              <span className="ml-1 text-green-500" title="Message sent">
                <CheckCircle size={14} />
              </span>
            )}
          </div>
          <div className="text-sm text-gray-500">Completed {minutesWaiting} minutes ago</div>
        </div>
        <div className="mt-2">
          <div className="text-gray-700">{order.coffeeType || 'Coffee'}, {order.milkType || 'Regular milk'}</div>
          <div className="font-medium">{order.customerName}</div>
          <div className="text-sm text-gray-600">{order.phoneNumber}</div>
          {order.alternativeMilk && (
            <div className="mt-1">
              <span className="inline-block bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded">
                Alternative Milk
              </span>
            </div>
          )}
        </div>
        <div className="mt-3 flex space-x-2">
          <button 
            className="flex-1 bg-amber-600 text-white py-1 rounded text-sm hover:bg-amber-700"
            onClick={() => handleOpenMessageDialog(order)}
          >
            Remind
          </button>
          <button 
            className="flex-1 bg-green-500 text-white py-1 rounded text-sm hover:bg-green-600"
            onClick={() => markOrderPickedUp(order.id)}
          >
            Picked Up
          </button>
        </div>
      </div>
    );
  };

  // Function to render previous order card
  const renderPreviousOrder = (order) => {
    return (
      <div key={order.id} className="border-l-4 border-green-500 bg-white rounded-lg shadow-sm p-3 mb-2">
        <div className="flex justify-between items-center">
          <div className="font-bold">Order #{order.id}</div>
          <button 
            className="text-sm text-gray-600 bg-gray-200 px-2 py-1 rounded hover:bg-gray-300"
            onClick={() => {
              console.log(`Viewing details for order #${order.id}`);
              alert(`Order detail viewing requires backend API implementation. Details for order #${order.id} are not available.`);
            }}
          >
            View Details
          </button>
        </div>
        <div className="mt-2">
          <div className="text-gray-700">{order.coffeeType || 'Coffee'}, {order.milkType || 'Regular milk'} {order.sugar ? `, ${order.sugar}` : ''}</div>
          <div className="font-medium">{order.customerName}</div>
          <div className="text-sm text-gray-600">Picked up at {order.pickedUpAt ? new Date(order.pickedUpAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : 'unknown'}</div>
        </div>
      </div>
    );
  };

  // Create individual stock item component to properly use hooks
  const StockItem = ({ item, category, updateStockItem, deleteStockItem, addStockItem }) => {
    const percentage = (item.amount / item.capacity) * 100;
    const [isEditingCapacity, setIsEditingCapacity] = useState(false);
    const [tempCapacity, setTempCapacity] = useState(item.capacity);
    const [showNumericInput, setShowNumericInput] = useState(false);
    const [numericAmount, setNumericAmount] = useState(item.amount);
    
    // Get appropriate color based on status
    const getStatusColor = (status) => {
      switch(status) {
        case 'danger':
          return 'bg-red-400';
        case 'warning':
          return 'bg-yellow-400';
        case 'good':
        default:
          return 'bg-green-400';
      }
    };
    
    // Get appropriate amount change based on category and item type
    const getChangeAmount = (itemCategory, itemObj) => {
      if (itemCategory === 'milk') {
        return 0.5; // 0.5 liter
      } else if (itemCategory === 'coffee') {
        return 0.1; // 0.1 kg
      } else if (itemCategory === 'cups') {
        return 5; // 5 cups
      } else if (itemCategory === 'syrups') {
        return 0.1; // 0.1 liter
      } else {
        // Default or 'other' category
        return itemObj.unit === 'pcs' ? 5 : 0.5;
      }
    };
    
    const changeAmount = getChangeAmount(category, item);
    
    // Function to handle slider change
    const handleSliderChange = (e) => {
      const newAmount = parseFloat(e.target.value);
      updateStockItem(category, item.id, newAmount);
      setNumericAmount(newAmount);
    };
    
    // Function to handle numeric input change
    const handleNumericInputChange = (e) => {
      setNumericAmount(e.target.value);
    };
    
    // Function to apply numeric input
    const applyNumericInput = () => {
      const newAmount = parseFloat(numericAmount);
      if (!isNaN(newAmount) && newAmount >= 0 && newAmount <= item.capacity) {
        updateStockItem(category, item.id, newAmount);
      }
      setShowNumericInput(false);
    };
    
    // Function to handle capacity change
    const handleCapacityChange = () => {
      if (!isNaN(tempCapacity) && tempCapacity > 0) {
        // We need to update the whole item with the new capacity
        // First let's get the low and critical thresholds percentages
        const lowThresholdPercent = (item.lowThreshold / item.capacity);
        const criticalThresholdPercent = (item.criticalThreshold / item.capacity);
        
        // Create a new item with updated capacity and thresholds
        const updatedItem = {
          ...item,
          capacity: parseFloat(tempCapacity),
          amount: Math.min(item.amount, parseFloat(tempCapacity)), // Make sure amount doesn't exceed new capacity
          lowThreshold: parseFloat(tempCapacity) * lowThresholdPercent,
          criticalThreshold: parseFloat(tempCapacity) * criticalThresholdPercent
        };
        
        // Delete the old item and add the updated one
        deleteStockItem(category, item.id);
        addStockItem(category, updatedItem);
        
        setIsEditingCapacity(false);
      }
    };
    
    return (
      <div className="flex flex-col mb-6 pb-4 border-b border-gray-200">
        <div className="flex items-center justify-between mb-2">
          <div className="w-1/4">
            <div className="font-medium">{item.name}</div>
            <div className="text-sm text-gray-500 flex items-center">
              <span className="mr-2">Available: {item.amount} {item.unit}</span>
              <button 
                className="text-blue-500 text-xs underline"
                onClick={() => setShowNumericInput(!showNumericInput)}
              >
                {showNumericInput ? 'Hide' : 'Edit'}
              </button>
            </div>
            
            {/* Numeric input for direct value entry */}
            {showNumericInput && (
              <div className="mt-1 flex items-center">
                <input
                  type="number"
                  min="0"
                  max={item.capacity}
                  step={item.unit === 'pcs' ? 1 : 0.1}
                  value={numericAmount}
                  onChange={handleNumericInputChange}
                  className="w-24 p-1 border rounded mr-2"
                />
                <button
                  className="bg-green-500 text-white px-2 py-1 rounded text-xs"
                  onClick={applyNumericInput}
                >
                  Apply
                </button>
              </div>
            )}
          </div>
          
          <div className="w-1/4 flex flex-col">
            <div className="font-medium flex items-center">
              Capacity: {item.capacity} {item.unit}
              <button 
                className="ml-2 text-blue-500 text-xs underline"
                onClick={() => setIsEditingCapacity(!isEditingCapacity)}
              >
                {isEditingCapacity ? 'Cancel' : 'Edit'}
              </button>
            </div>
            
            {isEditingCapacity && (
              <div className="mt-1 flex items-center">
                <input
                  type="number"
                  min={item.amount} // Can't set capacity lower than current amount
                  step={item.unit === 'pcs' ? 1 : 0.1}
                  value={tempCapacity}
                  onChange={(e) => setTempCapacity(e.target.value)}
                  className="w-24 p-1 border rounded mr-2"
                />
                <button
                  className="bg-green-500 text-white px-2 py-1 rounded text-xs"
                  onClick={handleCapacityChange}
                >
                  Update
                </button>
              </div>
            )}
          </div>
          
          <div className="w-1/4 flex justify-end space-x-2">
            <button 
              className="w-10 h-10 bg-gray-200 rounded-md flex items-center justify-center hover:bg-gray-300"
              onClick={() => {
                if (item.amount > 0) {
                  // Decrease stock using the hook
                  const newAmount = Math.max(0, item.amount - changeAmount);
                  updateStockItem(category, item.id, newAmount);
                  setNumericAmount(newAmount);
                }
              }}
            >
              -
            </button>
            <button 
              className="w-10 h-10 bg-gray-200 rounded-md flex items-center justify-center hover:bg-gray-300"
              onClick={() => {
                // Increase stock using the hook
                const newAmount = Math.min(item.capacity, item.amount + changeAmount);
                updateStockItem(category, item.id, newAmount);
                setNumericAmount(newAmount);
              }}
            >
              +
            </button>
          </div>
        </div>
        
        {/* Interactive slider for stock level */}
        <div className="w-full mt-2">
          <div className="flex items-center">
            <input
              type="range"
              min="0"
              max={item.capacity}
              step={item.unit === 'pcs' ? 1 : 0.1}
              value={item.amount}
              onChange={handleSliderChange}
              className="w-full h-5 appearance-none bg-gray-200 rounded-full focus:outline-none"
              style={{
                background: `linear-gradient(to right, ${getStatusColor(item.status)} 0%, ${getStatusColor(item.status)} ${percentage}%, #e5e7eb ${percentage}%, #e5e7eb 100%)`
              }}
            />
          </div>
          
          {/* Visual indicators for thresholds */}
          <div className="relative w-full h-6">
            {/* Low threshold indicator */}
            <div 
              className="absolute top-0 w-0.5 h-2 bg-yellow-500" 
              style={{ left: `${(item.lowThreshold / item.capacity) * 100}%` }}
            ></div>
            <div 
              className="absolute top-3 text-xs text-yellow-600" 
              style={{ left: `${(item.lowThreshold / item.capacity) * 100}%`, transform: 'translateX(-50%)' }}
            >
              Low
            </div>
            
            {/* Critical threshold indicator */}
            <div 
              className="absolute top-0 w-0.5 h-2 bg-red-500" 
              style={{ left: `${(item.criticalThreshold / item.capacity) * 100}%` }}
            ></div>
            <div 
              className="absolute top-3 text-xs text-red-600" 
              style={{ left: `${(item.criticalThreshold / item.capacity) * 100}%`, transform: 'translateX(-50%)' }}
            >
              Critical
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Function to render schedule item
  const renderScheduleItem = (item, type) => {
    const getStatusClass = (status) => {
      switch(status) {
        case 'active':
          return 'bg-green-100 border-green-500 text-green-700';
        case 'upcoming':
          return 'bg-blue-100 border-blue-500 text-blue-700';
        case 'completed':
          return 'bg-gray-100 border-gray-500 text-gray-700';
        default:
          return 'bg-gray-100 border-gray-500 text-gray-700';
      }
    };
    
    return (
      <div 
        key={`${type}-${item.id}`}
        className={`mb-2 p-3 rounded-lg border-l-4 ${getStatusClass(item.status)} shadow-sm`}
      >
        <div className="flex justify-between items-center">
          <div className="font-bold">{item.start} - {item.end}</div>
          {type === 'shift' && (
            <div className="text-sm bg-amber-100 text-amber-800 px-2 py-1 rounded">
              {item.barista}
            </div>
          )}
          {type === 'rush' && (
            <div className="text-sm bg-red-100 text-red-800 px-2 py-1 rounded">
              Rush Period
            </div>
          )}
        </div>
        <div className="mt-2">
          {type === 'shift' && <div className="text-gray-700">Barista Shift</div>}
          {type === 'break' && <div className="text-gray-700">Break Time for {item.barista}</div>}
          {type === 'rush' && <div className="text-gray-700">{item.reason}</div>}
        </div>
      </div>
    );
  };
  
    // Dismissible Info Panel Component
  const DismissibleInfoPanel = ({ id, title, message, extraContent, borderColor = 'green', bgColor = 'green', isDismissed, onDismiss }) => {
    if (isDismissed) return null;
    
    return (
      <div className={`bg-${bgColor}-100 border-l-4 border-${borderColor}-500 text-${borderColor}-700 p-2 mb-3 relative`}>
        <div className="flex">
          <div className="py-1">
            <svg className={`fill-current h-5 w-5 text-${borderColor}-500 mr-2`} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
              <path d="M2.93 17.07A10 10 0 1 1 17.07 2.93 10 10 0 0 1 2.93 17.07zm12.73-1.41A8 8 0 1 0 4.34 4.34a8 8 0 0 0 11.32 11.32zM9 11V9h2v6H9v-4zm0-6h2v2H9V5z"/>
            </svg>
          </div>
          <div className="pr-7">
            <p className="font-bold text-sm">{title}</p>
            <p className="text-xs">{message}</p>
            {extraContent && <div className="mt-1 text-xs">{extraContent}</div>}
          </div>
        </div>
        
        {/* Close button */}
        <button 
          className="absolute top-1 right-1 text-gray-500 hover:text-gray-800 bg-white rounded-full p-1 shadow-sm"
          onClick={() => onDismiss(id)}
          aria-label="Dismiss message"
          title="Dismiss this message"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
    );
  };
  
  // Notification Settings Component
  const NotificationSettings = () => {
    const [localSettings, setLocalSettings] = useState({
      autoSendSmsOnComplete: settings.autoSendSmsOnComplete,
      remindAfterDelay: settings.remindAfterDelay,
      reminderDelay: settings.reminderDelay,
      showNameOnDisplay: settings.showNameOnDisplay
    });
    
    const saveSettings = () => {
      // Update parent settings
      setSettings({...settings, ...localSettings});
      
      // Update MessageService settings
      MessageService.updateSettings(localSettings);
      
      alert('Notification settings saved');
    };
    
    return (
      <div className="p-4 border rounded shadow-lg bg-white">
        <h3 className="text-lg font-bold mb-4">Notification Settings</h3>
        <div className="space-y-4">
          <div>
            <label className="flex items-center space-x-2">
              <input 
                type="checkbox" 
                checked={localSettings.autoSendSmsOnComplete} 
                onChange={e => setLocalSettings({...localSettings, autoSendSmsOnComplete: e.target.checked})}
              />
              <span>Automatically send SMS when order is completed</span>
            </label>
          </div>
          
          <div>
            <label className="flex items-center space-x-2">
              <input 
                type="checkbox" 
                checked={localSettings.showNameOnDisplay} 
                onChange={e => setLocalSettings({...localSettings, showNameOnDisplay: e.target.checked})}
              />
              <span>Show customer name on display screen</span>
            </label>
          </div>
          
          <div>
            <label className="flex items-center space-x-2">
              <input 
                type="checkbox" 
                checked={localSettings.remindAfterDelay} 
                onChange={e => setLocalSettings({...localSettings, remindAfterDelay: e.target.checked})}
              />
              <span>Send reminder if order not picked up</span>
            </label>
            
            {localSettings.remindAfterDelay && (
              <div className="pl-6 mt-2">
                <label className="flex items-center space-x-2">
                  <span>Reminder delay (seconds):</span>
                  <input 
                    type="number" 
                    min="10" 
                    max="300"
                    value={localSettings.reminderDelay} 
                    onChange={e => setLocalSettings({...localSettings, reminderDelay: parseInt(e.target.value)})}
                    className="w-20 p-1 border rounded"
                  />
                </label>
              </div>
            )}
          </div>
        </div>
        
        <div className="mt-4 flex justify-end">
          <button 
            className="px-4 py-2 bg-amber-600 text-white rounded hover:bg-amber-700"
            onClick={saveSettings}
          >
            Save Settings
          </button>
        </div>
      </div>
    );
  };

  // Main component render
  return (
    <div className="bg-gray-100 min-h-screen flex flex-col">
      {/* Header - Connection Banner */}
      {!online && (
        <div className="bg-red-500 text-white p-2 text-center">
          Could not connect to backend service. Using sample data instead.
        </div>
      )}
      
      {/* Demo Mode Indicator */}
      {isDemoMode && (
        <div className="bg-amber-500 text-white p-2 text-center">
          Demo Mode Active - Using simulated data
        </div>
      )}
      
      {/* Main Header */}
      <header className="bg-amber-800 text-white p-4 flex justify-between items-center shadow-md">
        <div className="flex items-center">
          <button 
            className="mr-2 p-1 rounded hover:bg-amber-700"
            onClick={() => window.history.back()}
            title="Back to Home"
          >
            <ArrowLeft size={20} />
          </button>
          <div className="text-xl font-bold cursor-pointer" onClick={() => setShowStationSelector(!showStationSelector)}>
            {(() => {
              // Try to get custom name from localStorage first
              if (selectedStation) {
                try {
                  const customName = localStorage.getItem(`coffee_station_name_${selectedStation}`);
                  if (customName) {
                    return customName;
                  }
                } catch (e) {
                  console.error('Error getting custom station name for display:', e);
                }
              }
              // Fall back to station from list if no custom name
              return stations.find(s => s.id === selectedStation)?.name || 'Select a Station';
            })()}
            <ChevronDown size={16} className="inline ml-1" />
          </div>
          
          {/* Station Selector Dropdown */}
          {showStationSelector && (
            <div className="absolute top-16 left-4 bg-white text-gray-800 shadow-lg rounded-md overflow-hidden z-50">
              {stations.map(station => (
                <div 
                  key={station.id}
                  className={`p-3 hover:bg-gray-100 cursor-pointer ${station.id === selectedStation ? 'bg-amber-100' : ''}`}
                  onClick={() => {
                    // Update station ID in order management hook
                    updateStationId(station.id);
                    // Change selected station in stations hook
                    changeSelectedStation(station.id);
                    
                    // Get station-specific barista name for the new station
                    const stationBaristaName = getStationBaristaName(station.id);
                    
                    // Check for custom station name in localStorage
                    let customStationName = station.name;
                    try {
                      const customName = localStorage.getItem(`coffee_station_name_${station.id}`);
                      if (customName) {
                        console.log(`Found custom station name in localStorage: ${customName}`);
                        customStationName = customName;
                      }
                    } catch (e) {
                      console.error('Error getting custom station name from localStorage:', e);
                    }
                    
                    // Update settings with new station info
                    setSettings({
                      ...settings,
                      stationName: customStationName, // Use custom name if available
                      baristaName: stationBaristaName
                    });
                    
                    // Also initialize ChatService with the correct names
                    ChatService.initialize(
                      station.id, 
                      customStationName,
                      stationBaristaName
                    );
                    
                    setShowStationSelector(false);
                    // Refresh data for the new station
                    refreshData();
                  }}
                >
                  <div className="font-medium">
                    {(() => {
                      try {
                        const customName = localStorage.getItem(`coffee_station_name_${station.id}`);
                        return customName || station.name;
                      } catch (e) {
                        return station.name;
                      }
                    })()}
                  </div>
                  <div className="text-xs text-gray-500 flex items-center">
                    <div className={`w-2 h-2 rounded-full mr-1 ${station.status === 'active' ? 'bg-green-500' : 'bg-red-500'}`}></div>
                    {station.status === 'active' ? 'Active' : 'Maintenance'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        
        <div className="flex space-x-2 items-center">
          {/* NEW: Display screen button */}
          <button 
            className="px-3 py-1 rounded-md bg-blue-500 hover:bg-blue-600 text-white flex items-center"
            onClick={openDisplayScreen}
          >
            <Monitor size={16} className="mr-1" />
            Display
          </button>
          
          <div className={`px-4 py-1 rounded-full flex items-center ${online ? 'bg-green-500' : 'bg-gray-400'}`}>
            <div className={`w-3 h-3 rounded-full ${online ? 'bg-green-300' : 'bg-gray-300'} mr-2`}></div>
            {online ? 'Online' : 'Offline'}
          </div>
          
          {/* Auto-refresh indicator */}
          <div 
            className={`px-4 py-1 rounded-full flex items-center cursor-pointer ${autoRefreshEnabled ? 'bg-green-500' : 'bg-gray-400'}`}
            onClick={toggleAutoRefresh}
            title={autoRefreshEnabled ? `Auto-refresh every ${autoRefreshInterval} seconds` : 'Auto-refresh disabled (click to enable)'}
          >
            <RefreshCw size={14} className={`mr-1 ${isRefreshing ? 'animate-spin' : ''}`} />
            {autoRefreshEnabled ? `${autoRefreshInterval}s` : 'Manual'}
          </div>
          
          <div className="px-4 py-1 rounded-full bg-green-500">
            Queue: {queueCount}
          </div>
          <div className="px-4 py-1 rounded-full bg-green-500">
            Wait: {waitTime} min
          </div>
          <button 
            className="px-4 py-1 rounded-full bg-red-500 flex items-center font-medium hover:bg-red-600 transition-colors"
            onClick={() => setShowHelpDialog(true)}
          >
            HELP
          </button>
        </div>
      </header>

      {/* Navigation Tabs */}
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
        
        {/* Last Updated indicator */}
        {!loading && !error && (
          <div className="text-xs text-gray-500 mb-2 flex items-center">
            <Clock size={12} className="mr-1" />
            Last updated: {new Date(lastUpdated).toLocaleTimeString()}
            {isRefreshing && (
              <span className="ml-2 flex items-center text-amber-600">
                <RefreshCw size={12} className="animate-spin mr-1" />
                Refreshing...
              </span>
            )}
          </div>
        )}
        
        {/* Orders Tab */}
        {!loading && activeTab === 'orders' && (
          <div className="flex space-x-4">
            {/* Current Order (In Progress) */}
            <div className="w-1/2">
              <div className="bg-amber-700 text-white p-2 rounded-t-lg">
                <h2 className="text-xl font-bold">Current Order</h2>
              </div>
              <div className="bg-white p-4 rounded-b-lg shadow-md">
                {inProgressOrders.length > 0 ? (
                  inProgressOrders.map(order => renderInProgressOrder(order))
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    <Coffee size={48} className="mx-auto mb-2 text-gray-400" />
                    <p>No orders in progress</p>
                    <p className="text-sm text-gray-400">Start an order from the queue</p>
                  </div>
                )}
              </div>
            </div>
            
            {/* Updated: Using PendingOrdersSection component with the new props */}
            <PendingOrdersSection 
              orders={pendingOrders}
              filter={filter}
              onFilterChange={setFilter}
              onStartOrder={startOrder}
              onProcessBatch={processBatch}
              onSendMessage={handleOpenMessageDialog}
              onDelayOrder={handleDelayOrder}
            />
          </div>
        )}
        
        {/* Stock Management Tab */}
        {!loading && activeTab === 'stock' && (
          <div className="p-4">
            {/* Local Stock Management Information */}
            <DismissibleInfoPanel
              id="stockInfoPanel"
              title="Station-Specific Inventory Management"
              message="This station's inventory is saved locally. Each station manages its own inventory independently."
              borderColor="green"
              bgColor="green"
              isDismissed={dismissedPanels.stockInfoPanel}
              onDismiss={dismissPanel}
              extraContent={
                (lowCount > 0 || criticalCount > 0) && (
                  <p className="font-medium">
                    {criticalCount > 0 && <span className="text-red-600 mr-2">Critical: {criticalCount} items</span>}
                    {lowCount > 0 && <span className="text-yellow-600">Low: {lowCount} items</span>}
                  </p>
                )
              }
            />
            
            {/* Category Selector */}
            <div className="flex flex-wrap gap-2 mb-4">
              {stockCategories.map(category => (
                <button
                  key={category}
                  className={`px-4 py-2 rounded-full ${selectedStockCategory === category ? 'bg-green-500 text-white' : 'bg-gray-200'}`}
                  onClick={() => setSelectedStockCategory(category)}
                >
                  {category.charAt(0).toUpperCase() + category.slice(1)}
                </button>
              ))}
            </div>
            
            {/* Stock Items */}
            <h2 className="text-xl font-bold mb-4 flex items-center justify-between">
              <span>{selectedStockCategory.charAt(0).toUpperCase() + selectedStockCategory.slice(1)} Inventory</span>
              
              {/* Add New Item button - Inline for better accessibility */}
              <button 
                className="px-4 py-2 bg-green-500 text-white rounded text-sm hover:bg-green-600"
                onClick={() => {
                  // Prompt for new item details
                  const name = prompt(`Enter new ${selectedStockCategory} item name:`);
                  if (name) {
                    const capacity = parseFloat(prompt(`Enter capacity (maximum amount) for ${name}:`, "10"));
                    if (!isNaN(capacity) && capacity > 0) {
                      const unit = prompt(`Enter unit of measurement (e.g., L, kg, pcs):`, 
                        selectedStockCategory === 'milk' || selectedStockCategory === 'syrups' ? 'L' : 
                        selectedStockCategory === 'coffee' ? 'kg' : 'pcs');
                      
                      if (unit) {
                        // Add the new item
                        addStockItem(selectedStockCategory, {
                          name,
                          amount: capacity, // Start with full capacity
                          capacity,
                          unit,
                          status: 'good',
                          lowThreshold: capacity * 0.25, // 25% of capacity
                          criticalThreshold: capacity * 0.1 // 10% of capacity
                        });
                      }
                    }
                  }
                }}
              >
                + Add New Item
              </button>
            </h2>
            
            <div className="space-y-4 bg-white rounded-lg shadow-md p-4">
              {stockLoading ? (
                <div className="flex justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-green-500"></div>
                </div>
              ) : getCategoryStock(selectedStockCategory).length > 0 ? (
                getCategoryStock(selectedStockCategory).map(item => (
                  <StockItem 
                    key={item.id}
                    item={item} 
                    category={selectedStockCategory}
                    updateStockItem={updateStockItem}
                    deleteStockItem={deleteStockItem}
                    addStockItem={addStockItem}
                  />
                ))
              ) : (
                <div className="text-center py-8 text-gray-500">
                  <Package size={48} className="mx-auto mb-2 text-gray-400" />
                  <p>No {selectedStockCategory} items found</p>
                  <p className="text-sm text-gray-400">Click the 'Add New Item' button to add stock items</p>
                </div>
              )}
            </div>
            
            {/* Stock Action Buttons */}
            <div className="flex flex-wrap gap-2 mt-6">
              <button 
                className="flex-1 py-3 bg-green-500 text-white rounded-md font-medium hover:bg-green-600"
                onClick={() => {
                  // Show confirmation message in alert and proceed if user enters "yes"
                  const userConfirmed = window.prompt(`Type 'yes' to confirm restocking all ${selectedStockCategory} items to full capacity:`) === 'yes';
                  
                  if (userConfirmed) {
                    // Get all items in the current category
                    const items = getCategoryStock(selectedStockCategory);
                    // Update each item to full capacity
                    items.forEach(item => {
                      updateStockItem(selectedStockCategory, item.id, item.capacity);
                    });
                  }
                }}
              >
                Restock All to Full
              </button>
              
              <button 
                className="flex-1 py-3 bg-gray-500 text-white rounded-md font-medium hover:bg-gray-600"
                onClick={() => {
                  // Prompt for item selection to delete
                  const items = getCategoryStock(selectedStockCategory);
                  if (items.length === 0) {
                    alert(`No ${selectedStockCategory} items to delete`);
                    return;
                  }
                  
                  // Create item options as a numbered list
                  let message = `Select item to delete:\n`;
                  items.forEach((item, index) => {
                    message += `${index + 1}. ${item.name}\n`;
                  });
                  
                  // Get selection
                  const selection = prompt(message);
                  if (selection) {
                    const index = parseInt(selection, 10) - 1;
                    if (!isNaN(index) && index >= 0 && index < items.length) {
                      const item = items[index];
                      // Ask for confirmation using prompt instead of confirm
                      const deleteConfirmed = window.prompt(`Type 'yes' to confirm deleting ${item.name}:`) === 'yes';
                      if (deleteConfirmed) {
                        deleteStockItem(selectedStockCategory, item.id);
                      }
                    } else {
                      alert('Invalid selection');
                    }
                  }
                }}
              >
                Delete Item
              </button>
              
              <button 
                className="flex-1 py-3 bg-red-500 text-white rounded-md font-medium hover:bg-red-600"
                onClick={() => {
                  // Ask for confirmation using prompt instead of confirm
                  const resetConfirmed = window.prompt('Type \'yes\' to reset all stock to default values. This cannot be undone:') === 'yes';
                  if (resetConfirmed) {
                    resetStock();
                  }
                }}
              >
                Reset to Defaults
              </button>
            </div>
          </div>
        )}
        
        {/* Schedule Tab */}
        {!loading && activeTab === 'schedule' && (
          <div className="p-4">
            {/* API Not Implemented Notification */}
            <DismissibleInfoPanel
              id="scheduleInfoPanel"
              title="Schedule API Not Implemented"
              message="The schedule backend API has not been implemented yet. This section will show real data once the backend API is connected."
              borderColor="amber"
              bgColor="amber"
              isDismissed={dismissedPanels.scheduleInfoPanel}
              onDismiss={dismissPanel}
            />
          
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-white rounded-lg shadow-md p-4">
                <h2 className="text-xl font-bold mb-4">Today's Schedule</h2>
                <div className="space-y-2">
                  {scheduleLoading ? (
                    <div className="text-center py-6">
                      <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-b-2 border-amber-600 mx-auto"></div>
                      <p className="mt-2 text-gray-500">Loading schedule data...</p>
                    </div>
                  ) : scheduleData.shifts && scheduleData.shifts.length > 0 ? (
                    scheduleData.shifts.map(item => {
                      // Format the schedule item for display
                      const formattedItem = {
                        id: item.id,
                        start: item.start_time || '9:00',
                        end: item.end_time || '17:00',
                        status: item.status || 'active',
                        barista: item.staff_name || 'Barista'
                      };
                      return renderScheduleItem(formattedItem, 'shift');
                    })
                  ) : (
                    <div className="text-center py-6 text-gray-500">
                      <p>No schedule data available for this station</p>
                      <p className="text-sm text-gray-400">Create schedules in the Organiser interface</p>
                    </div>
                  )}
                </div>
              </div>
              
              <div className="bg-white rounded-lg shadow-md p-4">
                <h2 className="text-xl font-bold mb-4">Breaks</h2>
                <div className="space-y-2">
                  {scheduleLoading ? (
                    <div className="text-center py-6">
                      <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-b-2 border-amber-600 mx-auto"></div>
                      <p className="mt-2 text-gray-500">Loading break data...</p>
                    </div>
                  ) : scheduleData.breaks && scheduleData.breaks.length > 0 ? (
                    scheduleData.breaks.map(item => renderScheduleItem(item, 'break'))
                  ) : (
                    <div className="text-center py-6 text-gray-500">
                      <p>No break data available</p>
                      <p className="text-sm text-gray-400">Break scheduling will be added soon</p>
                    </div>
                  )}
                </div>
              </div>
              
              <div className="bg-white rounded-lg shadow-md p-4 md:col-span-2">
                <h2 className="text-xl font-bold mb-4">Predicted Rush Periods</h2>
                <div className="space-y-2">
                  {scheduleLoading ? (
                    <div className="text-center py-6">
                      <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-b-2 border-amber-600 mx-auto"></div>
                      <p className="mt-2 text-gray-500">Loading rush period data...</p>
                    </div>
                  ) : scheduleData.rushPeriods && scheduleData.rushPeriods.length > 0 ? (
                    scheduleData.rushPeriods.map(item => renderScheduleItem(item, 'rush'))
                  ) : (
                    <div className="text-center py-6 text-gray-500">
                      <p>No rush period data available</p>
                      <p className="text-sm text-gray-400">Rush period analytics will be added soon</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
        
        {/* Completed Orders Tab */}
        {!loading && activeTab === 'completed' && (
          <div>
            <div className="bg-white rounded-lg shadow-md p-4 mb-4">
              <h2 className="text-xl font-bold mb-3">Completed Orders</h2>
              <div className="flex space-x-2 mb-4">
                <button 
                  className={`${historyTab === 'completed' ? 'bg-amber-600 text-white' : 'bg-gray-200 hover:bg-gray-300'} px-6 py-2 rounded-full`}
                  onClick={() => setHistoryTab('completed')}
                >
                  Today
                </button>
                <button 
                  className={`${historyTab === 'yesterday' ? 'bg-amber-600 text-white' : 'bg-gray-200 hover:bg-gray-300'} px-6 py-2 rounded-full`}
                  onClick={() => {
                    setHistoryTab('yesterday');
                    fetchYesterdayOrders();
                  }}
                >
                  Yesterday
                </button>
                <button 
                  className={`${historyTab === 'thisWeek' ? 'bg-amber-600 text-white' : 'bg-gray-200 hover:bg-gray-300'} px-6 py-2 rounded-full`}
                  onClick={() => {
                    setHistoryTab('thisWeek');
                    fetchThisWeekOrders();
                  }}
                >
                  This Week
                </button>
                <button 
                  className={`${historyTab === 'search' ? 'bg-amber-600 text-white' : 'bg-gray-200 hover:bg-gray-300'} px-6 py-2 rounded-full ml-auto`}
                  onClick={() => setHistoryTab('search')}
                >
                  Search Orders
                </button>
              </div>
              
              {/* Search Box - Only shown when search tab is active */}
              {historyTab === 'search' && (
                <div className="mb-4">
                  <div className="flex">
                    <input
                      type="text"
                      placeholder="Search by customer name, order number, or coffee type..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="flex-1 p-2 border rounded-l-md"
                    />
                    <button
                      className="bg-amber-600 text-white px-4 py-2 rounded-r-md"
                      onClick={() => searchOrders(searchTerm)}
                    >
                      Search
                    </button>
                  </div>
                </div>
              )}
            </div>
            
            {/* Content based on active history tab */}
            {historyTab === 'completed' && (
              <>
                <h3 className="text-xl font-bold mb-3 ml-2">Ready for Pickup</h3>
                <div className="space-y-2 mb-6">
                  {completedOrders.length > 0 ? (
                    completedOrders.map(order => renderCompletedOrder(order))
                  ) : (
                    <div className="text-center py-6 bg-white rounded-lg shadow-sm text-gray-500">
                      <p>No orders ready for pickup</p>
                    </div>
                  )}
                </div>
                
                <h3 className="text-xl font-bold mb-3 ml-2">Previously Completed</h3>
                <div className="space-y-2">
                  {previousOrders.length > 0 ? (
                    previousOrders.map(order => renderPreviousOrder(order))
                  ) : (
                    <div className="text-center py-6 bg-white rounded-lg shadow-sm text-gray-500">
                      <p>No previous orders to display</p>
                    </div>
                  )}
                </div>
              </>
            )}
            
            {historyTab === 'yesterday' && (
              <>
                <h3 className="text-xl font-bold mb-3 ml-2">Yesterday's Orders</h3>
                <div className="space-y-2">
                  {loading ? (
                    <div className="text-center py-6 bg-white rounded-lg shadow-sm">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-600 mx-auto mb-2"></div>
                      <p className="text-gray-500">Loading yesterday's orders...</p>
                    </div>
                  ) : yesterdayOrders.length > 0 ? (
                    yesterdayOrders.map(order => renderPreviousOrder(order))
                  ) : (
                    <div className="text-center py-6 bg-white rounded-lg shadow-sm text-gray-500">
                      <p>No orders from yesterday</p>
                    </div>
                  )}
                </div>
              </>
            )}
            
            {historyTab === 'thisWeek' && (
              <>
                <h3 className="text-xl font-bold mb-3 ml-2">This Week's Orders</h3>
                <div className="space-y-2">
                  {loading ? (
                    <div className="text-center py-6 bg-white rounded-lg shadow-sm">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-600 mx-auto mb-2"></div>
                      <p className="text-gray-500">Loading this week's orders...</p>
                    </div>
                  ) : thisWeekOrders.length > 0 ? (
                    thisWeekOrders.map(order => renderPreviousOrder(order))
                  ) : (
                    <div className="text-center py-6 bg-white rounded-lg shadow-sm text-gray-500">
                      <p>No orders from this week</p>
                    </div>
                  )}
                </div>
              </>
            )}
            
            {historyTab === 'search' && (
              <>
                <h3 className="text-xl font-bold mb-3 ml-2">Search Results</h3>
                <div className="space-y-2">
                  {loading ? (
                    <div className="text-center py-6 bg-white rounded-lg shadow-sm">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-600 mx-auto mb-2"></div>
                      <p className="text-gray-500">Searching orders...</p>
                    </div>
                  ) : searchTerm ? (
                    searchResults.length > 0 ? (
                      searchResults.map(order => renderPreviousOrder(order))
                    ) : (
                      <div className="text-center py-6 bg-white rounded-lg shadow-sm text-gray-500">
                        <p>No orders match your search</p>
                      </div>
                    )
                  ) : (
                    <div className="text-center py-6 bg-white rounded-lg shadow-sm text-gray-500">
                      <p>Enter a search term to find orders</p>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}
        
        {/* Settings Tab */}
        {!loading && activeTab === 'settings' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4">
            <div className="bg-white rounded-lg shadow-md p-4">
              <h2 className="text-xl font-bold mb-4">Auto-Refresh Settings</h2>
              <div className="space-y-4">
                <div>
                  <label className="flex items-center space-x-2">
                    <input 
                      type="checkbox" 
                      checked={autoRefreshEnabled}
                      onChange={toggleAutoRefresh}
                    />
                    <span>Enable automatic refreshing of order data</span>
                  </label>
                </div>
                
                {autoRefreshEnabled && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Refresh interval (seconds)
                    </label>
                    <div className="flex items-center">
                      <input 
                        type="number" 
                        min="5" 
                        max="300"
                        value={autoRefreshInterval}
                        onChange={(e) => updateAutoRefreshInterval(parseInt(e.target.value))}
                        className="w-20 p-2 border rounded mr-2"
                      />
                      <span className="text-sm text-gray-500">
                        {autoRefreshInterval < 15 ? '(Fast refresh may impact performance)' : ''}
                      </span>
                    </div>
                  </div>
                )}
                
                <div className="mt-4">
                  <button 
                    className="px-4 py-2 bg-amber-600 text-white rounded hover:bg-amber-700 flex items-center"
                    onClick={() => {
                      // Make sure we preserve the current station when refreshing
                      const currentStation = stations.find(s => s.id === selectedStation);
                      console.log(`Refreshing with station: ${currentStation?.name || 'Unknown'} (ID: ${selectedStation})`);
                      
                      // Update localStorage to ensure consistency
                      localStorage.setItem('coffee_cue_selected_station', selectedStation.toString());
                      localStorage.setItem('last_used_station_id', selectedStation.toString());
                      
                      // Refresh the data
                      refreshData();
                    }}
                  >
                    <RefreshCw size={16} className={`mr-1 ${isRefreshing ? 'animate-spin' : ''}`} />
                    Refresh Now
                  </button>
                </div>
              </div>
            </div>
            
            <div className="bg-white rounded-lg shadow-md p-4">
              <h2 className="text-xl font-bold mb-4">Station Settings</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Station Name
                  </label>
                  <input 
                    type="text" 
                    value={settings.stationName}
                    onChange={(e) => setSettings({...settings, stationName: e.target.value})}
                    className="w-full p-2 border rounded"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Station Location
                  </label>
                  <input 
                    type="text" 
                    value={settings.stationLocation}
                    onChange={(e) => setSettings({...settings, stationLocation: e.target.value})}
                    className="w-full p-2 border rounded"
                    placeholder="e.g., Main Hall, Registration Area, etc."
                  />
                </div>
                
                <button
                  className="mt-4 px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 flex items-center"
                  onClick={() => {
                    // Save station name to localStorage for persistence
                    try {
                      localStorage.setItem(`coffee_station_name_${selectedStation}`, settings.stationName);
                      localStorage.setItem(`coffee_station_location_${selectedStation}`, settings.stationLocation);
                      // Also update station state if needed via StationsService
                      updateStation && updateStation({
                        id: selectedStation,
                        name: settings.stationName,
                        location: settings.stationLocation
                      });
                      alert('Station settings saved successfully!');
                    } catch (error) {
                      console.error('Error saving station settings:', error);
                      alert('Error saving station settings. Please try again.');
                    }
                  }}
                >
                  <Check size={18} className="mr-1" />
                  Save Station Settings
                </button>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Barista Name
                  </label>
                  <input 
                    type="text" 
                    value={settings.baristaName}
                    onChange={(e) => {
                      const newBaristaName = e.target.value;
                      // Update settings state
                      setSettings({...settings, baristaName: newBaristaName});
                      // Save to localStorage for persistence with station-specific key
                      try {
                        const numericStationId = typeof selectedStation === 'string' 
                          ? parseInt(selectedStation, 10) 
                          : selectedStation;
                        localStorage.setItem(`coffee_barista_name_station_${numericStationId}`, newBaristaName);
                      } catch (error) {
                        console.error('Failed to save station-specific barista name to localStorage:', error);
                      }
                    }}
                    className="w-full p-2 border rounded"
                  />
                </div>
                
                <div>
                  <label className="flex items-center space-x-2">
                    <input 
                      type="checkbox" 
                      checked={settings.soundEnabled}
                      onChange={(e) => {
                        const newSoundEnabled = e.target.checked;
                        setSettings({...settings, soundEnabled: newSoundEnabled});
                        
                        // Update localStorage and trigger event for sound system
                        localStorage.setItem('coffee_sound_enabled', newSoundEnabled ? 'true' : 'false');
                        window.dispatchEvent(new CustomEvent('app:toggleSound', { 
                          detail: { enabled: newSoundEnabled } 
                        }));
                        
                        // Play test sound if enabled
                        if (newSoundEnabled && window.coffeeSounds) {
                          window.coffeeSounds.play('newOrder');
                        } else if (newSoundEnabled) {
                          // Direct event dispatch fallback if coffeeSounds not available
                          setTimeout(() => {
                            window.dispatchEvent(new CustomEvent('app:newOrder'));
                          }, 300);
                        }
                      }}
                    />
                    <span>Sound Enabled</span>
                  </label>
                  {settings.soundEnabled && (
                    <button
                      className="mt-2 px-3 py-1 bg-blue-500 text-white text-sm rounded hover:bg-blue-600 ml-6"
                      onClick={() => {
                        if (window.coffeeSounds) {
                          window.coffeeSounds.testSounds();
                        }
                      }}
                    >
                      Test Sounds
                    </button>
                  )}
                </div>
                
                <div>
                  <label className="flex items-center space-x-2">
                    <input 
                      type="checkbox" 
                      checked={settings.autoPrintLabels}
                      onChange={(e) => setSettings({...settings, autoPrintLabels: e.target.checked})}
                    />
                    <span>Auto-print labels</span>
                  </label>
                </div>
              </div>
            </div>
            
            {/* NEW: Notification Settings section */}
            <div className="bg-white rounded-lg shadow-md p-4">
              <h2 className="text-xl font-bold mb-4">Notification Settings</h2>
              <NotificationSettings />
            </div>
            
            <div className="bg-white rounded-lg shadow-md p-4 mb-4">
              <h2 className="text-xl font-bold mb-4">Info Panels</h2>
              <p className="text-sm text-gray-600 mb-4">Information panels can be dismissed by clicking the X in the corner. You can restore all dismissed panels here.</p>
              
              <button
                className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 flex items-center"
                onClick={restoreAllPanels}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-2">
                  <path d="M3 2v6h6"></path>
                  <path d="M3 13a9 9 0 1 0 3-7.7L3 8"></path>
                </svg>
                Restore All Info Panels
              </button>
            </div>
            
            <div className="bg-white rounded-lg shadow-md p-4">
              <h2 className="text-xl font-bold mb-4">Display Settings</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Display Mode
                  </label>
                  <select 
                    value={settings.displayMode}
                    onChange={(e) => setSettings({...settings, displayMode: e.target.value})}
                    className="w-full p-2 border rounded"
                  >
                    <option value="landscape">Landscape</option>
                    <option value="portrait">Portrait</option>
                  </select>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Display Timeout (minutes)
                  </label>
                  <input 
                    type="number" 
                    min="1" 
                    max="60"
                    value={settings.displayTimeout}
                    onChange={(e) => setSettings({...settings, displayTimeout: parseInt(e.target.value)})}
                    className="w-full p-2 border rounded"
                  />
                </div>
              </div>
            </div>
            
            <div className="bg-white rounded-lg shadow-md p-4">
              <h2 className="text-xl font-bold mb-4">System Information</h2>
              <div className="text-sm text-gray-600 space-y-2">
                <div>Version: 1.2.0</div>
                <div>Station: {
                  (() => {
                    // Try to get custom name from localStorage first
                    if (selectedStation) {
                      try {
                        const customName = localStorage.getItem(`coffee_station_name_${selectedStation}`);
                        if (customName) {
                          return customName;
                        }
                      } catch (e) {
                        console.error('Error getting custom station name for system info:', e);
                      }
                    }
                    // Fall back to station from list
                    return stations.find(s => s.id === selectedStation)?.name || 'Unknown';
                  })()
                }</div>
                <div>Last Sync: {new Date().toLocaleString()}</div>
                <div>API Status: {online ? 'Connected' : 'Offline'}</div>
                <div>App Mode: {isDemoMode ? 'Demo' : 'Production'}</div>
              </div>
              
              <div className="mt-4 flex justify-between">
                <button 
                  className="px-4 py-2 bg-amber-600 text-white rounded hover:bg-amber-700"
                  onClick={toggleAppMode}
                >
                  Toggle Demo Mode
                </button>
                <button 
                  className="px-4 py-2 bg-amber-600 text-white rounded hover:bg-amber-700"
                  onClick={() => {
                    // Save barista name to localStorage with station-specific key
                    try {
                      const numericStationId = typeof selectedStation === 'string' 
                        ? parseInt(selectedStation, 10) 
                        : selectedStation;
                      localStorage.setItem(`coffee_barista_name_station_${numericStationId}`, settings.baristaName);
                    } catch (error) {
                      console.error('Failed to save station-specific barista name to localStorage:', error);
                    }
                    
                    // Always save station name to localStorage for resilience
                    if (selectedStation && settings.stationName) {
                      try {
                        // Save custom station name in localStorage keyed by station id
                        localStorage.setItem(`coffee_station_name_${selectedStation}`, settings.stationName);
                        console.log(`Saved custom station name to localStorage: ${settings.stationName}`);
                      } catch (e) {
                        console.error('Error saving custom station name to localStorage:', e);
                      }

                      // Also update the station in the stations array in localStorage
                      try {
                        const savedStations = localStorage.getItem('coffee_cue_stations');
                        if (savedStations) {
                          const stations = JSON.parse(savedStations);
                          const updatedStations = stations.map(station => 
                            station.id === selectedStation 
                              ? { ...station, name: settings.stationName, location: settings.stationLocation }
                              : station
                          );
                          localStorage.setItem('coffee_cue_stations', JSON.stringify(updatedStations));
                          console.log('Updated station name in cached stations');
                        }
                      } catch (cacheError) {
                        console.error('Error updating station name in cached stations:', cacheError);
                      }
                      
                      // Update station name and location using the updateStation function from useStations hook
                      updateStation(selectedStation, {
                        name: settings.stationName,
                        location: settings.stationLocation
                      }).then(success => {
                        if (success) {
                          // Refresh station data to ensure changes are reflected immediately
                          refreshStations().then(() => {
                            alert('Settings updated successfully!');
                          });
                        } else {
                          alert('Changes saved locally. Server update failed but your changes will persist.');
                        }
                      }).catch(error => {
                        console.error('Error updating station:', error);
                        // Still consider it a success since we saved to localStorage
                        alert('Changes saved locally. Server connection error: ' + (error.message || 'Unknown error'));
                      });
                    } else {
                      alert('Settings updated successfully!');
                    }
                  }}
                >
                  Save Settings
                </button>
              </div>
            </div>
          </div>
        )}
        
        {/* Display Tab */}
        {!loading && activeTab === 'display' && (
          <div className="p-4">
            {/* API Usage Notification */}
            <DismissibleInfoPanel
              id="displayInfoPanel"
              title="Display Screen Integration"
              message="The display screen currently shows demo data. It requires backend API integration for showing real-time order data."
              borderColor="amber"
              bgColor="amber"
              isDismissed={dismissedPanels.displayInfoPanel}
              onDismiss={dismissPanel}
            />
            
            <div className="bg-white rounded-lg shadow-md p-4 mb-4">
              <h2 className="text-xl font-bold mb-4">Display Screen Settings</h2>
              <p className="mb-4">Control what appears on the customer-facing display screen.</p>
              
              <div className="flex space-x-4 mb-4">
                <button 
                  className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                  onClick={() => {
                    alert('The display screen currently shows demo data. Backend API integration is required for real-time order display.');
                    openDisplayScreen();
                  }}
                >
                  Open Display Screen
                </button>
                <button 
                  className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300"
                  onClick={() => alert('Test display feature requires backend API implementation.')}
                >
                  Test Display
                </button>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Display Header
                  </label>
                  <input 
                    type="text" 
                    value={settings.stationName}
                    onChange={(e) => setSettings({...settings, stationName: e.target.value})}
                    className="w-full p-2 border rounded"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Custom Message
                  </label>
                  <input 
                    type="text" 
                    placeholder="Enjoy your coffee!"
                    className="w-full p-2 border rounded"
                  />
                </div>
              </div>
            </div>
            
            <div className="bg-white rounded-lg shadow-md p-4">
              <h2 className="text-xl font-bold mb-4">Preview</h2>
              <div className="border p-4 rounded-lg bg-gray-50">
                <div className="bg-amber-800 text-white p-4 text-center">
                  <h1 className="text-2xl font-bold">{settings.stationName}</h1>
                  <p>Ready for Pickup</p>
                  <div className="text-sm text-gray-200 mt-1">Station #{selectedStation}</div>
                </div>
                
                <div className="p-4">
                  {/* Show only orders for this specific station */}
                  {completedOrders.length > 0 ? (
                    <div className="space-y-2">
                      {completedOrders.slice(0, 3).map(order => (
                        <div key={order.id} className="border-l-4 border-green-500 bg-white p-3 rounded shadow-sm">
                          <div className="font-bold">
                            {settings.showNameOnDisplay ? order.customerName : `Order #${order.id}`}
                          </div>
                          <div>{order.coffeeType || 'Coffee'}</div>
                          {order.alternativeMilk && (
                            <div className="text-xs text-blue-600">Alternative Milk</div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-6 text-gray-500">
                      <p>No orders ready for pickup at Station #{selectedStation}</p>
                      <p className="text-sm text-gray-400">Complete orders to see them here</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Action Bar */}
      <div className="sticky bottom-0 bg-white p-3 shadow-lg flex justify-between border-t border-gray-200">
        <div className="flex space-x-2">
          <button 
            className="px-4 py-2 bg-gray-200 rounded flex items-center hover:bg-gray-300 transition-colors"
            onClick={() => setShowWalkInDialog(true)}
          >
            <Plus size={18} className="mr-1" /> Add Walk-in Order
          </button>
          <button 
            className="px-4 py-2 bg-gray-200 rounded flex items-center hover:bg-gray-300 transition-colors"
            onClick={() => setShowWaitTimeDialog(true)}
          >
            <Clock size={18} className="mr-1" /> Adjust Wait Time
          </button>
          <button 
            className="px-4 py-2 bg-gray-200 rounded flex items-center hover:bg-gray-300 transition-colors"
            onClick={() => {
              // Refresh stations, orders, and schedule data
              refreshStations();
              refreshData();
              refreshScheduleData();
            }}
          >
            <RefreshCw size={18} className={`mr-1 ${isRefreshing ? 'animate-spin' : ''}`} />
            {isRefreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
        
        {/* Removed Break Time and Need Help buttons as they're redundant with organiser settings and help at the top */}
      </div>
      
      {/* Chat Button */}
      <button 
        className="fixed bottom-16 right-4 bg-blue-500 text-white p-3 rounded-full shadow-lg hover:bg-blue-600"
        onClick={() => {
          setChatOpen(!chatOpen);
          if (!chatOpen) {
            setUnreadMessages(0);
          }
        }}
      >
        <MessageCircle size={24} />
        {unreadMessages > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs w-5 h-5 flex items-center justify-center rounded-full">
            {unreadMessages}
          </span>
        )}
      </button>
      
      {/* Dialogs */}
      {showWaitTimeDialog && (
        <WaitTimeDialog 
          currentWaitTime={waitTime}
          onSubmit={handleAdjustWaitTime}
          onClose={() => setShowWaitTimeDialog(false)}
        />
      )}
      
      {showWalkInDialog && (
        <WalkInOrderDialog 
          onSubmit={handleWalkInOrder}
          onClose={() => setShowWalkInDialog(false)}
        />
      )}
      
      {/* Updated MessageDialog to handle messages more reliably */}
      {showMessageDialog && currentMessageOrder && (
        <MessageDialog 
          order={currentMessageOrder}
          onSubmit={(orderId, message) => {
            sendMessage(orderId, message)
              .then(success => {
                if (success) {
                  setShowMessageDialog(false);
                  setCurrentMessageOrder(null);
                  // Optionally show success notification
                } else {
                  // Optionally show error notification
                }
              })
              .catch(err => {
                console.error('Message send error:', err);
              });
          }}
          onClose={() => {
            setShowMessageDialog(false);
            setCurrentMessageOrder(null);
          }}
        />
      )}
      
      {showHelpDialog && (
        <div className="fixed inset-0 flex items-center justify-center z-50 bg-black bg-opacity-50">
          <div className="bg-white p-6 rounded-lg shadow-lg max-w-lg w-full max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold">Help</h3>
              <button 
                className="text-gray-500 hover:text-gray-700" 
                onClick={() => setShowHelpDialog(false)}
              >
                &times;
              </button>
            </div>
            
            <div className="space-y-4">
              <p>If you need assistance with the coffee station system, please contact:</p>
              <ul className="list-disc pl-5 space-y-2">
                <li><strong>Technical Support:</strong> 123-456-7890</li>
                <li><strong>Event Manager:</strong> 098-765-4321</li>
              </ul>
              
              <div className="bg-gray-100 p-4 rounded">
                <h4 className="font-medium mb-2">Quick Tips:</h4>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Use the batch mode to complete multiple orders at once</li>
                  <li>Refresh the order list if you don't see new orders</li>
                  <li>Check Chat for communications from other stations</li>
                </ul>
              </div>
              
              <button 
                className="w-full bg-blue-500 text-white py-2 px-4 rounded hover:bg-blue-600"
                onClick={() => setShowHelpDialog(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Chat panel */}
      {chatOpen && (
        <StationChat 
          onClose={() => setChatOpen(false)}
          onMessageRead={() => setUnreadMessages(0)}
          stations={stations}
          currentStationId={selectedStation}
          currentStationName={stations.find(s => s.id === selectedStation)?.name || 'Unknown Station'}
          baristaName={settings.baristaName}
          onBaristaNameChange={(name) => setSettings({...settings, baristaName: name})}
        />
      )}
    </div>
  );
};

export default BaristaInterface;