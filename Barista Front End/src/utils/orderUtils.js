// utils/orderUtils.js
// Common utility functions for working with orders

import { getCatalogMilks, getMilkTypeById, getMilkTypeByName } from './milkConfig';

/**
 * Parse a backend timestamp into a Date, treating timezone-less strings as UTC.
 *
 * The backend serialises datetimes with `.isoformat()` on naive UTC values
 * (e.g. "2026-06-13T11:20:00" — no trailing Z). `new Date()` parses those as
 * LOCAL time, so on UTC+9:30 (Adelaide) every order looked ~570 minutes old
 * ("571 min" wait on a 1-minute-old order) and the Display's "recently ready"
 * window dropped freshly-completed orders. Appending 'Z' when no timezone
 * marker is present makes the time correct in any timezone.
 */
export const parseServerDate = (value) => {
  if (value instanceof Date) return value;
  if (value == null) return new Date(NaN);
  if (typeof value === 'number') return new Date(value);
  const s = String(value).trim().replace(' ', 'T');
  const hasTz = /[zZ]$|[+-]\d\d:?\d\d$/.test(s);
  return new Date(hasTz ? s : s + 'Z');
};

/**
 * Build a lookup of which orders belong to a multi-coffee GROUP (a multi-drink
 * SMS like "1 oat latte and 1 flat white", or a FRIEND order). The backend
 * stamps a shared groupId (the lead order's number) on every member.
 *
 * Pass the FULL set of currently-visible orders (pending + in-progress +
 * completed) so the position/size counts are accurate across the board. Only
 * groups with 2+ visible members are returned — a lone order isn't a "group".
 *
 * @param {Array} orders - all visible orders
 * @returns {Object} map of orderId -> { groupId, groupLabel, size, position }
 */
export const buildGroupInfo = (orders) => {
  const groups = {};
  (orders || []).forEach((o) => {
    const gid = o.groupId || o.group_id;
    if (!gid) return;
    (groups[gid] = groups[gid] || []).push(o);
  });
  const byId = {};
  Object.entries(groups).forEach(([gid, members]) => {
    if (members.length < 2) return; // not actually a group yet
    // Stable, human order: by order number (numeric-aware).
    members.sort((a, b) =>
      String(a.orderNumber ?? a.id).localeCompare(
        String(b.orderNumber ?? b.id), undefined, { numeric: true }
      )
    );
    members.forEach((m, i) => {
      byId[m.id] = {
        groupId: gid,
        groupLabel: m.groupLabel || m.group_label || 'Group',
        size: members.length,
        position: i + 1,
      };
    });
  });
  return byId;
};

/**
 * Calculate time ratio color for wait time indicators
 * @param {number} waitTime - Current wait time in minutes
 * @param {number} promisedTime - Promised delivery time in minutes
 * @returns {string} CSS class for appropriate background color
 */
export const getTimeRatioColor = (waitTime, promisedTime) => {
  const ratio = waitTime / promisedTime;
  if (ratio <= 0.5) return 'bg-green-500';
  if (ratio <= 0.8) return 'bg-yellow-500';
  return 'bg-red-500';
};

/**
 * Calculate station wait time based on queue count, preparation stats and station capabilities
 * @param {number} queueCount - Number of orders in the queue
 * @param {number} [baseWaitTime=2] - Base preparation time for a single coffee in minutes
 * @param {Object} [stationStats=null] - Station statistics for dynamic calculation
 * @param {Object} [stationCapabilities=null] - Station capabilities configuration
 * @returns {number} Estimated wait time in minutes
 */
export const calculateWaitTime = (queueCount, baseWaitTime = 2, stationStats = null, stationCapabilities = null) => {
  // If we have station stats with average preparation time, use that
  if (stationStats && stationStats.avgPrepTime && stationStats.avgPrepTime > 0) {
    let waitTime = Math.max(2, Math.ceil(queueCount * stationStats.avgPrepTime));
    
    // Adjust wait time based on high_volume capability
    if (stationCapabilities && stationCapabilities.high_volume === true) {
      waitTime = Math.max(1, Math.floor(waitTime * 0.7)); // 30% faster for high volume stations
    }
    
    return waitTime;
  }
  
  // Otherwise use simple calculation with station capability adjustment
  let waitTime = baseWaitTime + Math.max(0, queueCount - 1);
  
  if (stationCapabilities && stationCapabilities.high_volume === true) {
    waitTime = Math.max(1, Math.floor(waitTime * 0.7)); // 30% faster for high volume stations
  }
  
  return waitTime;
};

/**
 * Get all active stations that can accept new orders
 * @param {Array} stations - Array of station objects
 * @returns {Array} Array of station objects that can accept orders
 */
