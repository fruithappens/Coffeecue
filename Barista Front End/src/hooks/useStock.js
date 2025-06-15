// hooks/useStock.js
import { useState, useEffect, useCallback } from 'react';
import StockService from '../services/StockService';

/**
 * Custom hook for stock management
 * @param {number|string} stationId - The station ID to manage stock for
 * @param {string} stationName - The station name
 * @returns {Object} - Stock management methods and data
 */
const useStock = (stationId, stationName) => {
  const [stockItems, setStockItems] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [initialized, setInitialized] = useState(false);

  // Initialize service when stationId or stationName changes
  useEffect(() => {
    if (stationId && stationName) {
      console.log(`useStock: Initializing for station ${stationId} (${stationName})`);
      StockService.initialize(stationId, stationName);
      setInitialized(true);
      
      // Load initial stock data
      loadStockData();
      
      // Add listener for stock updates
      const removeListener = StockService.addListener((updatedStock) => {
        setStockItems(updatedStock);
        setLoading(false);
      });
      
      // Cleanup on unmount
      return () => {
        removeListener();
      };
    }
  }, [stationId, stationName]);

  // Load stock data
  const loadStockData = useCallback(async () => {
    try {
      setLoading(true);
      const stockData = StockService.getLocalStock();
      setStockItems(stockData || {});
      setError(null);
    } catch (err) {
      console.error('Error loading stock data:', err);
      setError('Failed to load stock data');
    } finally {
      setLoading(false);
    }
  }, []);

  // Get stock for a specific category
  const getCategoryStock = useCallback((category) => {
    return stockItems[category] || [];
  }, [stockItems]);

  // Update a stock item's amount
  const updateStockItem = useCallback((category, itemId, newAmount) => {
    try {
      if (!initialized) {
        console.warn('Stock service not initialized, cannot update stock item');
        return false;
      }
      
      const success = StockService.updateLocalStockAmount(category, itemId, newAmount);
      
      if (success) {
        // The stock service will notify listeners, which will update our state
        return true;
      }
      
      return false;
    } catch (err) {
      console.error('Error updating stock item:', err);
      setError('Failed to update stock item');
      return false;
    }
  }, [initialized]);

  // Add a new stock item
  const addStockItem = useCallback((category, itemData) => {
    try {
      if (!initialized) {
        console.warn('Stock service not initialized, cannot add stock item');
        return false;
      }
      
      const success = StockService.addLocalStockItem(category, itemData);
      
      if (success) {
        // The stock service will notify listeners, which will update our state
        return true;
      }
      
      return false;
    } catch (err) {
      console.error('Error adding stock item:', err);
      setError('Failed to add stock item');
      return false;
    }
  }, [initialized]);

  // Delete a stock item
  const deleteStockItem = useCallback((category, itemId) => {
    try {
      if (!initialized) {
        console.warn('Stock service not initialized, cannot delete stock item');
        return false;
      }
      
      const success = StockService.deleteLocalStockItem(category, itemId);
      
      if (success) {
        // The stock service will notify listeners, which will update our state
        return true;
      }
      
      return false;
    } catch (err) {
      console.error('Error deleting stock item:', err);
      setError('Failed to delete stock item');
      return false;
    }
  }, [initialized]);

  // Reset stock to defaults
  const resetStock = useCallback(() => {
    try {
      if (!initialized) {
        console.warn('Stock service not initialized, cannot reset stock');
        return false;
      }
      
      const success = StockService.resetStationStock();
      
      if (success) {
        // The stock service will notify listeners, which will update our state
        return true;
      }
      
      return false;
    } catch (err) {
      console.error('Error resetting stock:', err);
      setError('Failed to reset stock');
      return false;
    }
  }, [initialized]);

  // Stock categories
  const stockCategories = ['milk', 'coffee', 'cups', 'syrups', 'sweeteners', 'drinks', 'other'];
  
  // Count low and critical items
  const getLowStockCount = useCallback(() => {
    let lowCount = 0;
    let criticalCount = 0;
    
    Object.values(stockItems).forEach(category => {
      category.forEach(item => {
        if (item.status === 'danger') {
          criticalCount++;
        } else if (item.status === 'warning') {
          lowCount++;
        }
      });
    });
    
    return { lowCount, criticalCount };
  }, [stockItems]);

  return {
    stockItems,
    stockCategories,
    loading,
    error,
    initialized,
    loadStockData,
    getCategoryStock,
    updateStockItem,
    addStockItem,
    deleteStockItem,
    resetStock,
    getLowStockCount
  };
};

export default useStock;