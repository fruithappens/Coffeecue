#!/usr/bin/env python3
"""
Debug API login endpoint
"""
import requests
import json

def test_api_login():
    """Test API login with debug output"""
    url = "http://localhost:5001/api/auth/login"
    
    # Test different variations
    test_cases = [
        {
            "name": "Standard JSON",
            "data": {"username": "barista", "password": "barista123"},
            "headers": {"Content-Type": "application/json"}
        },
        {
            "name": "With Accept header",
            "data": {"username": "barista", "password": "barista123"},
            "headers": {"Content-Type": "application/json", "Accept": "application/json"}
        }
    ]
    
    for test in test_cases:
        print(f"\n🧪 Testing: {test['name']}")
        print(f"📤 Request data: {test['data']}")
        print(f"📋 Headers: {test['headers']}")
        
        try:
            response = requests.post(url, json=test['data'], headers=test['headers'])
            
            print(f"📥 Status: {response.status_code}")
            print(f"📥 Response headers: {dict(response.headers)}")
            
            try:
                data = response.json()
                print(f"📥 Response: {json.dumps(data, indent=2)}")
            except:
                print(f"📥 Response text: {response.text}")
                
        except Exception as e:
            print(f"❌ Error: {str(e)}")
    
    # Also test direct auth module
    print("\n🧪 Testing direct auth module:")
    from auth import verify_login
    result = verify_login('barista', 'barista123')
    print(f"📥 Direct auth result: {result is not None}")

if __name__ == "__main__":
    test_api_login()