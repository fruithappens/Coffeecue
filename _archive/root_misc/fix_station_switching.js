// Quick fix for station switching order disappearance
// Run this in browser console to force refresh orders when switching stations

console.log('🔧 Station Switching Fix Loaded');

// Function to force refresh orders
window.forceRefreshOrders = function() {
    console.log('🔄 Force refreshing orders...');
    
    // Clear order cache
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.includes('orders_')) {
            keysToRemove.push(key);
        }
    }
    
    keysToRemove.forEach(key => {
        localStorage.removeItem(key);
        console.log('🗑️ Removed cache:', key);
    });
    
    // Force page refresh to reload orders
    window.location.reload();
};

// Auto-fix: If orders count is 0 and we just switched stations, refresh
let lastStationId = null;
let orderCheckCount = 0;

const checkOrdersAfterStationSwitch = () => {
    const currentUrl = window.location.href;
    const stationMatch = currentUrl.match(/station[=\/](\d+)/);
    const currentStationId = stationMatch ? stationMatch[1] : null;
    
    if (currentStationId && currentStationId !== lastStationId) {
        console.log(`🔄 Station switched from ${lastStationId} to ${currentStationId}`);
        lastStationId = currentStationId;
        orderCheckCount = 0;
        
        // Check if orders disappeared after 2 seconds
        setTimeout(() => {
            const pendingOrders = document.querySelectorAll('[data-testid="pending-order"], .pending-order, .order-card');
            const inProgressOrders = document.querySelectorAll('[data-testid="in-progress-order"], .in-progress-order, .current-order');
            
            if (pendingOrders.length === 0 && inProgressOrders.length === 0) {
                console.log('⚠️ No orders found after station switch - auto-refreshing...');
                window.forceRefreshOrders();
            }
        }, 2000);
    }
};

// Monitor for station changes
setInterval(checkOrdersAfterStationSwitch, 1000);

console.log('✅ Station switching monitor active');
console.log('💡 If orders disappear, run: forceRefreshOrders()');