export const getAvailableStations = (stations) => {
  if (!stations || !Array.isArray(stations)) {
    console.warn('No stations provided to getAvailableStations');
    return [];
  }
  
  // Filter out closed stations
  return stations.filter(station => {
    // Check if station is active or in a mode that can accept orders
    const status = station.status || 'active';
    const sessionMode = station.session_mode || 'active';
    
    return status === 'active' && (
      sessionMode === 'active' || 
      sessionMode === 'paused' || 
      sessionMode === 'pre-orders-only'
    );
  });
};

/**
 * Find optimal station for an order based on capabilities and current load
 * @param {Object} order - Order details including milk type, priority flag, etc.
 * @param {Array} stations - Array of available stations
 * @returns {Object|null} Best station for this order or null if none available
 */
export const findOptimalStationForOrder = (order, stations) => {
  if (!order || !stations || !Array.isArray(stations) || stations.length === 0) {
    return null;
  }
  
  // Get available stations (active/paused/pre-orders-only)
  const availableStations = getAvailableStations(stations);
  
  if (availableStations.length === 0) {
    console.warn('No available stations found for order assignment');
    return null;
  }
  
  // Check if this is an alternative milk order
  const hasAlternativeMilk = order.alternativeMilk || 
                            (order.milkTypeId && getMilkTypeById(order.milkTypeId)?.category === 'alternative') ||
                            (order.milkType && ['soy milk', 'almond milk', 'oat milk'].includes(order.milkType.toLowerCase()));
  
  // For VIP/priority orders, try to find a station with VIP capabilities
  if (order.priority || order.vip) {
    const vipStations = availableStations.filter(station => 
      station.capabilities && station.capabilities.vip_service === true
    );
    
    if (vipStations.length > 0) {
      // Sort by queue length (ascending)
      return vipStations.sort((a, b) => 
        (a.currentLoad || 0) - (b.currentLoad || 0)
      )[0];
    }
  }
  
  // For alternative milk orders, find stations that can handle them.
  // Truth comes from the ticked milk list (matching the backend router) —
  // the stored alt_milk flag is informational only. Empty/missing milk list
  // = wildcard (station serves everything).
  if (hasAlternativeMilk) {
    const ALT_MILKS = ['oat', 'almond', 'soy', 'coconut', 'macadamia', 'lactose', 'rice'];
    const servesAltMilk = (station) => {
      const milks = station.capabilities && station.capabilities.milk_types;
      if (!Array.isArray(milks) || milks.length === 0) {
        // No explicit milk list: fall back to the legacy flag (default true)
        return !station.capabilities || station.capabilities.alt_milk_available !== false;
      }
      return milks.some(m => ALT_MILKS.some(alt => String(m).toLowerCase().includes(alt)));
    };
    const altMilkStations = availableStations.filter(servesAltMilk);
    
    if (altMilkStations.length > 0) {
      // Sort by queue length (ascending)
      return altMilkStations.sort((a, b) => 
        (a.currentLoad || 0) - (b.currentLoad || 0)
      )[0];
    }
  }
  
  // Weighted selection based on load and capacity
  // Calculate station weights based on current load
  const stationWeights = availableStations.map(station => {
    const currentLoad = station.currentLoad || 0;
    const capacity = station.capacity || 10; // Default capacity
    
    // Calculate load ratio (0 = empty, 1 = full)
    const loadRatio = Math.min(1, currentLoad / capacity);
    
    // Higher weight for less loaded stations
    const loadWeight = 1 - loadRatio;
    
    // Higher weight for high volume stations
    const volumeMultiplier = (station.capabilities && station.capabilities.high_volume) ? 1.5 : 1;
    
    return {
      station,
      weight: loadWeight * volumeMultiplier
    };
  });
  
  // Sort by weight (descending)
  stationWeights.sort((a, b) => b.weight - a.weight);
  
  // Return station with highest weight
  return stationWeights[0].station;
};

/**
 * Get milk color from settings
 * @param {string} milkType - The milk type name or ID
 * @param {Object} settings - App settings with milk colors
 * @returns {string|null} CSS color or null if not found
 */
export const getMilkColor = (milkType, settings) => {
  if (!milkType || !settings || !settings.milkColors) return null;
  
  // First, try to find milk type in milkConfig
  let milkTypeObj = null;
  
  // Check if it's an ID
  milkTypeObj = getMilkTypeById(milkType);
  
  // If not found by ID, try by name
  if (!milkTypeObj) {
    milkTypeObj = getMilkTypeByName(milkType);
  }
  
  // If we found the milk type in our config, use its name for lookup
  if (milkTypeObj && settings.milkColors[milkTypeObj.name]) {
    return settings.milkColors[milkTypeObj.name];
  }
  
  // Direct match by string
  if (settings.milkColors[milkType]) {
    return settings.milkColors[milkType];
  }
  
  // Try to find a close match by checking if the milk type is contained in any of the keys
  const milkTypeKeys = Object.keys(settings.milkColors);
  for (const key of milkTypeKeys) {
    if (milkType.toLowerCase().includes(key.toLowerCase()) || 
        key.toLowerCase().includes(milkType.toLowerCase())) {
      return settings.milkColors[key];
    }
  }
  
  // If still not found, try to determine milk type from our config
  if (!milkTypeObj) {
    // Find milk type by partial name match
    milkTypeObj = getCatalogMilks().find(milk =>
      milk.name.toLowerCase().includes(milkType.toLowerCase()) ||
      milkType.toLowerCase().includes(milk.name.toLowerCase())
    );
  }
  
  // If found, check if it's an alternative milk
  if (milkTypeObj && milkTypeObj.category === 'alternative') {
    return '#E6E6FA'; // Default light purple for alternative milk
  }
  
  return null;
};

