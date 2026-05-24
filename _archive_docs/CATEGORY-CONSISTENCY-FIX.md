# Category Consistency Fix

## Problem Summary
After clearing site data, there were inconsistencies between organiser inventory categories and barista stock categories:
1. Sweeteners were appearing in "Others" category instead of their own "Sweeteners" category
2. Drinks category was completely empty/missing
3. Category mapping was incorrectly routing sweeteners to "other"

## Root Causes
1. **InventoryIntegrationService.js** had incorrect category mapping:
   - `sweeteners: 'other'` was mapping sweeteners to the wrong category
   - Missing `drinks` category in the mapping

2. **InventoryManagement.js** didn't include a drinks category definition

3. **Stock defaults** didn't handle sweeteners and drinks categories properly

## Fixes Applied

### 1. Fixed Category Mapping (InventoryIntegrationService.js)
```javascript
// Before:
sweeteners: 'other',  // Wrong!

// After:
sweeteners: 'sweeteners',  // Keep sweeteners in their own category
drinks: 'drinks',         // Added drinks category
```

### 2. Added Drinks Category (InventoryManagement.js)
Added a new drinks category with default non-coffee beverages:
- Hot Chocolate
- Chai Latte
- Matcha Latte
- Golden Latte
- Hot Tea
- Iced Tea
- Fresh Juice
- Smoothie

### 3. Enhanced Stock Defaults (InventoryIntegrationService.js)
Added proper default handling for:
- **Sweeteners**: Different defaults for sugars (5kg), liquid sweeteners (2L), and packets (500pcs)
- **Drinks**: Default to 50 servings capacity

### 4. Created Fix Tool (fix-category-consistency.html)
Created a diagnostic and repair tool that:
- Analyzes current state of all categories
- Moves misplaced sweeteners from "other" to "sweeteners" 
- Ensures drinks category exists in both event inventory and station stock
- Provides sync and rebuild options

## How to Use the Fix Tool

1. Open http://localhost:3000/fix-category-consistency.html
2. Click "1. Analyze Current State" to see the current issues
3. Click "2. Fix Sweeteners in Wrong Category" to move misplaced items
4. Click "3. Ensure Drinks Category Exists" to add missing drinks
5. Click "4. Sync All Stations" to sync from organiser inventory
6. Only use "5. Clear All & Rebuild" if other options don't work

## Expected Results

After applying these fixes:
- Sweeteners should appear in their own "Sweeteners" category in barista stock
- Drinks category should be populated with non-coffee beverages
- Category consistency should be maintained between:
  - Organiser Event Inventory
  - Station Inventory assignments
  - Barista Stock categories
  - Walk-in order menu categories

## Prevention

To prevent this issue in the future:
1. Always ensure category mappings are consistent across the system
2. When adding new categories, update all relevant components:
   - InventoryManagement.js (organiser side)
   - InventoryIntegrationService.js (mapping and defaults)
   - useStock.js (barista side categories list)
3. Test category sync after clearing site data