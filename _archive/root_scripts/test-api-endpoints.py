#!/usr/bin/env python3
"""Test API endpoints that the barista interface uses"""

import requests
import json

# Test the key API endpoints the barista interface uses
endpoints = [
    '/api/test',
    '/api/orders/pending',
    '/api/orders', 
    '/api/stations',
    '/api/auth/status'
]

# Get a fresh token
def get_token():
    login_data = {
        "username": "barista",
        "password": "ExpressoBarista2025"
    }
    
    try:
        response = requests.post('http://localhost:5001/api/auth/login', json=login_data)
        if response.status_code == 200:
            return response.json().get('token')
    except:
        pass
    return None

def test_endpoints():
    print('🔍 Testing API endpoints:')
    
    # First test without token
    print('\n📝 Testing without authentication:')
    for endpoint in endpoints:
        try:
            response = requests.get(f'http://localhost:5001{endpoint}', timeout=5)
            print(f'  {endpoint}: {response.status_code} - {response.reason}')
            if response.status_code != 200 and len(response.text) < 200:
                print(f'    Response: {response.text}')
        except Exception as e:
            print(f'  {endpoint}: ERROR - {e}')
    
    # Now test with token
    token = get_token()
    if token:
        print(f'\n🔑 Testing with authentication (token: {token[:30]}...):')
        headers = {
            'Authorization': f'Bearer {token}',
            'Accept': 'application/json'
        }
        
        for endpoint in endpoints:
            try:
                response = requests.get(f'http://localhost:5001{endpoint}', headers=headers, timeout=5)
                print(f'  {endpoint}: {response.status_code} - {response.reason}')
                if response.status_code == 200:
                    try:
                        data = response.json()
                        if isinstance(data, list):
                            print(f'    Returns: {len(data)} items')
                        elif isinstance(data, dict):
                            print(f'    Returns: {list(data.keys())}')
                    except:
                        print(f'    Returns: {len(response.text)} bytes')
                else:
                    if len(response.text) < 200:
                        print(f'    Error: {response.text}')
            except Exception as e:
                print(f'  {endpoint}: ERROR - {e}')
    else:
        print('\n❌ Could not get authentication token')

if __name__ == "__main__":
    test_endpoints()