/**
 * Determine order background color based on properties
 * @param {Object} order - The order object
 * @param {Object} settings - App settings with milk colors
 * @returns {string} CSS class for order background
 */
export const getOrderBackgroundColor = (order, settings) => {
  if (order.priority) return 'bg-red-50';
  if (order.batchGroup) return 'bg-yellow-50';
  
  // Check for milk-based color coding
  if (order.milkTypeId || order.milkType || order.milk_type || order.milk) {
    // Try to get milk type by ID first, then by name
    let milkTypeName = '';
    let milkTypeObj = null;
    
    if (order.milkTypeId) {
      // If we have a milk type ID, get the object from config
      milkTypeObj = getMilkTypeById(order.milkTypeId);
      if (milkTypeObj) {
        milkTypeName = milkTypeObj.name;
      }
    }
    
    // If we couldn't find by ID, use the name
    if (!milkTypeObj) {
      milkTypeName = order.milkType || order.milk_type || order.milk || '';
      milkTypeObj = getMilkTypeByName(milkTypeName);
    }
    
    // Handle special case for Lactose-Free Milk
    if ((milkTypeObj && milkTypeObj.properties.lactoseFree) || 
        (milkTypeName && milkTypeName.toLowerCase().includes('lactose'))) {
      return 'bg-white border-2 border-blue-200';
    }
    
    // For known milk types, create a standardized class name
    if (milkTypeObj) {
      // Use ID for more reliable class name
      // We specifically don't replace underscores with hyphens here
      // because our CSS classes are defined both ways
      const className = `order-milk-${milkTypeObj.id}`;
      console.log('Using milk class: ', className, 'for milk: ', milkTypeObj);
      return className;
    }
    
    // Try to get the color from settings as fallback
    const milkColor = getMilkColor(order.milkTypeId || milkTypeName, settings);
    if (milkColor) {
      // Use the sanitized milk type name for the CSS class
      const cssClassName = milkTypeName.toLowerCase().replace(/\s+/g, '-');
      return `order-milk-${cssClassName}`;
    }
    
    // Default handling for unknown alternative milk
    if (order.alternativeMilk) {
      return 'bg-blue-50 border-l-4 border-blue-300';
    }
  }
  
  if (order.allergyWarning) return 'bg-purple-50';
  return 'bg-white';
};

/**
 * Format time since date
 * @param {Date|string} dateString - Date to format
 * @returns {string} Formatted time string
 */
export const formatTimeSince = (dateString) => {
  const date = new Date(dateString);
  const now = new Date();
  const diffMinutes = Math.floor((now - date) / (1000 * 60));
  
  if (diffMinutes < 1) return 'Just now';
  if (diffMinutes === 1) return '1 minute ago';
  return `${diffMinutes}m ago`;
};

/**
 * Format a batch name for display
 * @param {string} batchName - Raw batch name (e.g. "soy-latte")
 * @returns {string} Formatted name (e.g. "Soy Latte")
 */
export const formatBatchName = (batchName) => {
  return batchName
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};

/**
 * Calculate minutes difference between two dates
 * @param {Date|string} date1 - First date
 * @param {Date|string} date2 - Second date (defaults to now)
 * @returns {number} Minutes difference
 */
export const calculateMinutesDiff = (date1, date2 = new Date()) => {
  return Math.floor((new Date(date2) - new Date(date1)) / 60000);
};

/**
 * Get estimated preparation time for a coffee type
 * @param {string} coffeeType - Type of coffee
 * @returns {number} Estimated preparation time in minutes
 */
export const getEstimatedPrepTime = (coffeeType) => {
  const prepTimes = {
    'Espresso': 1,
    'Macchiato': 1.5,
    'Americano': 1.5,
    'Flat White': 2,
    'Cappuccino': 2.5,
    'Latte': 2.5,
    'Mocha': 3,
    'Cold Brew': 1,
    'Pour Over': 3.5
  };
  
  // Try to match the coffee type
  const matchedType = Object.keys(prepTimes).find(type => 
    coffeeType.toLowerCase().includes(type.toLowerCase())
  );
  
  return matchedType ? prepTimes[matchedType] : 2; // Default to 2 minutes
};

// This function has been replaced by the more complete version above
