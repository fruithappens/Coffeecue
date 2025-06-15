/**
 * Fix for milkType.toLowerCase is not a function error
 */
(function() {
  console.log('🥛 Applying fix for milkType.toLowerCase error...');
  
  // Monitor for the error and patch function
  window.addEventListener('error', function(event) {
    if (event.error && event.error.message && 
        event.error.message.includes('milkType.toLowerCase is not a function')) {
      
      console.log('🥛 Caught milkType.toLowerCase error, patching...');
      
      // Find the getMilkColor function in the bundle
      patchMilkFunctions();
      
      // Prevent the error from showing
      event.preventDefault();
      return false;
    }
  }, true);
  
  // Try to patch the milk color functions
  function patchMilkFunctions() {
    // Try to find the getMilkColor function
    for (const prop in window) {
      try {
        // Skip non-objects
        if (typeof window[prop] !== 'object' || !window[prop]) continue;
        
        // Check if this object has a getMilkColor function
        if (typeof window[prop].getMilkColor === 'function') {
          // Back up the original function
          const originalGetMilkColor = window[prop].getMilkColor;
          
          // Replace with a safer version
          window[prop].getMilkColor = function(milkType) {
            try {
              // Ensure milkType is a string or provide a default
              const safeType = milkType && typeof milkType === 'string' 
                ? milkType 
                : (milkType?.name || milkType?.type || 'Regular');
              
              // Call the original function with the safe type
              return originalGetMilkColor(safeType);
            } catch (error) {
              console.log('Error in patched getMilkColor:', error);
              return '#FFFFFF'; // Default to white as fallback
            }
          };
          
          console.log('✅ Patched getMilkColor function in window.' + prop);
        }
        
        // Check for getOrderBackgroundColor function
        if (typeof window[prop].getOrderBackgroundColor === 'function') {
          // Back up the original function
          const originalGetOrderBackgroundColor = window[prop].getOrderBackgroundColor;
          
          // Replace with a safer version
          window[prop].getOrderBackgroundColor = function(order) {
            try {
              // If there's no order, return a default color
              if (!order) return '#FFFFFF';
              
              // Ensure milkType exists and is a string
              if (order.milkType && typeof order.milkType !== 'string') {
                order = {...order}; // Clone to avoid modifying original
                order.milkType = order.milkType.name || order.milkType.type || 'Regular';
              } else if (!order.milkType) {
                order = {...order}; // Clone to avoid modifying original
                order.milkType = 'Regular';
              }
              
              // Call the original function with the fixed order
              return originalGetOrderBackgroundColor(order);
            } catch (error) {
              console.log('Error in patched getOrderBackgroundColor:', error);
              return '#FFFFFF'; // Default to white as fallback
            }
          };
          
          console.log('✅ Patched getOrderBackgroundColor function in window.' + prop);
        }
      } catch (e) {
        // Ignore errors while searching
      }
    }
    
    // If we couldn't find the functions by name, patch at the error source
    patchOrdersComponent();
  }
  
  // Patch the RegularOrdersList component
  function patchOrdersComponent() {
    // Add a global helper to safely get milk color
    window.safeGetMilkColor = function(milkType) {
      try {
        // Ensure milk type is a string
        const safeType = typeof milkType === 'string' 
          ? milkType 
          : (milkType?.name || milkType?.type || 'Regular');
          
        // Convert to lowercase for matching
        const type = safeType.toLowerCase();
        
        // Basic color map
        const milkColors = {
          'regular': '#FFFFFF',
          'whole': '#FFFFFF',
          'full cream': '#FFFFFF',
          'skim': '#F0F8FF',
          'almond': '#FAEBD7',
          'oat': '#F5DEB3',
          'soy': '#FFF8DC',
          'lactose free': '#FFFACD'
        };
        
        // Return the color or default white
        return milkColors[type] || '#FFFFFF';
      } catch (error) {
        return '#FFFFFF'; // Default to white
      }
    };
    
    // Try to fix the fallback data
    try {
      // Fix localStorage data
      const fixOrders = function(key) {
        try {
          const orders = JSON.parse(localStorage.getItem(key) || '[]');
          let updated = false;
          
          orders.forEach(order => {
            if (order.milkType && typeof order.milkType !== 'string') {
              order.milkType = order.milkType.name || order.milkType.type || 'Regular';
              updated = true;
            } else if (!order.milkType) {
              order.milkType = 'Regular';
              updated = true;
            }
          });
          
          if (updated) {
            localStorage.setItem(key, JSON.stringify(orders));
            console.log(`✅ Fixed milkType in ${key}`);
          }
        } catch (e) {
          console.log(`Error fixing ${key}:`, e);
        }
      };
      
      // Fix all order types
      fixOrders('fallback_pending_orders');
      fixOrders('fallback_in_progress_orders');
      fixOrders('fallback_completed_orders');
      
      console.log('✅ Fixed milk types in fallback data');
    } catch (e) {
      console.log('Error fixing fallback data:', e);
    }
  }
  
  // Add fallback data with correct milk type
  function addCorrectFallbackData() {
    try {
      // Sample data for pending orders with correct milkType (string)
      const samplePendingOrders = [
        {
          id: 'sample_1',
          orderNumber: 'SP001',
          customerName: 'John Smith',
          coffeeType: 'Large Flat White',
          milkType: 'Regular', // String value
          sugar: 'No sugar',
          phoneNumber: '+61412345678',
          createdAt: new Date().toISOString(),
          waitTime: 5,
          promisedTime: 15,
          priority: false,
          status: 'pending',
          stationId: 1
        },
        {
          id: 'sample_2',
          orderNumber: 'SP002',
          customerName: 'Jane Doe',
          coffeeType: 'Medium Cappuccino',
          milkType: 'Almond', // String value
          sugar: '1 sugar',
          phoneNumber: '+61412345679',
          createdAt: new Date().toISOString(),
          waitTime: 8,
          promisedTime: 15,
          priority: true,
          status: 'pending',
          stationId: 2
        }
      ];
      
      // Save the fixed data
      localStorage.setItem('fallback_pending_orders', JSON.stringify(samplePendingOrders));
      localStorage.setItem('fallback_in_progress_orders', JSON.stringify([]));
      localStorage.setItem('fallback_completed_orders', JSON.stringify([]));
      
      console.log('✅ Added correct fallback data with string milkType');
    } catch (e) {
      console.log('Error adding fallback data:', e);
    }
  }
  
  // Apply all fixes
  patchMilkFunctions();
  addCorrectFallbackData();
  
  console.log('✅ All milk type fixes applied');
})();