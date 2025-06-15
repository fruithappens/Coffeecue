#!/usr/bin/env node

/**
 * Script to verify both fixes are working correctly
 * 1. Stock persistence after refresh
 * 2. Walk-in orders going to correct collection station
 */

const fs = require('fs');
const path = require('path');

// Colors for console output
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m'
};

function log(message, type = 'info') {
    const color = type === 'success' ? colors.green :
                  type === 'error' ? colors.red :
                  type === 'warning' ? colors.yellow :
                  colors.blue;
    console.log(`${color}${message}${colors.reset}`);
}

// Check Fix 1: forceSyncStation call removed from BaristaInterface
function checkStockPersistenceFix() {
    log('\n=== Checking Stock Persistence Fix ===', 'info');
    
    const filePath = path.join(__dirname, 'Barista Front End/src/components/BaristaInterface.js');
    
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        
        // Check if the problematic forceSyncStation call is commented out or removed
        const forceSyncPattern = /^\s*InventoryIntegrationService\.forceSyncStation\(selectedStation\)/m;
        const commentedPattern = /^\s*\/\/.*InventoryIntegrationService\.forceSyncStation\(selectedStation\)/m;
        
        const hasActiveCall = forceSyncPattern.test(content);
        const hasCommentedCall = commentedPattern.test(content);
        
        if (hasActiveCall) {
            log('❌ FAIL: forceSyncStation call is still active in BaristaInterface', 'error');
            log('   This will cause stock to reset on page refresh!', 'error');
            return false;
        } else if (hasCommentedCall) {
            log('✅ PASS: forceSyncStation call is commented out', 'success');
            log('   Stock depletion will be preserved on refresh', 'success');
            return true;
        } else {
            log('✅ PASS: forceSyncStation call has been removed entirely', 'success');
            log('   Stock depletion will be preserved on refresh', 'success');
            return true;
        }
    } catch (error) {
        log(`❌ ERROR: Could not read BaristaInterface.js: ${error.message}`, 'error');
        return false;
    }
}

// Check Fix 2: Walk-in orders use target station for caching
function checkWalkInOrderFix() {
    log('\n=== Checking Walk-in Order Station Fix ===', 'info');
    
    const filePath = path.join(__dirname, 'Barista Front End/src/hooks/useOrders.js');
    
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        
        // Check if the fix uses targetStationId for local_orders_station key
        const targetStationPattern = /const targetStationId = clientOrder\.stationId \|\| clientOrder\.station_id \|\| currentStationId;\s*const localOrdersKey = `local_orders_station_\${targetStationId}`;/;
        
        // Also check the old problematic pattern
        const oldPattern = /const localOrdersKey = `local_orders_station_\${currentStationId}`;/;
        
        const hasNewFix = targetStationPattern.test(content);
        const hasOldCode = oldPattern.test(content) && !hasNewFix;
        
        if (hasNewFix) {
            log('✅ PASS: Walk-in orders use target station for caching', 'success');
            log('   Orders will appear at the correct collection station', 'success');
            return true;
        } else if (hasOldCode) {
            log('❌ FAIL: Walk-in orders still use current station for caching', 'error');
            log('   Orders will appear at the wrong station!', 'error');
            return false;
        } else {
            log('⚠️  WARNING: Could not find expected code pattern', 'warning');
            log('   Manual verification needed', 'warning');
            return false;
        }
    } catch (error) {
        log(`❌ ERROR: Could not read useOrders.js: ${error.message}`, 'error');
        return false;
    }
}

// Check Fix 3: InventoryIntegrationService preserves depleted stock
function checkInventoryServiceFix() {
    log('\n=== Checking Inventory Service Stock Preservation ===', 'info');
    
    const filePath = path.join(__dirname, 'Barista Front End/src/services/InventoryIntegrationService.js');
    
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        
        // Check if forceSyncStation checks for depleted stock
        const depletionCheckPattern = /if \(hasDepleted\) {\s*console\.log.*keeping existing data.*\s*return true;/s;
        
        if (depletionCheckPattern.test(content)) {
            log('✅ PASS: InventoryIntegrationService checks for depleted stock', 'success');
            log('   Depleted stock levels will be preserved', 'success');
            return true;
        } else {
            log('❌ FAIL: InventoryIntegrationService does not check for depletion', 'error');
            log('   Stock may still be overwritten on sync', 'error');
            return false;
        }
    } catch (error) {
        log(`❌ ERROR: Could not read InventoryIntegrationService.js: ${error.message}`, 'error');
        return false;
    }
}

// Main verification
function main() {
    log('Expresso Fixes Verification Script', 'info');
    log('==================================', 'info');
    
    const fix1 = checkStockPersistenceFix();
    const fix2 = checkWalkInOrderFix();
    const fix3 = checkInventoryServiceFix();
    
    log('\n=== Summary ===', 'info');
    
    const allPassed = fix1 && fix2 && fix3;
    
    if (allPassed) {
        log('\n🎉 All fixes are properly implemented!', 'success');
        log('Stock persistence and walk-in order station assignment should work correctly.', 'success');
    } else {
        log('\n⚠️  Some fixes are missing or incorrect!', 'error');
        log('Please review the failed checks above.', 'error');
    }
    
    // Exit with appropriate code
    process.exit(allPassed ? 0 : 1);
}

// Run the verification
main();