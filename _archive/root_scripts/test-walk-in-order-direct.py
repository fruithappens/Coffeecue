#!/usr/bin/env python3
"""
Direct test of walk-in order functionality
DELETE BEFORE DEPLOYMENT
"""

import requests
import json
import sys
from datetime import datetime

BASE_URL = "http://localhost:5001"
AUTH_URL = f"{BASE_URL}/api/auth/login"
ORDERS_URL = f"{BASE_URL}/api/orders"

def log(message, level="INFO"):
    timestamp = datetime.now().strftime("%H:%M:%S")
    print(f"[{timestamp}] {level}: {message}")

def log_json(data, label):
    timestamp = datetime.now().strftime("%H:%M:%S")
    print(f"[{timestamp}] {label}:")
    print(json.dumps(data, indent=2))

def authenticate():
    """Login and get JWT token"""
    log("Authenticating as barista...")
    
    login_data = {
        "username": "barista",
        "password": "ExpressoBarista2025"
    }
    
    try:
        response = requests.post(AUTH_URL, json=login_data)
        log(f"Auth response: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            token = data.get('token')
            log("✅ Authentication successful!", "SUCCESS")
            log_json(data, "Auth Response")
            return token
        else:
            log(f"❌ Authentication failed: {response.status_code}", "ERROR")
            log(response.text, "ERROR")
            return None
            
    except Exception as e:
        log(f"❌ Authentication error: {str(e)}", "ERROR")
        return None

def test_walk_in_order(token):
    """Test creating a walk-in order"""
    log("Testing walk-in order creation...")
    
    headers = {
        'Authorization': f'Bearer {token}',
        'Content-Type': 'application/json'
    }
    
    order_data = {
        "customer_name": "Test Walk-In Customer",
        "coffee_type": "latte",
        "size": "medium",
        "milk_type": "oat",
        "special_instructions": "Extra hot please",
        "priority": "normal",
        "payment_method": "cash",
        "order_type": "walk-in",
        "created_by": "barista"
    }
    
    log_json(order_data, "Order Data")
    
    try:
        response = requests.post(ORDERS_URL, json=order_data, headers=headers)
        log(f"Order creation response: {response.status_code}")
        
        if response.status_code in [200, 201]:
            result = response.json()
            log("✅ Walk-in order created successfully!", "SUCCESS")
            log_json(result, "Order Result")
            
            # Test retrieving the order
            order_id = result.get('id') or result.get('order_id')
            if order_id:
                log(f"Testing retrieval of order {order_id}...")
                test_order_retrieval(token, order_id)
            
            return result
        else:
            log(f"❌ Order creation failed: {response.status_code}", "ERROR")
            log(response.text, "ERROR")
            return None
            
    except Exception as e:
        log(f"❌ Order creation error: {str(e)}", "ERROR")
        return None

def test_order_retrieval(token, order_id):
    """Test retrieving a specific order"""
    headers = {
        'Authorization': f'Bearer {token}',
        'Content-Type': 'application/json'
    }
    
    try:
        response = requests.get(f"{ORDERS_URL}/{order_id}", headers=headers)
        log(f"Order retrieval response: {response.status_code}")
        
        if response.status_code == 200:
            order = response.json()
            log("✅ Order retrieval successful!", "SUCCESS")
            log_json(order, "Retrieved Order")
        else:
            log(f"❌ Order retrieval failed: {response.status_code}", "ERROR")
            log(response.text, "ERROR")
            
    except Exception as e:
        log(f"❌ Order retrieval error: {str(e)}", "ERROR")

def test_orders_list(token):
    """Test getting list of orders"""
    log("Testing orders list...")
    
    headers = {
        'Authorization': f'Bearer {token}',
        'Content-Type': 'application/json'
    }
    
    try:
        response = requests.get(ORDERS_URL, headers=headers)
        log(f"Orders list response: {response.status_code}")
        
        if response.status_code == 200:
            orders = response.json()
            log(f"✅ Found {len(orders)} orders", "SUCCESS")
            if orders:
                log_json(orders[:2], "Sample Orders (first 2)")
        else:
            log(f"❌ Orders list failed: {response.status_code}", "ERROR")
            log(response.text, "ERROR")
            
    except Exception as e:
        log(f"❌ Orders list error: {str(e)}", "ERROR")

def test_other_apis(token):
    """Test other related APIs"""
    headers = {
        'Authorization': f'Bearer {token}',
        'Content-Type': 'application/json'
    }
    
    # Test stations API
    log("Testing stations API...")
    try:
        response = requests.get(f"{BASE_URL}/api/stations", headers=headers)
        log(f"Stations API response: {response.status_code}")
        if response.status_code == 200:
            stations = response.json()
            log(f"✅ Found {len(stations)} stations", "SUCCESS")
            log_json(stations, "Available Stations")
    except Exception as e:
        log(f"❌ Stations API error: {str(e)}", "ERROR")
    
    # Test inventory API
    log("Testing inventory API...")
    try:
        response = requests.get(f"{BASE_URL}/api/inventory", headers=headers)
        log(f"Inventory API response: {response.status_code}")
        if response.status_code == 200:
            inventory = response.json()
            log("✅ Inventory API working", "SUCCESS")
            log_json(inventory, "Current Inventory")
    except Exception as e:
        log(f"❌ Inventory API error: {str(e)}", "ERROR")

def main():
    """Main test function"""
    log("=== WALK-IN ORDER TESTING ===")
    log("This will test the walk-in order functionality")
    
    # Step 1: Authenticate
    token = authenticate()
    if not token:
        log("❌ Cannot continue without authentication", "ERROR")
        sys.exit(1)
    
    # Step 2: Test walk-in order creation
    order_result = test_walk_in_order(token)
    
    # Step 3: Test orders list
    test_orders_list(token)
    
    # Step 4: Test other APIs
    test_other_apis(token)
    
    log("=== TESTING COMPLETE ===")
    
    if order_result:
        log("✅ Walk-in order functionality is working!", "SUCCESS")
    else:
        log("❌ Walk-in order functionality has issues", "ERROR")

if __name__ == "__main__":
    main()