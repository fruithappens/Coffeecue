# test_jwt_api.py
import requests
import json

BASE_URL = "http://localhost:5001"  # Change to your server port

def test_jwt_endpoints():
    # Step 1: Login to get token
    login_data = {
        "username": "admin",
        "password": "coffee123"  # Your admin password
    }
    
    print("1. Testing login endpoint...")
    response = requests.post(f"{BASE_URL}/auth/login", json=login_data)
    print(f"Status code: {response.status_code}")
    
    if response.status_code != 200:
        print(f"Login failed: {response.text}")
        return
    
    data = response.json()
    token = data.get('access_token')
    
    if not token:
        print("No access token in response!")
        return
    
    print(f"Received token: {token[:20]}...")
    
    # Step 2: Access a protected endpoint
    print("\n2. Testing protected endpoint...")
    headers = {"Authorization": f"Bearer {token}"}
    
    # Test an admin-protected endpoint
    response = requests.get(f"{BASE_URL}/api/dashboard/stats", headers=headers)
    print(f"Protected endpoint status: {response.status_code}")
    
    if response.status_code == 200:
        print("Success! Protected endpoint accessed with JWT token")
        print(f"Response data: {response.text[:100]}...")
    else:
        print(f"Failed to access protected endpoint: {response.text}")
    
    # Step 3: Test token refresh
    print("\n3. Testing token refresh...")
    refresh_data = {"refresh_token": data.get('refresh_token')}
    
    response = requests.post(f"{BASE_URL}/auth/refresh", json=refresh_data)
    print(f"Refresh status: {response.status_code}")
    
    if response.status_code == 200:
        refresh_data = response.json()
        new_token = refresh_data.get('access_token')
        print(f"Received new token: {new_token[:20]}...")
        
        # Verify new token works
        headers = {"Authorization": f"Bearer {new_token}"}
        response = requests.get(f"{BASE_URL}/api/dashboard/stats", headers=headers)
        print(f"New token test status: {response.status_code}")
    else:
        print(f"Token refresh failed: {response.text}")

if __name__ == "__main__":
    test_jwt_endpoints()