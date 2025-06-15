#!/usr/bin/env python3
"""
Test order completion functionality
"""
import requests
import json
from datetime import datetime

# First login to get token
login_data = {
    "username": "barista",
    "password": "barista123"
}

# Login
print("Logging in...")
response = requests.post(
    "http://localhost:5001/api/auth/login",
    json=login_data,
    headers={"Content-Type": "application/json"}
)

if response.status_code != 200:
    print(f"Login failed: {response.text}")
    exit(1)

token = response.json()["token"]
print("✅ Login successful")

# Headers with token
headers = {
    "Authorization": f"Bearer {token}",
    "Content-Type": "application/json"
}

# Get pending orders
print("\nGetting pending orders...")
response = requests.get(
    "http://localhost:5001/api/orders/pending?station_id=1",
    headers=headers
)

if response.status_code == 200:
    data = response.json()
    # Handle both array response and object with orders array
    if isinstance(data, list):
        orders = data
    else:
        orders = data.get('orders', [])
    
    print(f"Found {len(orders)} pending orders")
    
    if orders:
        # Try to complete the first order
        order_id = orders[0].get('orderNumber') or orders[0].get('id')
        print(f"\nTrying to complete order: {order_id}")
        
        # First start the order
        start_response = requests.post(
            f"http://localhost:5001/api/orders/{order_id}/start",
            headers=headers,
            json={"station_id": 1}
        )
        
        if start_response.status_code == 200:
            print("✅ Order started successfully")
            
            # Now complete it
            complete_response = requests.post(
                f"http://localhost:5001/api/orders/{order_id}/complete",
                headers=headers
            )
            
            print(f"Complete response status: {complete_response.status_code}")
            print(f"Complete response: {complete_response.text}")
            
            if complete_response.status_code == 200:
                print("✅ Order completed successfully!")
            else:
                print("❌ Failed to complete order")
        else:
            print(f"❌ Failed to start order: {start_response.text}")
else:
    print(f"Failed to get orders: {response.text}")