# Inventory API Guide

## Overview
The inventory system has been updated with additional endpoints to support milk and coffee type management. This guide will help you understand and use these endpoints.

## Authentication
All inventory endpoints require authentication with a JWT token. You need to:
1. Log in to get a token
2. Include the token in your requests as a Bearer token in the Authorization header

## Endpoints

### 1. Add Milk Options
**Endpoint:** `/api/inventory/add-milk-options`  
**Method:** POST  
**Description:** Adds a predefined set of milk options to the inventory.

Adds the following milk types:
- Standard Milks: Full Cream Milk, Skim Milk, Reduced Fat Milk, Lactose-Free Milk
- Alternative Milks: Soy Milk, Almond Milk, Oat Milk, Coconut Milk, Macadamia Milk, Rice Milk

You can also add a custom milk by including it in the request body:
```json
{
  "custom_milk": "Hemp Milk",
  "amount": 3,
  "capacity": 3
}
```

### 2. Add Coffee Types
**Endpoint:** `/api/inventory/add-coffee-types`  
**Method:** POST  
**Description:** Adds standard coffee types to the inventory.

Adds various coffee types including: Cappuccino, Latte, Flat White, Espresso, Long Black, Mocha, Hot Chocolate, Chai Latte, Matcha Latte, Piccolo, Macchiato, Affogato, Cold Brew.

You can also add a custom coffee type in the request body:
```json
{
  "custom_coffee": "Turkish Coffee",
  "notes": "Strong coffee with fine grounds"
}
```

### 3. Add Custom Inventory Item
**Endpoint:** `/api/inventory/add-custom-item`  
**Method:** POST  
**Description:** Adds a custom inventory item of any category.

Required fields in the request body:
```json
{
  "name": "Item Name",
  "category": "milk",  // or any valid category
  "amount": 5,
  "capacity": 10,
  "unit": "L"
}
```

## Testing the API
To test these endpoints, use the provided scripts:
- `python3 test_inventory_endpoints.py` - Simple test without authentication
- `python3 test_inventory_endpoints_auth.py` - Test with authentication

## Troubleshooting
If you can't see the changes in your frontend application:
1. Check that the browser cache is cleared
2. Verify the backend server is running (`python3 run_server.py`)
3. Ensure you have the necessary permissions (admin or staff role)
4. Check network requests in your browser's developer tools
5. Try running the test scripts to directly verify the API endpoints