#!/usr/bin/env python3
"""Test barista route with session-based authentication"""

import requests

# Base URL
BASE_URL = "http://localhost:5001"

def test_barista_session_auth():
    """Test barista route with session-based authentication"""
    print("Testing barista route with session authentication...")
    
    # Create a session to maintain cookies
    session = requests.Session()
    
    try:
        # First check what the barista route expects by going directly
        print("1. Testing direct access to barista route...")
        response = session.get(f"{BASE_URL}/barista/")
        print(f"Status: {response.status_code}")
        print(f"Redirect location: {response.headers.get('Location', 'None')}")
        
        if response.status_code == 302:
            redirect_url = response.headers.get('Location', '')
            if '/auth/login' in redirect_url:
                print("✓ Route properly redirects to login - session auth expected")
                
                # Check if there's a specific login endpoint for barista
                print("\n2. Checking available auth endpoints...")
                auth_response = session.get(f"{BASE_URL}/auth/login")
                print(f"Auth login page status: {auth_response.status_code}")
                
                if auth_response.status_code == 200:
                    print("✓ Login page accessible")
                    # The content might have form fields we can use
                    if 'username' in auth_response.text.lower():
                        print("✓ Username field found in login form")
                    if 'password' in auth_response.text.lower():
                        print("✓ Password field found in login form")
        
        # Try the React frontend auth approach that we know works
        print("\n3. Testing JWT API auth that we know works...")
        login_data = {
            "username": "barista", 
            "password": "ExpressoBarista2025"
        }
        jwt_response = session.post(f"{BASE_URL}/api/auth/login", json=login_data)
        print(f"JWT login status: {jwt_response.status_code}")
        
        if jwt_response.status_code == 200:
            print("✓ JWT auth works - but Flask templates need session auth")
            print("✗ The barista backend route uses session auth, not JWT auth")
            print("🔧 Solution: Need to use the React frontend for barista interface")
            
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    test_barista_session_auth()