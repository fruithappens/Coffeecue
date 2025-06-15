// hooks/useOrders.js
import { useState, useEffect, useCallback, useRef } from 'react';
import OrderDataService from '../services/OrderDataService';
import StockService from '../services/StockService';
import { calculateWaitTime } from '../utils/orderUtils';

export default function useOrders(stationId = null) {
  // State for different order types
  const [pendingOrders, setPendingOrders] = useState([]);
  const [inProgressOrders, setInProgressOrders] = useState([]);
  const [completedOrders, setCompletedOrders] = useState([]);
  const [previousOrders, setPreviousOrders] = useState([]);
  
  // Debug function to track previousOrders changes
  useEffect(() => {
    console.log(`📋 Previously Completed Orders updated: ${previousOrders.length} orders`);
    if (previousOrders.length > 0) {
      console.log('Previous orders details:', previousOrders.map(o => ({
        id: o.id,
        customer: o.customerName,
        pickedUpAt: o.pickedUpAt,
        status: o.status
      })));
    }
  }, [previousOrders]);
  const [historyOrders, setHistoryOrders] = useState([]);
  const [yesterdayOrders, setYesterdayOrders] = useState([]);
  const [thisWeekOrders, setThisWeekOrders] = useState([]);
  const [searchResults, setSearchResults] = useState([]);
  
  // Enhanced station ID management with fallback
  const [currentStationId, setCurrentStationId] = useState(() => {
    // If stationId is provided, use it
    if (stationId) return stationId;
    
    // Otherwise try to get from localStorage
    try {
      const savedStation = localStorage.getItem('coffee_cue_selected_station') || 
                          localStorage.getItem('last_used_station_id');
      if (savedStation) {
        const parsedId = parseInt(savedStation, 10);
        if (!isNaN(parsedId)) {
          console.log(`[useOrders] Using saved station ID: ${parsedId}`);
          return parsedId;
        }
      }
    } catch (e) {
      console.error('[useOrders] Error loading station from localStorage:', e);
    }
    
    // Default to station 1 if nothing else is available
    console.log('[useOrders] No station ID provided, defaulting to station 1');
    return 1;
  });

  // Sync station ID when prop changes
  useEffect(() => {
    if (stationId !== currentStationId) {
      console.log(`[useOrders] Station ID prop changed from ${currentStationId} to ${stationId}, syncing...`);
      
      // Save current orders to cache before switching
      if (currentStationId) {
        const ordersCache = {
          pendingOrders,
          inProgressOrders,
          completedOrders,
          previousOrders,
          timestamp: Date.now()
        };
        
        try {
          const cacheKey = `orders_cache_station_${currentStationId}`;
          const serializedCache = JSON.stringify(ordersCache);
          localStorage.setItem(cacheKey, serializedCache);
          sessionStorage.setItem(cacheKey, serializedCache);
          console.log(`Saved orders for station ${currentStationId} before switching`);
        } catch (e) {
          console.error('Error saving orders before station switch:', e);
        }
      }
      
      // Clear current orders to prevent them from showing in the new station
      setPendingOrders([]);
      setInProgressOrders([]);
      setCompletedOrders([]);
      setPreviousOrders([]);
      
      // Update the station ID
      setCurrentStationId(stationId);
      
      // Load cached orders for the new station immediately
      try {
        const newStationCacheKey = `orders_cache_station_${stationId}`;
        const cachedData = localStorage.getItem(newStationCacheKey) || sessionStorage.getItem(newStationCacheKey);
        
        if (cachedData) {
          const parsedCache = JSON.parse(cachedData);
          console.log(`Loading cached orders for station ${stationId}:`, {
            pending: parsedCache.pendingOrders?.length || 0,
            inProgress: parsedCache.inProgressOrders?.length || 0,
            completed: parsedCache.completedOrders?.length || 0,
            previous: parsedCache.previousOrders?.length || 0
          });
          
          // Restore the cached orders for this station
          setTimeout(() => {
            if (parsedCache.pendingOrders) {
              console.log(`Restoring ${parsedCache.pendingOrders.length} pending orders for station ${stationId}`);
              setPendingOrders(parsedCache.pendingOrders);
            }
            if (parsedCache.inProgressOrders) {
              console.log(`Restoring ${parsedCache.inProgressOrders.length} in-progress orders for station ${stationId}`);
              setInProgressOrders(parsedCache.inProgressOrders);
            }
            if (parsedCache.completedOrders) {
              console.log(`Restoring ${parsedCache.completedOrders.length} completed orders for station ${stationId}`);
              setCompletedOrders(parsedCache.completedOrders);
            }
            if (parsedCache.previousOrders) {
              console.log(`Restoring ${parsedCache.previousOrders.length} previous orders for station ${stationId}`);
              setPreviousOrders(parsedCache.previousOrders);
            } else {
              console.log(`No previous orders found in cache for station ${stationId}`);
            }
          }, 0);
        } else {
          console.log(`No cached orders found for station ${stationId}`);
        }
      } catch (e) {
        console.error('Error loading cached orders for new station:', e);
      }
      
      // The fetchOrdersData will be triggered by the effect that depends on currentStationId
    }
  }, [stationId, currentStationId]); // FIXED: Removed order arrays to prevent recursive caching

  // UI state
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [online, setOnline] = useState(true);
  const [queueCount, setQueueCount] = useState(0);
  const [lastUpdated, setLastUpdated] = useState(Date.now());
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  // Auto-refresh settings
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(
    localStorage.getItem('coffee_auto_refresh_enabled') === 'true'
  );
  const [autoRefreshInterval, setAutoRefreshInterval] = useState(() => {
    // Get saved interval from localStorage or use default
    const savedInterval = parseInt(localStorage.getItem('coffee_auto_refresh_interval'));
    
    // Enforce minimum interval of 30 seconds to prevent UI flickering
    if (!savedInterval || isNaN(savedInterval) || savedInterval < 30) {
      // Use 60 seconds as default if no valid value exists - much longer to prevent flickering
      const defaultInterval = 60;
      localStorage.setItem('coffee_auto_refresh_interval', defaultInterval.toString());
      return defaultInterval;
    }
    
    return savedInterval;
  }); // Increased minimum to 30 seconds and default to 60 seconds to prevent flickering
  
  // Station performance stats
  const [stationStats, setStationStats] = useState({
    avgPrepTime: 0, // Average time from start to completion in minutes
    prepTimes: [], // Array of individual prep times for calculating average
    totalCompleted: 0, // Total completed orders for this station
    lastCalculated: null // When stats were last calculated
  });

  // Declare updateWaitTime early for use in fetchOrdersData
  const updateWaitTime = useCallback(async (waitTime) => {
    if (!waitTime || isNaN(parseInt(waitTime))) {
      setError('Cannot update wait time: Invalid wait time');
      return false;
    }
    
    try {
      // Add station ID to the wait time update
      const waitTimeData = {
        waitTime: parseInt(waitTime),
        stationId: currentStationId
      };
      
      console.log(`Updating wait time to ${waitTime} min for station ${currentStationId}`);
      
      // Try to update on server
      const result = await OrderDataService.updateWaitTime(waitTimeData);
      
      if (!result || !result.success) {
        // Even if the server call fails, we'll update the UI anyway for a responsive experience
        console.log('Server call failed but updating UI for consistency');
      }
      
      // Store the wait time in localStorage for this station
      localStorage.setItem(`station_${currentStationId}_wait_time`, waitTime);
      
      // Return success so the UI can update
      return true;
    } catch (err) {
      console.error('Update wait time error:', err);
      
      // Even on error, store the wait time locally for this station
      localStorage.setItem(`station_${currentStationId}_wait_time`, waitTime);
      
      // Don't show the error so the UI can still update
      return true;
    }
  }, [currentStationId]);

  // Fetch initial data and set up polling
  const fetchOrdersData = useCallback(async (showLoading = true) => {
    // Check if we're in fallback or auth error mode first
    const useFallbackData = localStorage.getItem('use_fallback_data') === 'true';
    const authErrorRefreshNeeded = localStorage.getItem('auth_error_refresh_needed') === 'true';
    
    // If we're in auth error mode and using fallback data, we need to prioritize loading the fallback data
    if (authErrorRefreshNeeded || useFallbackData) {
      console.log('In fallback/auth error mode - loading fallback data directly');
      
      // Load fallback data immediately
      try {
        // Get fallback data from localStorage
        const fallbackPendingOrders = JSON.parse(localStorage.getItem('fallback_pending_orders') || '[]');
        const fallbackInProgressOrders = JSON.parse(localStorage.getItem('fallback_in_progress_orders') || '[]');
        const fallbackCompletedOrders = JSON.parse(localStorage.getItem('fallback_completed_orders') || '[]');
        const fallbackPreviousOrders = JSON.parse(localStorage.getItem('fallback_previous_orders') || '[]');
        
        console.log('Loaded fallback data:', {
          pending: fallbackPendingOrders.length,
          inProgress: fallbackInProgressOrders.length,
          completed: fallbackCompletedOrders.length,
          previous: fallbackPreviousOrders.length
        });
        
        // Set fallback data directly to avoid loading spinner
        setTimeout(() => {
          // Update all state directly with fallback data
          setPendingOrders(fallbackPendingOrders);
          setInProgressOrders(fallbackInProgressOrders);
          setCompletedOrders(fallbackCompletedOrders);
          setPreviousOrders(fallbackPreviousOrders);
          
          // Make sure loading is set to false
          setLoading(false);
          setIsRefreshing(false);
          setError(null);
          
          // Set online status to false
          setOnline(false);
        }, 0);
        
        return;
      } catch (fallbackError) {
        console.error('Error loading fallback data:', fallbackError);
      }
    }
    
    // Regular flow for when we're not in fallback mode
    if (showLoading) {
      setLoading(true);
    }
    
    setIsRefreshing(true);
    
    try {
      // Check connection status with debouncing to prevent flickering
      // Only update online status if it's been more than 5 seconds since the last check
      // or if we're explicitly doing a full refresh (showLoading = true)
      const connectionCheckKey = 'last_connection_check_time';
      const now = Date.now();
      const lastConnectionCheck = parseInt(sessionStorage.getItem(connectionCheckKey) || '0');
      const timeSinceLastCheck = now - lastConnectionCheck;
      
      // Minimum time between online status updates (5 seconds)
      const CONNECTION_CHECK_DEBOUNCE_MS = 5000;
      
      // Check connection if enough time has passed or we're doing a full refresh
      if (showLoading || timeSinceLastCheck > CONNECTION_CHECK_DEBOUNCE_MS || !online) {
        const isConnected = await OrderDataService.checkConnection();
        
        // Only update UI state if connection status has changed or doing full refresh
        if (isConnected !== online || showLoading) {
          console.log(`Connection status changed: ${online} -> ${isConnected}`);
          // Don't directly set state here - instead, use a ref to track the online status
          // and only update at the end of this function to avoid render loops
          const newOnlineStatus = isConnected;
          window._tempOnlineStatus = newOnlineStatus; // Store in a temporary global for later update
        }
        
        // Update last check timestamp
        sessionStorage.setItem(connectionCheckKey, now.toString());
      } else {
        console.log(`Skipping connection check (last check was ${timeSinceLastCheck}ms ago)`);
      }
      
      // Try to load cached orders first as a fallback
      const cachedOrdersKey = `orders_cache_station_${currentStationId}`;
      let cachedOrders = null;
      try {
        const cachedOrdersStr = localStorage.getItem(cachedOrdersKey);
        if (cachedOrdersStr) {
          cachedOrders = JSON.parse(cachedOrdersStr);
          console.log(`Loaded cached orders for station ${currentStationId}`);
        }
      } catch (e) {
        console.error('Error loading cached orders:', e);
      }
      
      // Fetch orders
      const [pending, inProgress, completed] = await Promise.all([
        OrderDataService.getPendingOrders(),
        OrderDataService.getInProgressOrders(),
        OrderDataService.getCompletedOrders()
      ]);
      
      // Filter orders by station if a station ID is set
      const filterByStation = (orders) => {
        if (!currentStationId) return orders || [];
        
        console.log(`Filtering orders for station ${currentStationId}`);
        
        // When station ID is set, strictly filter to show only orders for this station
        return (orders || []).filter(order => {
          // Normalize station IDs for comparison (they might be strings or numbers)
          const normalizedCurrentStationId = String(currentStationId).toLowerCase();
          
          // Extract all possible station ID fields and normalize them
          const orderStationIds = [
            order.stationId, 
            order.station_id,
            order.assigned_station,
            order.assignedStation,
            order.assigned_to_station,
            order.station,
            order.barista_station
          ]
          .filter(id => id !== undefined && id !== null)
          .map(id => String(id).toLowerCase());
          
          // Check if any of the station IDs match the current station
          const hasStationMatch = orderStationIds.some(id => id === normalizedCurrentStationId);
          
          // Display debug info for station assignment
          console.log(`Order ${order.id} station fields:`, orderStationIds, 
                      `matches current station ${normalizedCurrentStationId}:`, hasStationMatch);
          
          // STRICT FILTERING: Only show orders that are explicitly assigned to this station
          if (hasStationMatch) {
            return true;
          }
          
          // Check if this order was created locally at this station (walk-in orders)
          const orderCreatedAtThisStation = 
            localStorage.getItem(`order_created_at_station_${order.id}`) === String(currentStationId);
          
          if (orderCreatedAtThisStation) {
            console.log(`Order ${order.id} was created at station ${currentStationId} - showing here`);
            return true;
          }
          
          // EXCEPTION: Only show unassigned orders on station 1 and only if they are SMS orders
          // This prevents walk-in orders from appearing on multiple stations
          if (normalizedCurrentStationId === '1' && orderStationIds.length === 0 && !orderCreatedAtThisStation) {
            // Check if this looks like an SMS order (has phone number and is NOT a walk-in)
            if (order.phoneNumber && order.phoneNumber !== 'Walk-in' && order.phoneNumber !== 'Group-Order' && !order.isWalkIn) {
              console.log(`Order ${order.id} is an unassigned SMS order - showing only at station 1`);
              return true;
            }
          }
          
          return false;
        });
      };
      
      // Update state with filtered data
      const filteredPending = filterByStation(pending);
      const filteredInProgress = filterByStation(inProgress);
      const filteredCompleted = filterByStation(completed);
      
      // Check for new orders that weren't in the previous state
      // Only do this for non-initial loads where we have previous data
      if (pendingOrders.length > 0) {
        const currentPendingIds = new Set(pendingOrders.map(o => o.id));
        const newOrders = filteredPending.filter(o => !currentPendingIds.has(o.id));
        
        if (newOrders.length > 0) {
          console.log(`${newOrders.length} new pending orders detected, triggering sound notification`);
          // Trigger sound notification for new orders
          window.dispatchEvent(new CustomEvent('app:newOrder'));
        }
      }
      
      // Add any local orders from localStorage to pending orders
      let localPendingOrders = [...filteredPending];
      try {
        const localOrdersKey = `local_orders_station_${currentStationId}`;
        const localOrders = JSON.parse(localStorage.getItem(localOrdersKey) || '[]');
        
        if (localOrders.length > 0) {
          console.log(`Found ${localOrders.length} local orders for station ${currentStationId}`);
          
          // Make sure we aren't duplicating any orders that came from the server
          const existingIds = new Set(filteredPending.map(o => o.id));
          const uniqueLocalOrders = localOrders.filter(o => !existingIds.has(o.id));
          
          // Add our local orders to the result
          if (uniqueLocalOrders.length > 0) {
            console.log(`Adding ${uniqueLocalOrders.length} unique local orders to pending orders`);
            localPendingOrders = [...filteredPending, ...uniqueLocalOrders];
          }
        }
      } catch (e) {
        console.error('Error retrieving local orders:', e);
      }
      
      // Batch these updates using temporary variables to avoid render loops
      window._tempPendingOrders = localPendingOrders;
      window._tempInProgressOrders = filteredInProgress;
      
      // Add to temp vars array that will be processed in the finally block
      
      // Split completed orders into "ready for pickup" and "previous"
      const readyOrders = [];
      const pickedUpOrders = [];
      
      filteredCompleted.forEach(order => {
        // Check for both pickedUpAt field AND picked_up status from API
        if (order.pickedUpAt || order.status === 'picked_up') {
          // Ensure pickedUpAt is set for consistency
          if (!order.pickedUpAt && order.status === 'picked_up') {
            order.pickedUpAt = order.updatedAt || new Date();
          }
          pickedUpOrders.push(order);
        } else {
          readyOrders.push(order);
        }
      });
      
      // Batch these updates using temporary variables to avoid render loops
      window._tempCompletedOrders = readyOrders;
      
      // For previousOrders, merge with existing instead of overwriting
      // This preserves orders that were marked as picked up locally
      const existingPreviousOrders = previousOrders || [];
      const combinedPreviousOrders = [...pickedUpOrders];
      
      console.log(`Previous orders merge: server=${pickedUpOrders.length}, existing=${existingPreviousOrders.length}`);
      
      // Add existing previous orders that aren't already in the new list
      existingPreviousOrders.forEach(existingOrder => {
        const alreadyExists = combinedPreviousOrders.some(newOrder => newOrder.id === existingOrder.id);
        if (!alreadyExists) {
          combinedPreviousOrders.unshift(existingOrder); // Add to beginning to maintain order
        }
      });
      
      console.log(`Combined previous orders: ${combinedPreviousOrders.length} total`);
      window._tempPreviousOrders = combinedPreviousOrders;
      
      // Add to temp vars array that will be processed in the finally block
      
      // Cache orders for persistence between tab changes and page refreshes
      try {
        const cachedOrdersKey = `orders_cache_station_${currentStationId}`;
        const ordersCache = {
          pendingOrders: localPendingOrders,
          inProgressOrders: filteredInProgress,
          completedOrders: readyOrders,
          previousOrders: combinedPreviousOrders,
          timestamp: Date.now()
        };
        
        // Serialize once for efficiency
        const serializedCache = JSON.stringify(ordersCache);
        
        // Save to both localStorage and sessionStorage for redundancy
        localStorage.setItem(cachedOrdersKey, serializedCache);
        sessionStorage.setItem(cachedOrdersKey, serializedCache);
        
        // Also maintain a backup copy
        localStorage.setItem(`${cachedOrdersKey}_backup_time`, Date.now().toString());
        localStorage.setItem(`${cachedOrdersKey}_backup`, serializedCache);
        
        console.log(`Cached orders for station ${currentStationId} across all storage locations`);
        
        // Extended debugging for order counts
        console.log(`Order counts in cache - Pending: ${localPendingOrders.length}, ` +
                    `In Progress: ${filteredInProgress.length}, ` +
                    `Ready for Pickup: ${readyOrders.length}, ` +
                    `Completed: ${pickedUpOrders.length}`);
      } catch (e) {
        console.error('Error caching orders:', e);
      }
      
      // Update queue count and trigger wait time calculation if it changed
      const newQueueCount = filteredPending?.length || 0;
      const queueCountChanged = queueCount !== newQueueCount;
      // Store in temp variables to batch updates
      window._tempQueueCount = newQueueCount;
      
      // Only trigger waitTime calculation if queue count changed
      if (queueCountChanged) {
        // Don't directly set state inside a useEffect callback
        // Instead, schedule the wait time calculation for after this function completes
        setTimeout(() => {
          // Use the imported utility function
          // Calculate wait time based on queue count and station stats
          const baseWaitTime = 2; // Base 2 minutes for the first coffee
          const dynamicWaitTime = calculateWaitTime(newQueueCount, baseWaitTime, stationStats);
          
          // Only update if it's different to avoid unnecessary API calls
          updateWaitTime(dynamicWaitTime);
          
          console.log(`Auto-updated wait time to ${dynamicWaitTime}min due to queue change (${newQueueCount} orders)`);
        }, 250);
      }
      
      // Store the last updated time to apply at the end
      const newLastUpdated = Date.now();
      window._tempLastUpdated = newLastUpdated;
      
      // Clear any previous errors on successful fetch
      window._tempError = null;
    } catch (err) {
      window._tempError = `Error fetching orders: ${err.message}`;
      console.error('Error fetching orders:', err);
    } finally {
      // Instead of using window variables, use local variables for batching
      const batchedUpdates = {
        onlineStatus: window._tempOnlineStatus,
        queueCount: window._tempQueueCount,
        lastUpdated: window._tempLastUpdated,
        pendingOrders: window._tempPendingOrders,
        inProgressOrders: window._tempInProgressOrders,
        completedOrders: window._tempCompletedOrders,
        previousOrders: window._tempPreviousOrders,
        error: window._tempError
      };

      // Clean up window vars immediately after capturing them
      const cleanupTempVars = () => {
        const tempVars = [
          '_tempOnlineStatus',
          '_tempQueueCount', 
          '_tempLastUpdated',
          '_tempPendingOrders',
          '_tempInProgressOrders',
          '_tempCompletedOrders',
          '_tempPreviousOrders',
          '_tempError'
        ];
        
        tempVars.forEach(varName => {
          if (window[varName] !== undefined) {
            delete window[varName];
          }
        });
      };
      
      // Clean up immediately
      cleanupTempVars();

      // Create a single state update batch
      const updateStates = () => {
        // Update online status if it has changed
        if (batchedUpdates.onlineStatus !== undefined) {
          setOnline(batchedUpdates.onlineStatus);
        }
        
        // Update queue count
        if (batchedUpdates.queueCount !== undefined) {
          setQueueCount(batchedUpdates.queueCount);
        }
        
        // Update lastUpdated timestamp
        if (batchedUpdates.lastUpdated !== undefined) {
          setLastUpdated(batchedUpdates.lastUpdated);
        }
        
        // Update order lists - CRITICAL: Check for undefined before updating
        if (batchedUpdates.pendingOrders !== undefined && Array.isArray(batchedUpdates.pendingOrders)) {
          setPendingOrders(batchedUpdates.pendingOrders);
        }
        
        if (batchedUpdates.inProgressOrders !== undefined && Array.isArray(batchedUpdates.inProgressOrders)) {
          setInProgressOrders(batchedUpdates.inProgressOrders);
        }
        
        if (batchedUpdates.completedOrders !== undefined && Array.isArray(batchedUpdates.completedOrders)) {
          setCompletedOrders(batchedUpdates.completedOrders);
        }
        
        if (batchedUpdates.previousOrders !== undefined && Array.isArray(batchedUpdates.previousOrders)) {
          setPreviousOrders(batchedUpdates.previousOrders);
        }
        
        // Update error state
        if (batchedUpdates.error !== undefined) {
          setError(batchedUpdates.error);
        } else {
          setError(null);
        }
        
        // Finally, update loading and refreshing states
        setLoading(false);
        setIsRefreshing(false);
        
        // If we're using fallback data (authentication error or offline), make sure loading is disabled
        if (localStorage.getItem('use_fallback_data') === 'true' || 
            localStorage.getItem('auth_error_refresh_needed') === 'true') {
          console.log('Using fallback data, ensuring loading state is disabled');
          setLoading(false);
          setError(null);
        }
      };

      // Use requestAnimationFrame for better timing
      if (window.requestAnimationFrame) {
        window.requestAnimationFrame(updateStates);
      } else {
        setTimeout(updateStates, 0);
      }
    }
  }, [currentStationId, pendingOrders, stationStats, queueCount, updateWaitTime]);

  // Function to update current station ID
  const updateStationId = useCallback((newStationId) => {
    console.log(`[useOrders] Updating station ID to ${newStationId}`);
    // Update state with new station ID
    setCurrentStationId(newStationId);
    
    // Store current station ID in localStorage for persistence
    try {
      localStorage.setItem('last_used_station_id', newStationId.toString());
    } catch (e) {
      console.error('Error saving station ID to localStorage:', e);
    }
    
    // Load station-specific stats when station changes
    try {
      const avgPrepTime = parseFloat(localStorage.getItem(`station_${newStationId}_avg_prep_time`)) || 0;
      const totalCompleted = parseInt(localStorage.getItem(`station_${newStationId}_total_completed`)) || 0;
      
      if (avgPrepTime > 0) {
        setStationStats(prevStats => ({
          ...prevStats,
          avgPrepTime,
          totalCompleted,
          lastCalculated: new Date()
        }));
        
        console.log(`Loaded saved stats for station ${newStationId}: avgPrepTime=${avgPrepTime.toFixed(2)}m, completed=${totalCompleted}`);
      }
    } catch (e) {
      console.error(`Error loading stats for station ${newStationId}:`, e);
    }
    
    // FIXED: Don't call fetchOrdersData here to prevent infinite loops
    // The data will be fetched automatically by other mechanisms
    console.log(`Station updated to ${newStationId} - data will refresh automatically`);
  }, []); // FIXED: Removed fetchOrdersData dependency

  // Set up auto-refresh based on settings
  // Ref to track first load to avoid infinite updates
  const initialLoadRef = useRef(false);
  
  useEffect(() => {
    // Only run backup loading on first render
    if (!initialLoadRef.current) {
      initialLoadRef.current = true;
      
      // Create a batch of cached data to apply at once
      const loadCachedData = async () => {
        try {
          console.log('Checking for order backups before initial fetch');
          
          // First check if we're in fallback or auth error mode
          const useFallbackData = localStorage.getItem('use_fallback_data') === 'true';
          const authErrorRefreshNeeded = localStorage.getItem('auth_error_refresh_needed') === 'true';
          
          // If we're in auth error mode, prioritize loading fallback data
          if (authErrorRefreshNeeded || useFallbackData) {
            console.log('In fallback/auth error mode on initial load - loading fallback data directly');
            
            // Get fallback data from localStorage
            const fallbackPendingOrders = JSON.parse(localStorage.getItem('fallback_pending_orders') || '[]');
            const fallbackInProgressOrders = JSON.parse(localStorage.getItem('fallback_in_progress_orders') || '[]');
            const fallbackCompletedOrders = JSON.parse(localStorage.getItem('fallback_completed_orders') || '[]');
            const fallbackPreviousOrders = JSON.parse(localStorage.getItem('fallback_previous_orders') || '[]');
            
            // Create cached data object
            const cachedData = {
              pendingOrders: fallbackPendingOrders,
              inProgressOrders: fallbackInProgressOrders,
              completedOrders: fallbackCompletedOrders,
              previousOrders: fallbackPreviousOrders
            };
            
            console.log('Loaded fallback data for initial render:', {
              pending: fallbackPendingOrders.length,
              inProgress: fallbackInProgressOrders.length,
              completed: fallbackCompletedOrders.length,
              previous: fallbackPreviousOrders.length
            });
            
            // Apply cached data immediately
            if (cachedData.pendingOrders) setPendingOrders(cachedData.pendingOrders);
            if (cachedData.inProgressOrders) setInProgressOrders(cachedData.inProgressOrders);
            if (cachedData.completedOrders) setCompletedOrders(cachedData.completedOrders);
            if (cachedData.previousOrders) setPreviousOrders(cachedData.previousOrders);
            
            // Force online status to false
            setOnline(false);
            setLoading(false);
            
            return;
          }
          
          // Regular backup loading logic for non-fallback mode
          const stationId = currentStationId;
          const ordersKey = `orders_cache_station_${stationId}`;
          const backupKey = `${ordersKey}_backup`;
          
          let cachedData = null;
          
          // First prioritize the specific backup created for organiser navigation
          const backupData = localStorage.getItem(backupKey);
          
          if (backupData) {
            console.log('Found order backup for quick restore - preparing data');
            try {
              cachedData = JSON.parse(backupData);
              
              // Clear the backup since we've used it
              localStorage.removeItem(backupKey);
            } catch (parseError) {
              console.error('Error parsing backup data:', parseError);
            }
          } else {
            // If no backup, try sessionStorage for faster loading
            const sessionData = sessionStorage.getItem(ordersKey);
            
            if (sessionData) {
              try {
                cachedData = JSON.parse(sessionData);
                console.log('Using session-cached orders while fetching fresh data');
              } catch (parseError) {
                console.error('Error parsing session data:', parseError);
              }
            }
          }
          
          // Apply cached data in a single batched update if we have any
          if (cachedData) {
            // Apply the updates in the next tick to avoid render loops
            setTimeout(() => {
              // Update all state in a single batch
              if (cachedData.pendingOrders) {
                console.log(`Applying ${cachedData.pendingOrders.length} cached pending orders`);
                setPendingOrders(cachedData.pendingOrders);
              }
              if (cachedData.inProgressOrders) {
                console.log(`Applying ${cachedData.inProgressOrders.length} cached in-progress orders`);
                setInProgressOrders(cachedData.inProgressOrders);
              }
              if (cachedData.completedOrders) {
                console.log(`Applying ${cachedData.completedOrders.length} cached completed orders`);
                setCompletedOrders(cachedData.completedOrders);
              }
              if (cachedData.previousOrders) {
                console.log(`Applying ${cachedData.previousOrders.length} cached previous orders`);
                setPreviousOrders(cachedData.previousOrders);
              } else {
                console.log('No cached previous orders found');
              }
              
              console.log('Successfully applied cached order data');
            }, 0);
          }
        } catch (e) {
          console.error('Error loading orders from storage:', e);
        }
      };
      
      // Execute load function
      loadCachedData();
    }
    
    // Initial data fetch (this runs both on first render and dependency changes)
    fetchOrdersData();
    
    // Set up polling based on auto-refresh settings with debouncing
    let interval;
    if (autoRefreshEnabled) {
      console.log(`Auto-refresh enabled with interval ${autoRefreshInterval} seconds`);
      
      // Make sure we're not refreshing too quickly to prevent UI flickering
      const safeInterval = Math.max(30, autoRefreshInterval);
      if (safeInterval !== autoRefreshInterval) {
        console.warn(`Adjusting auto-refresh interval from ${autoRefreshInterval}s to ${safeInterval}s to prevent flickering`);
        // Update in localStorage for persistence
        localStorage.setItem('coffee_auto_refresh_interval', safeInterval.toString());
        setAutoRefreshInterval(safeInterval);
      }
      
      interval = setInterval(() => {
        // TEMPORARY FIX: Disable auto-refresh to prevent UI flickering
        console.log('Auto-refresh temporarily disabled to fix UI issues');
        
        /* DISABLED AUTO-REFRESH CODE:
        // Check if we've refreshed recently from another source
        const lastRefreshTime = parseInt(sessionStorage.getItem('last_manual_refresh_time') || '0');
        const timeSinceLastRefresh = Date.now() - lastRefreshTime;
        
        // Only do automatic refresh if it's been at least 15 seconds since last manual refresh
        if (timeSinceLastRefresh > 15000) {
          console.log('Auto-refreshing order data...');
          fetchOrdersData(false);
        } else {
          console.log(`Skipping auto-refresh (last manual refresh was ${timeSinceLastRefresh}ms ago)`);
        }
        */
      }, safeInterval * 1000);
    }
    
    // Add listener for tab visibility and tab switching events
    const handleRefreshEvent = () => {
      console.log('Received app:refreshOrders event - refreshing orders');
      fetchOrdersData(false);
    };
    
    // Listen for the custom refresh event
    window.addEventListener('app:refreshOrders', handleRefreshEvent);
    
    // Also listen for visibility change
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log('Tab became visible - refreshing orders');
        fetchOrdersData(false);
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    // Cleanup on unmount
    return () => {
      if (interval) clearInterval(interval);
      window.removeEventListener('app:refreshOrders', handleRefreshEvent);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [autoRefreshEnabled, autoRefreshInterval, currentStationId]); // FIXED: Removed fetchOrdersData to prevent infinite loops

  // Track wait time update interval in a ref to prevent memory leaks
  const waitTimeIntervalRef = useRef(null);
  
  // Update order wait times periodically - with optimized state updates
  useEffect(() => {
    // Define update function that batches state updates to prevent render loops
    const updateWaitTimes = () => {
      // Use functional state updates to avoid dependency on state values
      setPendingOrders(prevOrders => {
        if (!prevOrders || prevOrders.length === 0) return prevOrders;
        
        return prevOrders.map(order => {
          try {
            // Safely parse date strings to avoid errors
            let createdAt = order.createdAt;
            if (typeof createdAt === 'string') {
              createdAt = new Date(createdAt);
            } else if (!(createdAt instanceof Date)) {
              createdAt = new Date(); // Fallback
            }
            
            // Calculate wait time in minutes
            const waitTime = Math.floor((new Date() - createdAt) / 60000);
            
            // Only update if wait time changed
            if (order.waitTime !== waitTime) {
              return { ...order, waitTime };
            }
            return order;
          } catch (e) {
            console.error('Error calculating wait time:', e);
            return order; // Keep original if error
          }
        });
      });
      
      setInProgressOrders(prevOrders => {
        if (!prevOrders || prevOrders.length === 0) return prevOrders;
        
        return prevOrders.map(order => {
          try {
            // Safely parse date strings to avoid errors
            let createdAt = order.createdAt;
            if (typeof createdAt === 'string') {
              createdAt = new Date(createdAt);
            } else if (!(createdAt instanceof Date)) {
              createdAt = new Date(); // Fallback
            }
            
            // Calculate wait time in minutes
            const waitTime = Math.floor((new Date() - createdAt) / 60000);
            
            // Only update if wait time changed
            if (order.waitTime !== waitTime) {
              return { ...order, waitTime };
            }
            return order;
          } catch (e) {
            console.error('Error calculating wait time:', e);
            return order; // Keep original if error
          }
        });
      });
    };
    
    // Clear any existing interval
    if (waitTimeIntervalRef.current) {
      clearInterval(waitTimeIntervalRef.current);
    }
    
    // Set up new interval
    waitTimeIntervalRef.current = setInterval(updateWaitTimes, 60000); // Update every minute
    
    // Run once immediately
    updateWaitTimes();
    
    // Cleanup on unmount
    return () => {
      if (waitTimeIntervalRef.current) {
        clearInterval(waitTimeIntervalRef.current);
        waitTimeIntervalRef.current = null;
      }
    };
  }, []); // Empty dependency array - interval handles updates

  // Function to manually refresh data with debouncing to prevent rapid sequential refreshes
  const refreshData = useCallback(() => {
    // Ensure we preserve the current station when refreshing
    console.log(`[useOrders] Manual refresh requested for station ${currentStationId}`);
    
    // Check if a refresh was performed very recently (debouncing)
    const lastRefreshTime = parseInt(sessionStorage.getItem('last_manual_refresh_time') || '0');
    const timeSinceLastRefresh = Date.now() - lastRefreshTime;
    
    // Only allow manual refresh if it's been at least 5 seconds since the last one
    if (timeSinceLastRefresh < 5000) {
      console.log(`Debouncing refresh request (last refresh was ${timeSinceLastRefresh}ms ago)`);
      return; // Skip this refresh request to prevent flickering
    }
    
    // Record this refresh time to prevent rapid sequential refreshes
    sessionStorage.setItem('last_manual_refresh_time', Date.now().toString());
    
    setIsRefreshing(true);
    
    // Make sure we're using the current station ID when refreshing
    if (currentStationId) {
      // Sync localStorage to match current station ID
      try {
        const savedStationId = localStorage.getItem('coffee_cue_selected_station');
        if (savedStationId && parseInt(savedStationId, 10) !== currentStationId) {
          // Only log this as debug info since it's part of normal sync process
          console.log(`[useOrders] Syncing localStorage station ID from ${savedStationId} to ${currentStationId}`);
          localStorage.setItem('coffee_cue_selected_station', currentStationId.toString());
        }
      } catch (e) {
        console.error('Error syncing station ID to localStorage:', e);
      }
    }
    
    // Fetch data for the current station
    fetchOrdersData(false);
  }, [fetchOrdersData, currentStationId]);
  
  // Toggle auto-refresh
  const toggleAutoRefresh = useCallback(() => {
    const newValue = !autoRefreshEnabled;
    setAutoRefreshEnabled(newValue);
    localStorage.setItem('coffee_auto_refresh_enabled', newValue);
    
    // When enabling auto-refresh, make sure we have a safe interval
    if (newValue === true && autoRefreshInterval < 30) {
      console.log('Auto-refresh enabled with too short interval, increasing to 60s for stability');
      setAutoRefreshInterval(60);
      localStorage.setItem('coffee_auto_refresh_interval', '60');
    }
  }, [autoRefreshEnabled, autoRefreshInterval]);

  // Update auto-refresh interval with minimum threshold to prevent flickering
  const updateAutoRefreshInterval = useCallback((seconds) => {
    if (seconds && !isNaN(seconds) && seconds >= 30) { // Increased minimum to 30 seconds to prevent flickering
      // Store the previous value for logging
      const prevInterval = autoRefreshInterval;
      setAutoRefreshInterval(seconds);
      localStorage.setItem('coffee_auto_refresh_interval', seconds);
      localStorage.setItem('coffee_auto_refresh_enabled', 'true'); // Always enable refresh when interval is set
      console.log(`Auto-refresh interval updated from ${prevInterval}s to ${seconds}s`);
      return true;
    }
    // Log a warning if value is too low
    if (seconds && !isNaN(seconds) && seconds < 30) {
      console.warn(`Auto-refresh interval of ${seconds}s is too low and might cause UI flickering. Minimum allowed is 30s.`);
    }
    return false;
  }, [autoRefreshInterval]);

  // History data fetch functions
  const fetchYesterdayOrders = useCallback(async () => {
    try {
      setLoading(true);
      const result = await OrderDataService.getYesterdayOrders(currentStationId);
      setYesterdayOrders(result.orders || []);
      setError(null);
      return result.orders || [];
    } catch (err) {
      console.error('Error fetching yesterday\'s orders:', err);
      setError(`Failed to fetch yesterday's orders: ${err.message}`);
      return [];
    } finally {
      setLoading(false);
    }
  }, [currentStationId]);
  
  const fetchThisWeekOrders = useCallback(async () => {
    try {
      setLoading(true);
      const result = await OrderDataService.getThisWeekOrders(currentStationId);
      // Handle both old and new response formats
      const orders = result.orders || result.data || [];
      setThisWeekOrders(orders);
      setError(null);
      return orders;
    } catch (err) {
      console.error('Error fetching this week\'s orders:', err);
      setError(`Failed to fetch this week's orders: ${err.message}`);
      return [];
    } finally {
      setLoading(false);
    }
  }, [currentStationId]);
  
  const searchOrders = useCallback(async (searchTerm) => {
    if (!searchTerm || searchTerm.trim().length < 2) {
      setError('Search term must be at least 2 characters');
      return [];
    }
    
    try {
      setLoading(true);
      const result = await OrderDataService.searchOrders(searchTerm, currentStationId);
      // Handle both old and new response formats
      const orders = result.orders || result.data || [];
      setSearchResults(orders);
      setError(null);
      return orders;
    } catch (err) {
      console.error('Error searching orders:', err);
      setError(`Failed to search orders: ${err.message}`);
      return [];
    } finally {
      setLoading(false);
    }
  }, [currentStationId]);
  
  const getOrderHistory = useCallback(async (options = {}) => {
    try {
      setLoading(true);
      const result = await OrderDataService.getOrderHistory({
        ...options,
        stationId: currentStationId
      });
      setHistoryOrders(result.orders || []);
      setError(null);
      return result;
    } catch (err) {
      console.error('Error fetching order history:', err);
      setError(`Failed to fetch order history: ${err.message}`);
      return { orders: [], total: 0 };
    } finally {
      setLoading(false);
    }
  }, [currentStationId]);
  
  // Order actions with improved error handling and ID management
  const startOrder = useCallback(async (order) => {
    if (!order || !order.id) {
      setError('Invalid order: missing ID');
      return false;
    }

    try {
      // Check if this is a local order from our localStorage system
      const isLocalOrder = order.isLocalOrder || order.id.toString().startsWith('local_order_');
      
      if (isLocalOrder) {
        console.log('Starting local order without API call:', order.id);
        
        // Remove from local storage pending collection
        try {
          const localOrdersKey = `local_orders_station_${currentStationId}`;
          const localOrders = JSON.parse(localStorage.getItem(localOrdersKey) || '[]');
          const updatedLocalOrders = localOrders.filter(o => o.id !== order.id);
          localStorage.setItem(localOrdersKey, JSON.stringify(updatedLocalOrders));
          console.log(`Removed order ${order.id} from local orders collection`);
        } catch (e) {
          console.error('Error removing local order from storage:', e);
        }
        
        // Update UI state without API call
        setPendingOrders(prev => prev.filter(o => o.id !== order.id));
        
        const updatedOrder = { 
          ...order, 
          startedAt: new Date(),
          status: 'in-progress',
          stationId: currentStationId,
          station_id: currentStationId,
          assignedStation: currentStationId
        };
        
        setInProgressOrders(prev => [...prev, updatedOrder]);
        setQueueCount(prev => Math.max(0, prev - 1));
        
        // Update order in main cache storage for persistence
        try {
          const ordersKey = `orders_cache_station_${currentStationId}`;
          let ordersCache = {};
          try {
            const cacheData = localStorage.getItem(ordersKey);
            if (cacheData) {
              ordersCache = JSON.parse(cacheData);
            }
          } catch (e) {
            console.error('Error parsing orders cache:', e);
          }
          
          // Ensure arrays exist
          if (!ordersCache.pendingOrders) ordersCache.pendingOrders = [];
          if (!ordersCache.inProgressOrders) ordersCache.inProgressOrders = [];
          
          // Remove from pending
          ordersCache.pendingOrders = ordersCache.pendingOrders.filter(o => o.id !== order.id);
          
          // Add to in-progress 
          ordersCache.inProgressOrders.push(updatedOrder);
          ordersCache.timestamp = Date.now();
          
          // Save back to all storage locations
          const serializedCache = JSON.stringify(ordersCache);
          localStorage.setItem(ordersKey, serializedCache);
          sessionStorage.setItem(ordersKey, serializedCache);
          
          // Also update backup
          localStorage.setItem(`${ordersKey}_backup`, serializedCache);
          localStorage.setItem(`${ordersKey}_backup_time`, Date.now().toString());
          
          console.log(`Successfully moved order ${order.id} to in-progress in all storage locations`);
        } catch (e) {
          console.error('Error updating orders cache:', e);
        }
        
        return true;
      }
      
      // For regular orders, proceed with API call
      const result = await OrderDataService.startOrder(order, currentStationId);
      
      if (!result || !result.success) {
        const errorMessage = result?.message || 'Unknown error';
        throw new Error(`Failed to start order: ${errorMessage}`);
      }
      
      // Optimistically update UI state
      setPendingOrders(prev => prev.filter(o => o.id !== order.id));
      
      const updatedOrder = { 
        ...order, 
        startedAt: new Date(),
        status: 'in-progress',
        stationId: currentStationId,
        station_id: currentStationId,
        assignedStation: currentStationId
      };
      
      setInProgressOrders(prev => [...prev, updatedOrder]);
      setQueueCount(prev => Math.max(0, prev - 1));
      
      // Update order in main cache storage for persistence
      try {
        const ordersKey = `orders_cache_station_${currentStationId}`;
        let ordersCache = {};
        try {
          const cacheData = localStorage.getItem(ordersKey);
          if (cacheData) {
            ordersCache = JSON.parse(cacheData);
          }
        } catch (e) {
          console.error('Error parsing orders cache:', e);
        }
        
        // Ensure arrays exist
        if (!ordersCache.pendingOrders) ordersCache.pendingOrders = [];
        if (!ordersCache.inProgressOrders) ordersCache.inProgressOrders = [];
        
        // Remove from pending
        ordersCache.pendingOrders = ordersCache.pendingOrders.filter(o => o.id !== order.id);
        
        // Add to in-progress 
        ordersCache.inProgressOrders.push(updatedOrder);
        ordersCache.timestamp = Date.now();
        
        // Save back to all storage locations
        const serializedCache = JSON.stringify(ordersCache);
        localStorage.setItem(ordersKey, serializedCache);
        sessionStorage.setItem(ordersKey, serializedCache);
        
        // Also update backup
        localStorage.setItem(`${ordersKey}_backup`, serializedCache);
        localStorage.setItem(`${ordersKey}_backup_time`, Date.now().toString());
        
        console.log(`Successfully moved server order ${order.id} to in-progress in all storage locations`);
      } catch (e) {
        console.error('Error updating orders cache for server order:', e);
      }
      
      // Refresh data to ensure consistency
      setTimeout(refreshData, 500);
      
      return true;
    } catch (err) {
      setError(`Failed to start order: ${err.message}`);
      console.error('Start order error:', err);
      return false;
    }
  }, [refreshData, currentStationId]);

  const completeOrder = useCallback(async (orderId) => {
    if (!orderId) {
      setError('Cannot complete order: Missing order ID');
      return false;
    }
    
    try {
      // Check if this is a local order from our localStorage system
      const orderToComplete = inProgressOrders.find(o => o.id === orderId);
      
      if (!orderToComplete) {
        throw new Error(`Order with ID ${orderId} not found in progress orders`);
      }
      
      const isLocalOrder = orderToComplete.isLocalOrder || 
                          orderId.toString().startsWith('local_order_');
      
      // Calculate prep time for this order (time from start to completion)
      let prepTimeMinutes = 0;
      if (orderToComplete.startedAt) {
        const startTime = new Date(orderToComplete.startedAt);
        const completionTime = new Date();
        prepTimeMinutes = (completionTime - startTime) / (1000 * 60);
        
        // Update station stats with this prep time
        if (prepTimeMinutes > 0 && prepTimeMinutes < 60) { // Sanity check - ignore outliers over an hour
          setStationStats(prevStats => {
            // Add this prep time to the array
            const newPrepTimes = [...prevStats.prepTimes, prepTimeMinutes];
            
            // Calculate new average (limit to last 20 orders for recency)
            const recentPrepTimes = newPrepTimes.slice(-20);
            const newAvgPrepTime = recentPrepTimes.reduce((sum, time) => sum + time, 0) / recentPrepTimes.length;
            
            // Save stats to localStorage for persistence
            try {
              localStorage.setItem(`station_${currentStationId}_avg_prep_time`, newAvgPrepTime.toFixed(2));
              localStorage.setItem(`station_${currentStationId}_total_completed`, prevStats.totalCompleted + 1);
            } catch (e) {
              console.error('Error saving station stats to localStorage:', e);
            }
            
            return {
              prepTimes: newPrepTimes,
              avgPrepTime: newAvgPrepTime,
              totalCompleted: prevStats.totalCompleted + 1,
              lastCalculated: new Date()
            };
          });
        }
      }
      
      // Update stock levels based on the order
      try {
        // Initialize stock service for this station if not already initialized
        if (StockService.stationId !== currentStationId) {
          StockService.initialize(currentStationId, `Station ${currentStationId}`);
        }
        
        console.log(`Depleting stock for order ${orderId}:`, orderToComplete);
        
        // Determine which items to deplete and by how much
        
        // 1. Deplete milk based on milk type and cup size
        let milkAmount = 0;
        const coffeeSize = orderToComplete.coffeeType?.toLowerCase() || '';
        if (coffeeSize.includes('small')) {
          milkAmount = 0.15; // 150ml for small
        } else if (coffeeSize.includes('medium')) {
          milkAmount = 0.25; // 250ml for medium
        } else if (coffeeSize.includes('large')) {
          milkAmount = 0.35; // 350ml for large
        } else {
          milkAmount = 0.25; // Default to medium
        }
        
        // Determine milk ID based on milk type
        let milkId = 'milk_regular';
        const milkType = orderToComplete.milkType?.toLowerCase() || '';
        
        if (milkType.includes('skim')) {
          milkId = 'milk_skim';
        } else if (milkType.includes('almond')) {
          milkId = 'milk_almond';
        } else if (milkType.includes('soy')) {
          milkId = 'milk_soy';
        }
        
        // Get current milk level
        const milkItems = StockService.getLocalCategoryStock('milk');
        const milkItem = milkItems.find(item => item.id === milkId);
        
        if (milkItem) {
          const newAmount = Math.max(0, milkItem.amount - milkAmount);
          console.log(`Depleting ${milkId} from ${milkItem.amount}L to ${newAmount}L`);
          StockService.updateLocalStockAmount('milk', milkId, newAmount);
        }
        
        // 2. Deplete coffee beans based on cup size
        let coffeeAmount = 0;
        if (coffeeSize.includes('small')) {
          coffeeAmount = 0.008; // 8g for small
        } else if (coffeeSize.includes('medium')) {
          coffeeAmount = 0.015; // 15g for medium
        } else if (coffeeSize.includes('large')) {
          coffeeAmount = 0.022; // 22g for large
        } else {
          coffeeAmount = 0.015; // Default to medium
        }
        
        // Default to house blend
        const coffeeId = 'coffee_house';
        const coffeeItems = StockService.getLocalCategoryStock('coffee');
        const coffeeItem = coffeeItems.find(item => item.id === coffeeId);
        
        if (coffeeItem) {
          const newAmount = Math.max(0, coffeeItem.amount - coffeeAmount);
          console.log(`Depleting ${coffeeId} from ${coffeeItem.amount}kg to ${newAmount}kg`);
          StockService.updateLocalStockAmount('coffee', coffeeId, newAmount);
        }
        
        // 3. Deplete a cup based on size
        let cupId = 'cups_medium';
        if (coffeeSize.includes('small')) {
          cupId = 'cups_small';
        } else if (coffeeSize.includes('large')) {
          cupId = 'cups_large';
        }
        
        const cupsItems = StockService.getLocalCategoryStock('cups');
        const cupItem = cupsItems.find(item => item.id === cupId);
        
        if (cupItem) {
          const newAmount = Math.max(0, cupItem.amount - 1); // Deplete 1 cup
          console.log(`Depleting ${cupId} from ${cupItem.amount} to ${newAmount} cups`);
          StockService.updateLocalStockAmount('cups', cupId, newAmount);
        }
        
        // 4. Deplete sugar if the order includes sugar
        const sugarText = orderToComplete.sugar?.toLowerCase() || '';
        let sugarAmount = 0;
        
        if (sugarText.includes('1 sugar')) {
          sugarAmount = 0.005; // 5g per sugar
        } else if (sugarText.includes('2 sugar')) {
          sugarAmount = 0.01; // 10g for 2 sugars
        } else if (sugarText.includes('3 sugar')) {
          sugarAmount = 0.015; // 15g for 3 sugars
        }
        
        if (sugarAmount > 0) {
          const sugarItems = StockService.getLocalCategoryStock('other');
          const sugarItem = sugarItems.find(item => item.id === 'sugar_white');
          
          if (sugarItem) {
            const newAmount = Math.max(0, sugarItem.amount - sugarAmount);
            console.log(`Depleting sugar from ${sugarItem.amount}kg to ${newAmount}kg`);
            StockService.updateLocalStockAmount('other', 'sugar_white', newAmount);
          }
        }
        
      } catch (stockError) {
        console.error('Error updating stock levels:', stockError);
        // Continue with order completion even if stock update fails
      }
      
      
      if (isLocalOrder) {
        console.log('Completing local order without API call:', orderId);
        
        // Update UI state without API call
        setInProgressOrders(prev => prev.filter(o => o.id !== orderId));
        
        const completedOrder = {
          ...orderToComplete,
          completedAt: new Date(),
          status: 'completed',
          prepTime: prepTimeMinutes // Store the prep time with the order
        };
        
        // Deplete stock based on the completed order
        try {
          const StockService = (await import('../services/StockService')).default;
          if (StockService.depleteStockForOrder) {
            StockService.depleteStockForOrder(completedOrder);
          }
        } catch (stockError) {
          console.error('Error depleting stock for completed local order:', stockError);
          // Don't fail the order completion if stock depletion fails
        }
        
        setCompletedOrders(prev => [completedOrder, ...prev]);
        
        // Make sure order is persisted in cache
        try {
          const ordersKey = `orders_cache_station_${currentStationId}`;
          let ordersCache = {};
          try {
            const cacheData = localStorage.getItem(ordersKey);
            if (cacheData) {
              ordersCache = JSON.parse(cacheData);
            }
          } catch (e) {
            console.error('Error parsing orders cache:', e);
          }
          
          // Update inProgress and completed lists
          ordersCache.inProgressOrders = ordersCache.inProgressOrders?.filter(o => o.id !== orderId) || [];
          
          if (!ordersCache.completedOrders) {
            ordersCache.completedOrders = [];
          }
          
          // Add to completed
          ordersCache.completedOrders.unshift(completedOrder);
          ordersCache.timestamp = Date.now();
          
          // Save back to all storage
          const serializedCache = JSON.stringify(ordersCache);
          localStorage.setItem(ordersKey, serializedCache);
          sessionStorage.setItem(ordersKey, serializedCache);
          
          // Also update backup
          localStorage.setItem(`${ordersKey}_backup`, serializedCache);
          localStorage.setItem(`${ordersKey}_backup_time`, Date.now().toString());
        } catch (e) {
          console.error('Error updating orders cache:', e);
        }
        
        // Play sound notification
        try {
          window.dispatchEvent(new CustomEvent('app:orderCompleted'));
        } catch (soundError) {
          console.error('Error triggering sound notification:', soundError);
        }
        
        return true;
      }
      
      // For regular orders, proceed with API call
      const result = await OrderDataService.completeOrder(orderId);
      
      if (!result || !result.success) {
        const errorMessage = result?.message || 'Unknown error';
        throw new Error(`Failed to complete order: ${errorMessage}`);
      }
      
      // Optimistically update UI state
      setInProgressOrders(prev => prev.filter(o => o.id !== orderId));
      
      const completedOrder = {
        ...orderToComplete,
        completedAt: new Date(),
        status: 'completed',
        prepTime: prepTimeMinutes // Store the prep time with the order
      };
      
      // Deplete stock based on the completed order
      try {
        const StockService = (await import('../services/StockService')).default;
        if (StockService.depleteStockForOrder) {
          StockService.depleteStockForOrder(completedOrder);
        }
      } catch (stockError) {
        console.error('Error depleting stock for completed order:', stockError);
        // Don't fail the order completion if stock depletion fails
      }
      
      setCompletedOrders(prev => [completedOrder, ...prev]);
      
      // Make sure order is persisted in cache
      try {
        const ordersKey = `orders_cache_station_${currentStationId}`;
        let ordersCache = {};
        try {
          const cacheData = localStorage.getItem(ordersKey);
          if (cacheData) {
            ordersCache = JSON.parse(cacheData);
          }
        } catch (e) {
          console.error('Error parsing orders cache:', e);
        }
        
        // Update inProgress and completed lists
        ordersCache.inProgressOrders = ordersCache.inProgressOrders?.filter(o => o.id !== orderId) || [];
        
        if (!ordersCache.completedOrders) {
          ordersCache.completedOrders = [];
        }
        
        // Add to completed
        ordersCache.completedOrders.unshift(completedOrder);
        ordersCache.timestamp = Date.now();
        
        // Save back to all storage
        const serializedCache = JSON.stringify(ordersCache);
        localStorage.setItem(ordersKey, serializedCache);
        sessionStorage.setItem(ordersKey, serializedCache);
        
        // Also update backup
        localStorage.setItem(`${ordersKey}_backup`, serializedCache);
        localStorage.setItem(`${ordersKey}_backup_time`, Date.now().toString());
      } catch (e) {
        console.error('Error updating orders cache:', e);
      }
      
      // Trigger sound notification for completed order
      try {
        window.dispatchEvent(new CustomEvent('app:orderCompleted'));
      } catch (soundError) {
        console.error('Error triggering sound notification:', soundError);
      }
      window.dispatchEvent(new CustomEvent('app:orderCompleted'));
      
      // FIXED: Don't refresh data immediately after completion to avoid overriding optimistic updates
      // The data will be refreshed by the next auto-refresh cycle or manual refresh
      // setTimeout(refreshData, 500);
      
      return true;
    } catch (err) {
      setError(`Failed to complete order: ${err.message}`);
      console.error('Complete order error:', err);
      return false;
    }
  }, [inProgressOrders, refreshData, currentStationId]);

  const markOrderPickedUp = useCallback(async (orderId) => {
    if (!orderId) {
      setError('Cannot mark order as picked up: Missing order ID');
      return false;
    }
    
    try {
      // Check if this is a local order from our localStorage system
      const orderToPickUp = completedOrders.find(o => o.id === orderId);
      
      if (!orderToPickUp) {
        throw new Error(`Order with ID ${orderId} not found in completed orders`);
      }
      
      const isLocalOrder = orderToPickUp.isLocalOrder || 
                          orderId.toString().startsWith('local_order_');
      
      if (isLocalOrder) {
        console.log('Marking local order as picked up without API call:', orderId);
        
        // Update UI state without API call
        setCompletedOrders(prev => prev.filter(o => o.id !== orderId));
        
        const pickedUpOrder = {
          ...orderToPickUp,
          pickedUpAt: new Date()
        };
        
        setPreviousOrders(prev => [pickedUpOrder, ...prev]);
        
        // Cancel any pending reminder SMS for this order
        try {
          const MessageService = (await import('../services/MessageService')).default;
          MessageService.onOrderPickedUp(orderId);
        } catch (error) {
          console.error('Error cancelling reminder SMS:', error);
        }
        
        // Also save to fallback storage for offline/demo mode
        try {
          const existingFallbackPrevious = JSON.parse(localStorage.getItem('fallback_previous_orders') || '[]');
          const updatedFallbackPrevious = [pickedUpOrder, ...existingFallbackPrevious];
          localStorage.setItem('fallback_previous_orders', JSON.stringify(updatedFallbackPrevious));
          console.log('Saved picked up order to fallback_previous_orders for offline mode');
        } catch (e) {
          console.error('Error saving to fallback_previous_orders:', e);
        }
        
        return true;
      }
      
      // For regular orders, proceed with API call
      const result = await OrderDataService.markOrderPickedUp(orderId);
      
      if (!result || !result.success) {
        const errorMessage = result?.message || 'Unknown error';
        throw new Error(`Failed to mark order as picked up: ${errorMessage}`);
      }
      
      // Optimistically update UI state
      setCompletedOrders(prev => prev.filter(o => o.id !== orderId));
      
      const pickedUpOrder = {
        ...orderToPickUp,
        pickedUpAt: new Date()
      };
      
      setPreviousOrders(prev => [pickedUpOrder, ...prev]);
      
      // Cancel any pending reminder SMS for this order
      try {
        const MessageService = (await import('../services/MessageService')).default;
        MessageService.onOrderPickedUp(orderId);
      } catch (error) {
        console.error('Error cancelling reminder SMS:', error);
      }
      
      // Also save to fallback storage for offline/demo mode
      try {
        const existingFallbackPrevious = JSON.parse(localStorage.getItem('fallback_previous_orders') || '[]');
        const updatedFallbackPrevious = [pickedUpOrder, ...existingFallbackPrevious];
        localStorage.setItem('fallback_previous_orders', JSON.stringify(updatedFallbackPrevious));
        console.log('Saved picked up order to fallback_previous_orders for offline mode');
      } catch (e) {
        console.error('Error saving to fallback_previous_orders:', e);
      }
      
      // FIXED: Don't refresh data immediately after pickup to avoid overriding optimistic updates
      // The data will be refreshed by the next auto-refresh cycle or manual refresh
      // setTimeout(refreshData, 500);
      
      return true;
    } catch (err) {
      setError(`Failed to mark order as picked up: ${err.message}`);
      console.error('Mark picked up error:', err);
      return false;
    }
  }, [completedOrders, refreshData]);

  const processBatch = useCallback(async (batchGroup) => {
    if (!batchGroup) {
      setError('Cannot process batch: Invalid batch group');
      return false;
    }
    
    try {
      // Get all orders in this batch
      const batchOrders = pendingOrders.filter(order => order.batchGroup === batchGroup);
      if (batchOrders.length === 0) {
        setError('No orders found in this batch group');
        return false;
      }
      
      // Extract order IDs
      const orderIds = batchOrders.map(order => order.id);
      
      // Call API to process the batch
      const result = await OrderDataService.processBatch(orderIds);
      
      if (!result || !result.success) {
        const errorMessage = result?.message || 'Unknown error';
        throw new Error(`Failed to process batch: ${errorMessage}`);
      }
      
      // Optimistically update UI state
      setPendingOrders(prev => prev.filter(order => order.batchGroup !== batchGroup));
      
      // Add orders to in-progress
      const updatedBatchOrders = batchOrders.map(order => ({
        ...order,
        startedAt: new Date(),
        status: 'in-progress'
      }));
      
      setInProgressOrders(prev => [...prev, ...updatedBatchOrders]);
      setQueueCount(prev => Math.max(0, prev - batchOrders.length));
      
      // Refresh data to ensure consistency
      setTimeout(refreshData, 500);
      
      return batchOrders.length;
    } catch (err) {
      setError(`Failed to process batch: ${err.message}`);
      console.error('Process batch error:', err);
      return false;
    }
  }, [pendingOrders, refreshData]);

  const processBatchSelection = useCallback(async (selectedOrderIds) => {
    if (!selectedOrderIds || selectedOrderIds.size === 0) {
      setError('Cannot process batch: No orders selected');
      return false;
    }
    
    try {
      // Extract order objects
      const ordersToProcess = pendingOrders.filter(order => 
        selectedOrderIds.has(order.id)
      );
      
      // Process orders
      const result = await OrderDataService.processBatchSelection(selectedOrderIds);
      
      if (!result || !result.success) {
        const errorMessage = result?.message || 'Unknown error';
        throw new Error(`Failed to process batch selection: ${errorMessage}`);
      }
      
      // Optimistically update UI state
      setPendingOrders(prev => 
        prev.filter(order => !selectedOrderIds.has(order.id))
      );
      
      // Add to in-progress
      const updatedOrders = ordersToProcess.map(order => ({
        ...order,
        startedAt: new Date(),
        status: 'in-progress'
      }));
      
      setInProgressOrders(prev => [...prev, ...updatedOrders]);
      setQueueCount(prev => Math.max(0, prev - selectedOrderIds.size));
      
      // Refresh data to ensure consistency
      setTimeout(refreshData, 500);
      
      return selectedOrderIds.size;
    } catch (err) {
      setError(`Failed to process batch selection: ${err.message}`);
      console.error('Process batch selection error:', err);
      return false;
    }
  }, [pendingOrders, refreshData]);

  const addWalkInOrder = useCallback(async (orderDetails) => {
    if (!orderDetails) {
      setError('Cannot add walk-in order: Invalid order details');
      return false;
    }
    
    try {
      // Preserve station assignments from BaristaInterface, only add currentStationId as fallback
      const orderWithStation = {
        ...orderDetails,
        station_id: orderDetails.station_id || orderDetails.stationId || currentStationId,
        assigned_to_station: orderDetails.assigned_to_station || orderDetails.assignedStation || orderDetails.stationId || currentStationId
      };
      
      console.log(`Adding walk-in order at station ${currentStationId}:`, orderWithStation);
      console.log('Order station assignments:', {
        'orderDetails.stationId': orderDetails.stationId,
        'orderDetails.station_id': orderDetails.station_id,
        'orderDetails.assignedStation': orderDetails.assignedStation,
        'orderWithStation.stationId': orderWithStation.stationId,
        'orderWithStation.station_id': orderWithStation.station_id,
        'currentStationId': currentStationId
      });
      
      // Create a persistent client-side order instead of a temporary one
      const timestamp = Date.now();
      const persistentId = `local_order_${timestamp}`;
      
      // Convert snake_case fields to camelCase for UI consistency
      const clientOrder = {
        id: persistentId,
        orderNumber: `WI${timestamp.toString().slice(-6)}`, // Walk-In order number
        createdAt: new Date(),
        waitTime: 0,
        promisedTime: orderDetails.promisedTime || 15,
        status: 'pending',
        // Map snake_case to camelCase
        customerName: orderWithStation.customer_name || orderWithStation.customerName,
        phoneNumber: orderWithStation.phone_number || orderWithStation.phoneNumber || 'Walk-in',
        coffeeType: orderWithStation.coffee_type || orderWithStation.coffeeType,
        milkType: orderWithStation.milk_type || orderWithStation.milkType,
        milkTypeId: orderWithStation.milk_type_id || orderWithStation.milkTypeId,
        sugar: orderWithStation.sugar || 'No sugar',
        extraHot: orderWithStation.extra_hot || orderWithStation.extraHot || false,
        priority: orderWithStation.priority || false,
        notes: orderWithStation.notes || '',
        shots: orderWithStation.shots || 1,
        isWalkIn: orderWithStation.is_walk_in || orderWithStation.isWalkIn || true,
        collectionStation: orderWithStation.collection_station || orderWithStation.collectionStation,
        alternativeMilk: orderWithStation.alternative_milk || orderWithStation.alternativeMilk || 
                        ['Soy Milk', 'Almond Milk', 'Oat Milk', 'Coconut Milk', 'Macadamia Milk', 'Rice Milk'].includes(orderWithStation.milk_type || orderWithStation.milkType),
        dairyFree: orderWithStation.dairy_free || orderWithStation.dairyFree || false,
        // Station fields - preserve station assignment from orderWithStation if provided
        stationId: orderWithStation.stationId || orderWithStation.station_id || currentStationId,
        station_id: orderWithStation.stationId || orderWithStation.station_id || currentStationId,
        assignedStation: orderWithStation.assignedStation || orderWithStation.stationId || orderWithStation.station_id || currentStationId,
        assigned_to_station: orderWithStation.assigned_to_station || orderWithStation.stationId || orderWithStation.station_id || currentStationId,
        // Mark as local order for persistence
        isLocalOrder: true
      };
      
      console.log('Final clientOrder station assignments:', {
        'clientOrder.stationId': clientOrder.stationId,
        'clientOrder.station_id': clientOrder.station_id,
        'clientOrder.assignedStation': clientOrder.assignedStation,
        'clientOrder.assigned_to_station': clientOrder.assigned_to_station
      });
      
      // Determine the target station for this order
      const targetStationId = clientOrder.stationId || clientOrder.station_id || currentStationId;
      
      // Save to localStorage so it persists across refreshes
      try {
        // 1. Save to local orders collection for the TARGET station (where order should appear)
        const localOrdersKey = `local_orders_station_${targetStationId}`;
        let existingOrders = [];
        try {
          existingOrders = JSON.parse(localStorage.getItem(localOrdersKey) || '[]');
        } catch (e) {
          console.error('Error parsing existing local orders:', e);
        }
        existingOrders.push(clientOrder);
        localStorage.setItem(localOrdersKey, JSON.stringify(existingOrders));
        console.log(`Saved local order to localStorage with key ${localOrdersKey} (target station: ${targetStationId})`);
        
        // Also clear from current station if different from target
        if (targetStationId !== currentStationId) {
          console.log(`Order is for station ${targetStationId}, not current station ${currentStationId}`);
        }
        
        // 2. Add directly to the main orders cache for the target station
        // targetStationId already defined above
        const ordersKey = `orders_cache_station_${targetStationId}`;
        let ordersCache = {};
        try {
          const cacheData = localStorage.getItem(ordersKey);
          if (cacheData) {
            ordersCache = JSON.parse(cacheData);
          }
        } catch (e) {
          console.error('Error parsing orders cache:', e);
        }
        
        // Make sure pendingOrders exists
        if (!ordersCache.pendingOrders) {
          ordersCache.pendingOrders = [];
        }
        
        // Add the new order
        ordersCache.pendingOrders.push(clientOrder);
        ordersCache.timestamp = Date.now();
        
        // Save back to storage in all places
        const serializedCache = JSON.stringify(ordersCache);
        localStorage.setItem(ordersKey, serializedCache);
        sessionStorage.setItem(ordersKey, serializedCache);
        
        // 3. Create a backup
        localStorage.setItem(`${ordersKey}_backup`, serializedCache);
        localStorage.setItem(`${ordersKey}_backup_time`, Date.now().toString());
        
        console.log('Order saved to multiple storage locations for persistence');
      } catch (e) {
        console.error('Failed to save local order to storage:', e);
      }
      
      // Mark this order as created at the TARGET station for filtering purposes
      // This ensures it only shows up at the collection station
      localStorage.setItem(`order_created_at_station_${persistentId}`, String(targetStationId));
      
      // Only update UI if the order is for the current station
      if (targetStationId === currentStationId) {
        setPendingOrders(prev => [...prev, clientOrder]);
        setQueueCount(prev => prev + 1);
      } else {
        console.log(`Order is for station ${targetStationId}, not updating UI for station ${currentStationId}`);
      }
      
      // Trigger sound notification only at the target station
      if (targetStationId === currentStationId) {
        try {
          window.dispatchEvent(new CustomEvent('app:newOrder'));
        } catch (soundError) {
          console.error('Error triggering sound notification:', soundError);
        }
      }
      
      // Try server save but keep local order regardless
      try {
        console.log('Sending to server:', orderWithStation);
        const result = await OrderDataService.addWalkInOrder(orderWithStation);
        console.log('Server response:', result);
        
        if (result.success && result.id) {
          console.log('Server save successful, linking local order to server ID');
          // Store the order creation information in localStorage for filtering
          // Use targetStationId to ensure consistency
          console.log(`Storing order_created_at_station_${result.id} = ${targetStationId}`);
          localStorage.setItem(`order_created_at_station_${result.id}`, String(targetStationId));
        } else {
          console.log('Server call failed but keeping client-side order for UI consistency');
        }
      } catch (serverErr) {
        console.error('Server save attempt failed but continuing with local order:', serverErr);
      }
      
      // Manually trigger orders refresh after a short delay - only if needed
      // Commenting out to prevent duplicate processing
      // setTimeout(() => {
      //   window.dispatchEvent(new CustomEvent('app:refreshOrders'));
      // }, 500);
      
      return clientOrder;
    } catch (err) {
      setError(`Failed to add walk-in order: ${err.message}`);
      console.error('Add walk-in order error:', err);
      return false;
    }
  }, [currentStationId]);

  const sendMessage = useCallback(async (orderId, message) => {
    if (!orderId || !message) {
      setError('Cannot send message: Missing order ID or message');
      return false;
    }
    
    try {
      const result = await OrderDataService.sendMessageToCustomer(orderId, message);
      
      if (!result || !result.success) {
        const errorMessage = result?.message || 'Unknown error';
        throw new Error(`Failed to send message: ${errorMessage}`);
      }
      
      return true;
    } catch (err) {
      setError(`Failed to send message: ${err.message}`);
      console.error('Send message error:', err);
      return false;
    }
  }, [currentStationId]);

  // Calculate dynamic wait time based on queue and stats
  const calculateDynamicWaitTime = useCallback(() => {
    // Use the imported utility function
    
    // Calculate wait time based on queue count and station stats
    const baseWaitTime = 2; // Base 2 minutes for the first coffee
    const dynamicWaitTime = calculateWaitTime(queueCount, baseWaitTime, stationStats);
    
    console.log(`Calculated dynamic wait time: ${dynamicWaitTime}min based on queue=${queueCount}, avgPrepTime=${stationStats.avgPrepTime.toFixed(2)}`);
    
    // Update the wait time
    updateWaitTime(dynamicWaitTime);
    
    return dynamicWaitTime;
  }, [queueCount, stationStats, updateWaitTime]);

  // Add delayOrder functionality
  const delayOrder = useCallback(async (order, minutes = 5) => {
    if (!order || !order.id) {
      setError('Cannot delay order: Missing order ID');
      return false;
    }
    
    try {
      // Call API to delay the order
      // First check if OrderDataService has a delayOrder method
      if (typeof OrderDataService.delayOrder !== 'function') {
        // Fallback to optimistic UI update if no API endpoint exists
        console.log(`Delaying order #${order.id} by ${minutes} minutes (simulated)`);
        // In a real implementation, the delay would be communicated to the server
        // and this would not be needed
        return true;
      }
      
      const result = await OrderDataService.delayOrder(order.id, minutes);
      
      if (!result || !result.success) {
        const errorMessage = result?.message || 'Unknown error';
        throw new Error(`Failed to delay order: ${errorMessage}`);
      }
      
      // Refresh data to ensure consistency
      setTimeout(refreshData, 500);
      
      return true;
    } catch (err) {
      setError(`Failed to delay order: ${err.message}`);
      console.error('Delay order error:', err);
      return false;
    }
  }, [refreshData]);

  // Get batch groups from pending orders
  const getBatchGroups = useCallback(() => {
    return pendingOrders.reduce((groups, order) => {
      if (order.batchGroup) {
        if (!groups[order.batchGroup]) {
          groups[order.batchGroup] = [];
        }
        groups[order.batchGroup].push(order);
      }
      return groups;
    }, {});
  }, [pendingOrders]);

  return {
    // Data
    pendingOrders,
    inProgressOrders,
    completedOrders,
    previousOrders,
    historyOrders,
    yesterdayOrders,
    thisWeekOrders,
    searchResults,
    queueCount,
    online,
    loading,
    error,
    lastUpdated,
    isRefreshing,
    currentStationId,
    
    // Auto-refresh settings
    autoRefreshEnabled,
    autoRefreshInterval,
    toggleAutoRefresh,
    updateAutoRefreshInterval,
    
    // Order actions
    startOrder,
    completeOrder,
    markOrderPickedUp,
    processBatch,
    processBatchSelection,
    addWalkInOrder,
    sendMessage,
    updateWaitTime,
    calculateDynamicWaitTime,
    delayOrder,
    clearError: () => setError(null),
    refreshData,
    updateStationId,
    
    // Station performance stats
    stationStats,
    
    // History actions
    fetchYesterdayOrders,
    fetchThisWeekOrders,
    searchOrders,
    getOrderHistory,
    
    // Derived data
    batchGroups: getBatchGroups(),
    vipOrders: pendingOrders.filter(order => order.priority),
    regularOrders: pendingOrders.filter(order => !order.priority)
  };
}