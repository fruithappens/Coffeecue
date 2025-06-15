#!/usr/bin/env python
"""
Test script for authentication with the backend.
This will help debug login issues and verify token generation.
"""
import requests
import json
import base64
import sys

BASE_URL = "http://localhost:5001"

def test_login(username, password):
    """Test login with provided credentials and display token details"""
    print(f"\n=== Testing login with {username}/{password} ===")
    
    try:
        # Attempt login
        login_url = f"{BASE_URL}/api/auth/login"
        print(f"Sending POST request to {login_url}")
        
        resp = requests.post(
            login_url,
            json={"username": username, "password": password},
            timeout=5
        )
        
        # Print response details
        print(f"Response Status: {resp.status_code}")
        
        try:
            data = resp.json()
            print("Response Data:")
            print(json.dumps(data, indent=2))
            
            # If we got a token, decode and display it
            if "token" in data:
                token = data["token"]
                print("\n=== JWT Token Details ===")
                
                # Split token into parts
                parts = token.split('.')
                if len(parts) != 3:
                    print("Warning: Token does not have the expected 3 parts of a JWT")
                else:
                    # Decode header
                    try:
                        header_str = parts[0] + "=" * ((4 - len(parts[0]) % 4) % 4)  # Add padding
                        header_bytes = base64.b64decode(header_str)
                        header = json.loads(header_bytes)
                        print("\nHeader:")
                        print(json.dumps(header, indent=2))
                    except Exception as e:
                        print(f"Error decoding header: {e}")
                    
                    # Decode payload
                    try:
                        payload_str = parts[1] + "=" * ((4 - len(parts[1]) % 4) % 4)  # Add padding
                        payload_bytes = base64.b64decode(payload_str)
                        payload = json.loads(payload_bytes)
                        print("\nPayload:")
                        print(json.dumps(payload, indent=2))
                        
                        # Check for role
                        if "role" in payload:
                            print(f"\nUser role: {payload['role']}")
                        else:
                            print("\nWARNING: No 'role' claim found in token!")
                    except Exception as e:
                        print(f"Error decoding payload: {e}")
                
                # Test token with a protected endpoint
                print("\n=== Testing Token with Protected Endpoint ===")
                
                # Try to access the pending orders endpoint
                orders_url = f"{BASE_URL}/api/orders/pending"
                print(f"Sending GET request to {orders_url}")
                
                auth_resp = requests.get(
                    orders_url,
                    headers={"Authorization": f"Bearer {token}"},
                    timeout=5
                )
                
                print(f"Status: {auth_resp.status_code}")
                if auth_resp.status_code == 200:
                    print("✅ Token authentication successful!")
                    try:
                        orders_data = auth_resp.json()
                        if "orders" in orders_data:
                            print(f"Found {len(orders_data['orders'])} pending orders")
                        print(json.dumps(orders_data, indent=2))
                    except Exception as e:
                        print(f"Error parsing response: {e}")
                else:
                    print("❌ Token authentication failed")
                    print(auth_resp.text)
                
                # Also test station endpoint
                print("\n=== Testing Token with Station Endpoint ===")
                
                stations_url = f"{BASE_URL}/api/stations"
                print(f"Sending GET request to {stations_url}")
                
                stations_resp = requests.get(
                    stations_url,
                    headers={"Authorization": f"Bearer {token}"},
                    timeout=5
                )
                
                print(f"Status: {stations_resp.status_code}")
                if stations_resp.status_code == 200:
                    print("✅ Token authentication successful for stations endpoint!")
                    try:
                        stations_data = stations_resp.json()
                        if "stations" in stations_data:
                            print(f"Found {len(stations_data['stations'])} stations")
                        print(json.dumps(stations_data, indent=2))
                    except Exception as e:
                        print(f"Error parsing response: {e}")
                else:
                    print("❌ Token authentication failed for stations endpoint")
                    print(stations_resp.text)
                
                # Return the token for further use
                return token
            else:
                print("No token found in response")
                return None
        except ValueError:
            print("Response is not JSON:")
            print(resp.text)
            return None
    except requests.exceptions.RequestException as e:
        print(f"Request error: {e}")
        return None

def main():
    """Main test function"""
    print("JWT Authentication Tester")
    
    # Default credentials
    username = "admin"
    password = "adminpassword"
    
    # Allow command-line override
    if len(sys.argv) > 2:
        username = sys.argv[1]
        password = sys.argv[2]
    
    # Run the login test
    test_login(username, password)

if __name__ == "__main__":
    main()