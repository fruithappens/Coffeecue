// OrderDataServiceCompat.js
// Temporary compatibility wrapper to ensure all expected methods exist

import orderDataService from './OrderDataService';

// Ensure all methods exist (add stubs if missing)
const ensureMethod = (obj, methodName, fallback) => {
  if (typeof obj[methodName] !== 'function') {
    console.warn(`OrderDataService.${methodName} is missing - adding stub`);
    obj[methodName] = fallback;
  }
};

// Add any missing methods with safe fallbacks
ensureMethod(orderDataService, 'checkConnection', async () => {
  console.warn('checkConnection stub called');
  return true; // Assume connected by default
});

ensureMethod(orderDataService, 'getPendingOrders', async () => {
  console.warn('getPendingOrders stub called');
  const orders = await orderDataService.getOrders();
  return orders.pendingOrders || [];
});

ensureMethod(orderDataService, 'getInProgressOrders', async () => {
  console.warn('getInProgressOrders stub called');
  const orders = await orderDataService.getOrders();
  return orders.inProgressOrders || [];
});

ensureMethod(orderDataService, 'getCompletedOrders', async () => {
  console.warn('getCompletedOrders stub called');
  const orders = await orderDataService.getOrders();
  return orders.completedOrders || [];
});

// Export the wrapped service
export default orderDataService;