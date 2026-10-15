#!/usr/bin/env python3
"""Debug API response to see actual fields"""
import requests
import json

# Base URL
BASE_URL = "http://localhost:5001"

# Login first to get JWT token
login_data = {
    "username": "barista",
    "password": "barista123"
}

response = requests.post(f"{BASE_URL}/api/auth/login", json=login_data)
if response.status_code == 200:
    auth_data = response.json()
    token = auth_data.get('access_token') or auth_data.get('token')
    
    if token:
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        }
        
        print("Testing /api/orders?station_id=1...")
        response = requests.get(f"{BASE_URL}/api/orders?station_id=1", headers=headers)
        
        # Print raw response text
        print(f"\nRaw response text (first 1000 chars):")
        print(response.text[:1000])
        
        if response.status_code == 200:
            data = response.json()
            if 'data' in data and data['data']:
                print(f"\n\nFirst order keys:")
                first_order = data['data'][0]
                for key in sorted(first_order.keys()):
                    print(f"  {key}")
                    
                print(f"\n\nChecking for camelCase fields:")
                print(f"  orderNumber: {'orderNumber' in first_order}")
                print(f"  customerName: {'customerName' in first_order}")
                print(f"  coffeeType: {'coffeeType' in first_order}")