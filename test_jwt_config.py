#!/usr/bin/env python3
"""
Test script to verify JWT configuration and middleware fixes
"""
import requests
import json
import sys
from datetime import datetime, timedelta

def test_middleware_redirect():
    """Test that middleware redirects to /login instead of causing error"""
    print("🔧 Testing middleware redirect...")
    
    try:
        response = requests.get("http://localhost:5001/barista", allow_redirects=False)
        
        if response.status_code == 302:
            redirect_location = response.headers.get('Location', '')
            if '/login' in redirect_location:
                print("✅ Middleware redirect working correctly - redirects to /login")
                return True
            else:
                print(f"❌ Middleware redirects to wrong location: {redirect_location}")
                return False
        else:
            print(f"❌ Expected 302 redirect, got {response.status_code}")
            return False
            
    except Exception as e:
        print(f"❌ Error testing middleware: {str(e)}")
        return False

def test_jwt_expiration():
    """Test JWT token expiration setting"""
    print("\n🔧 Testing JWT token expiration...")
    
    try:
        login_data = {
            "username": "coffeecue",
            "password": "adminpassword"
        }
        
        response = requests.post(
            "http://localhost:5001/api/auth/login",
            json=login_data,
            headers={"Content-Type": "application/json"}
        )
        
        if response.status_code == 200:
            data = response.json()
            expires_in = data.get('expiresIn', 0)
            
            print(f"📅 Token expires in: {expires_in} seconds")
            print(f"📅 That's {expires_in / 3600:.1f} hours")
            
            if expires_in == 86400:  # 24 hours
                print("✅ JWT token expiration correctly set to 24 hours")
                return True
            elif expires_in == 3600:  # 1 hour (old setting)
                print("⚠️  JWT token still set to 1 hour - restart required to reload config")
                return False
            else:
                print(f"❓ Unexpected token expiration: {expires_in} seconds")
                return False
        else:
            print(f"❌ Login failed with status {response.status_code}")
            print(f"Response: {response.text}")
            return False
            
    except Exception as e:
        print(f"❌ Error testing JWT: {str(e)}")
        return False

def test_protected_route_access():
    """Test accessing a protected route with valid token"""
    print("\n🔧 Testing protected route access...")
    
    try:
        # First login
        login_data = {
            "username": "coffeecue", 
            "password": "adminpassword"
        }
        
        response = requests.post(
            "http://localhost:5001/api/auth/login",
            json=login_data,
            headers={"Content-Type": "application/json"}
        )
        
        if response.status_code != 200:
            print(f"❌ Login failed: {response.status_code}")
            return False
            
        data = response.json()
        token = data.get('token')
        
        if not token:
            print("❌ No token in login response")
            return False
        
        # Test protected API endpoint
        headers = {"Authorization": f"Bearer {token}"}
        
        response = requests.get(
            "http://localhost:5001/api/orders/pending", 
            headers=headers
        )
        
        if response.status_code == 200:
            print("✅ Protected API route accessible with token")
            return True
        else:
            print(f"❌ Protected route failed: {response.status_code}")
            print(f"Response: {response.text}")
            return False
            
    except Exception as e:
        print(f"❌ Error testing protected route: {str(e)}")
        return False

def main():
    print("=" * 60)
    print("🧪 EXPRESSO JWT & MIDDLEWARE TEST SUITE")
    print("=" * 60)
    
    results = []
    
    # Test 1: Middleware redirect
    results.append(test_middleware_redirect())
    
    # Test 2: JWT expiration
    results.append(test_jwt_expiration())
    
    # Test 3: Protected route access
    results.append(test_protected_route_access())
    
    print("\n" + "=" * 60)
    print("📊 TEST RESULTS")
    print("=" * 60)
    
    passed = sum(results)
    total = len(results)
    
    print(f"✅ Passed: {passed}/{total}")
    
    if passed == total:
        print("🎉 All tests passed! System working correctly.")
        return 0
    else:
        print("⚠️  Some tests failed - check output above for details.")
        return 1

if __name__ == "__main__":
    sys.exit(main())