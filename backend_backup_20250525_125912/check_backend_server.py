#!/usr/bin/env python
"""
Script to check if the backend server is running and available on port 5001
"""
import requests
import sys
import time

BASE_URL = "http://localhost:5001"
TEST_ENDPOINT = f"{BASE_URL}/api/test"
CHECK_INTERVAL = 1  # seconds
MAX_CHECKS = 5

def check_server_status():
    """Check if the server is running on port 5001"""
    print(f"Checking if backend server is running on {BASE_URL}...")
    
    for i in range(MAX_CHECKS):
        try:
            response = requests.get(TEST_ENDPOINT, timeout=2)
            if response.status_code == 200:
                data = response.json()
                print(f"✅ Server is running! Response: {data}")
                return True
            else:
                print(f"❌ Server responded with status code {response.status_code}")
                print(f"   Response: {response.text}")
        except requests.exceptions.ConnectionError:
            print(f"❌ Connection refused (attempt {i+1}/{MAX_CHECKS})")
        except Exception as e:
            print(f"❌ Error: {e}")
        
        # Wait before trying again
        if i < MAX_CHECKS - 1:
            print(f"   Retrying in {CHECK_INTERVAL} seconds...")
            time.sleep(CHECK_INTERVAL)
    
    print("\n❌ Backend server is NOT running on port 5001!")
    print("\nPlease start the server with: python run_server.py")
    return False

def check_api_endpoints():
    """Check common API endpoints to verify they're working"""
    endpoints = [
        {"url": "/api/orders/pending", "method": "GET", "auth_required": True},
        {"url": "/api/orders/in-progress", "method": "GET", "auth_required": True},
        {"url": "/api/orders/completed", "method": "GET", "auth_required": True},
        {"url": "/api/stations", "method": "GET", "auth_required": True},
        {"url": "/api/inventory", "method": "GET", "auth_required": True},
        {"url": "/api/schedule/today", "method": "GET", "auth_required": True},
    ]
    
    print("\nChecking API endpoints...")
    
    # First, get a token
    print("\nAuthentication check...")
    try:
        auth_response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"username": "admin", "password": "adminpassword"},
            timeout=3
        )
        
        if auth_response.status_code == 200 and "token" in auth_response.json():
            token = auth_response.json()["token"]
            print("✅ Authentication successful!")
            auth_headers = {"Authorization": f"Bearer {token}"}
        else:
            print(f"❌ Authentication failed with status {auth_response.status_code}")
            print(f"   Response: {auth_response.text}")
            print("Cannot test authenticated endpoints. Check admin user credentials.")
            return
    except Exception as e:
        print(f"❌ Authentication error: {e}")
        return
    
    # Now check each endpoint
    for endpoint in endpoints:
        url = f"{BASE_URL}{endpoint['url']}"
        
        print(f"\nChecking {endpoint['method']} {url}")
        
        try:
            if endpoint['method'] == 'GET':
                if endpoint['auth_required']:
                    response = requests.get(url, headers=auth_headers, timeout=3)
                else:
                    response = requests.get(url, timeout=3)
            else:
                print(f"Method {endpoint['method']} not implemented in test script")
                continue
            
            if response.status_code == 200:
                data = response.json()
                print(f"✅ Success! Status {response.status_code}")
                # Check for pagination or array data
                if "orders" in data:
                    print(f"   Found {len(data['orders'])} orders")
                elif "stations" in data:
                    print(f"   Found {len(data['stations'])} stations")
                elif "items" in data:
                    print(f"   Found {len(data['items'])} items")
                elif "schedules" in data:
                    print(f"   Found {len(data['schedules'])} schedule items")
            else:
                print(f"❌ Failed with status {response.status_code}")
                print(f"   Response: {response.text}")
                
        except Exception as e:
            print(f"❌ Error: {e}")
    
    print("\nAPI endpoint check complete!")

def main():
    """Main function"""
    server_running = check_server_status()
    
    if server_running:
        check_api_endpoints()
        
        print("\nNext steps:")
        print("1. Start the frontend: cd 'Barista Front End' && npm start")
        print("2. Open the browser at: http://localhost:3000")
        print("3. If issues persist, run: python test_login.py")

if __name__ == "__main__":
    main()