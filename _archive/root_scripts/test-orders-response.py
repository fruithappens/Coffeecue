#!/usr/bin/env python3
"""Test orders API response format"""
import requests
import json

# Base URL
BASE_URL = "http://localhost:5001"

# Login first to get JWT token
login_data = {
    "username": "barista",
    "password": "barista123"
}

print("1. Testing login...")
response = requests.post(f"{BASE_URL}/api/auth/login", json=login_data)

if response.status_code == 200:
    auth_data = response.json()
    token = auth_data.get('access_token') or auth_data.get('token')
    
    if token:
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        }
        
        print("\n2. Testing /api/orders without station filter...")
        response = requests.get(f"{BASE_URL}/api/orders", headers=headers)
        if response.status_code == 200:
            data = response.json()
            print(f"   Response structure: {data.keys()}")
            if 'data' in data and data['data']:
                print(f"   Number of orders: {len(data['data'])}")
                print("   First order structure:")
                first_order = data['data'][0]
                for key, value in first_order.items():
                    print(f"     {key}: {value}")
            else:
                print("   No orders in response")
        
        print("\n3. Testing /api/orders?station_id=1...")
        response = requests.get(f"{BASE_URL}/api/orders?station_id=1", headers=headers)
        if response.status_code == 200:
            data = response.json()
            if 'data' in data and data['data']:
                print(f"   Number of orders for station 1: {len(data['data'])}")
                for order in data['data']:
                    print(f"   Order {order.get('orderNumber', 'NO NUMBER')}: {order.get('customerName', 'NO NAME')} - {order.get('coffeeType', 'NO TYPE')}")
            else:
                print("   No orders for station 1")