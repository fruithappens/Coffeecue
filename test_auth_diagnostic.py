#!/usr/bin/env python3
"""
Diagnostic script to test authentication issues in Expresso
"""

import requests
import json
import sys

BASE_URL = "http://localhost:5001/api"

def test_api_health():
    """Test if API is running"""
    try:
        response = requests.get(f"{BASE_URL}/health")
        print(f"✅ API Health Check: {response.status_code}")
        if response.ok:
            print(f"   Response: {response.json()}")
        return response.ok
    except Exception as e:
        print(f"❌ API Health Check Failed: {e}")
        return False

def test_login(username, password):
    """Test login endpoint"""
    try:
        response = requests.post(
            f"{BASE_URL}/auth/login",
            json={"username": username, "password": password},
            headers={"Content-Type": "application/json"}
        )
        print(f"\n🔐 Login Test: {response.status_code}")
        if response.ok:
            data = response.json()
            print(f"   Success! Token received: {data.get('token', 'No token')[:50]}...")
            return data.get('token')
        else:
            print(f"   Failed: {response.text}")
            return None
    except Exception as e:
        print(f"❌ Login Test Failed: {e}")
        return None

def test_authenticated_request(token):
    """Test an authenticated API request"""
    try:
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        }
        response = requests.get(f"{BASE_URL}/orders/pending", headers=headers)
        print(f"\n📋 Authenticated Request Test: {response.status_code}")
        if response.ok:
            data = response.json()
            print(f"   Success! Orders retrieved: {len(data) if isinstance(data, list) else 'N/A'}")
        else:
            print(f"   Failed: {response.text}")
        return response.ok
    except Exception as e:
        print(f"❌ Authenticated Request Failed: {e}")
        return False

def main():
    print("Expresso Authentication Diagnostic")
    print("==================================")
    
    # Test API health
    if not test_api_health():
        print("\n⚠️  API is not responding. Make sure the backend is running on port 5001")
        sys.exit(1)
    
    # Test login with known credentials
    print("\n🔐 Testing login with default credentials...")
    
    # Try primary admin credentials
    token = test_login("coffeecue", "adminpassword")
    
    if not token:
        # Try secondary credentials
        print("\n🔐 Trying alternative credentials...")
        token = test_login("admin", "admin123")
    
    if not token:
        print("\n❌ Could not login with any known credentials")
        print("\nPossible issues:")
        print("1. Database might not have the default users")
        print("2. Credentials might have been changed")
        print("\nTry running: python create_admin.py")
        sys.exit(1)
    
    # Test authenticated request
    if token:
        test_authenticated_request(token)
        
        print("\n✅ Authentication is working correctly!")
        print(f"\nTo use this token in the frontend:")
        print(f"1. Open browser console (F12)")
        print(f"2. Run: localStorage.setItem('coffee_system_token', '{token}')")
        print(f"3. Run: localStorage.setItem('token', '{token}')")
        print(f"4. Refresh the page")

if __name__ == "__main__":
    main()