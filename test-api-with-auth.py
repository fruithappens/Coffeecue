#!/usr/bin/env python3
"""Test API endpoints with authentication"""
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
print(f"   Status: {response.status_code}")
print(f"   Response: {response.text[:200]}")

if response.status_code == 200:
    auth_data = response.json()
    token = auth_data.get('access_token') or auth_data.get('token')
    
    if token:
        # Test orders endpoints with authentication
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        }
        
        print("\n2. Testing /api/orders/pending?station_id=1...")
        response = requests.get(f"{BASE_URL}/api/orders/pending?station_id=1", headers=headers)
        print(f"   Status: {response.status_code}")
        print(f"   Response: {json.dumps(response.json(), indent=2)}")
        
        print("\n3. Testing /api/orders?station_id=1...")
        response = requests.get(f"{BASE_URL}/api/orders?station_id=1", headers=headers)
        print(f"   Status: {response.status_code}")
        print(f"   Response preview: {response.text[:500]}...")
    else:
        print("   ERROR: No token in response")
else:
    print(f"   ERROR: Login failed")