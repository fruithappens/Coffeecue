#!/usr/bin/env python
"""
Test script for all frontend-facing API endpoints
This script will check if the endpoints are accessible and returning basic responses
"""
import requests
import json
import sys
import time
import base64
import traceback

BASE_URL = "http://localhost:5001"

def print_response(response, label=None):
    """Print response in a readable format"""
    if label:
        print(f"\n=== {label} ===")
    
    try:
        # Try to parse as JSON
        json_data = response.json()
        print(f"Status: {response.status_code}")
        print(json.dumps(json_data, indent=2))
    except ValueError:
        # Not JSON, print as text
        print(f"Status: {response.status_code}")
        print(response.text)

def add_auth_header(headers=None):
    """Add Authorization header with the token"""
    if not hasattr(add_auth_header, "token"):
        # For debugging
        print("WARNING: No token available for authorization")
        return headers or {}
    
    result = headers.copy() if headers else {}
    result["Authorization"] = f"Bearer {add_auth_header.token}"
    
    # More verbose debugging
    print(f"Adding Authorization header: Bearer {add_auth_header.token[:10]}...")
    print(f"Full token length: {len(add_auth_header.token)}")
    
    # Verify token structure (should be a valid JWT with 3 parts separated by dots)
    parts = add_auth_header.token.split('.')
    if len(parts) == 3:
        print("Token appears to be a valid JWT format (has 3 parts)")
    else:
        print(f"WARNING: Token does not appear to be a valid JWT format (has {len(parts)} parts)")
    
    return result

def test_order_endpoints():
    """Test all order-related endpoints"""
    print("\n=== TESTING ORDER ENDPOINTS ===")
    
    # Create a test order for reliable testing
    print("\nCreating test order...")
    try:
        resp = requests.post(
            f"{BASE_URL}/api/debug/create-test-order", 
            json={
                "name": "Test Customer",
                "type": "Cappuccino",
                "milk": "Full cream",
                "size": "Regular",
                "sugar": "No sugar",
                "notes": "Created via API for testing"
            },
            headers=add_auth_header()
        )
        
        if resp.status_code == 200 and "order_number" in resp.json():
            order_id = resp.json()["order_number"]
            print(f"Created test order with ID: {order_id}")
        else:
            order_id = "test123"
            print(f"Failed to create test order, using: {order_id}")
    except Exception as e:
        order_id = "test123"
        print(f"Error creating test order: {e}")
    
    # Test all order-related endpoints
    endpoints = [
        {"method": "GET", "url": "/api/orders/pending", "label": "Get Pending Orders"},
        {"method": "GET", "url": "/api/orders/in-progress", "label": "Get In-Progress Orders"},
        {"method": "GET", "url": "/api/orders/completed", "label": "Get Completed Orders"},
        {"method": "POST", "url": f"/api/orders/{order_id}/start", "label": "Start Order"},
        {"method": "POST", "url": f"/api/orders/{order_id}/complete", "label": "Complete Order"},
        {"method": "POST", "url": f"/api/orders/{order_id}/pickup", "label": "Pickup Order"},
        {"method": "POST", "url": "/api/orders/batch", "data": {"order_ids": [order_id], "action": "start"}, "label": "Batch Process"},
        {"method": "POST", "url": f"/api/orders/{order_id}/message", "data": {"message": "Test message"}, "label": "Send Message"}
    ]
    
    for endpoint in endpoints:
        try:
            method = endpoint["method"]
            url = f"{BASE_URL}{endpoint['url']}"
            label = endpoint.get("label", url)
            data = endpoint.get("data")
            
            print(f"\nTesting: {method} {url}")
            
            headers = add_auth_header()
            
            if method == "GET":
                response = requests.get(url, headers=headers)
            elif method == "POST":
                response = requests.post(url, json=data, headers=headers)
            elif method == "PUT":
                response = requests.put(url, json=data, headers=headers)
            elif method == "PATCH":
                response = requests.patch(url, json=data, headers=headers)
            elif method == "DELETE":
                response = requests.delete(url, headers=headers)
            
            print_response(response, label)
            
        except Exception as e:
            print(f"Error testing {endpoint['url']}: {e}")
        
        # Small delay to avoid overwhelming the server
        time.sleep(0.5)

def test_inventory_endpoints():
    """Test all inventory-related endpoints"""
    print("\n=== TESTING INVENTORY ENDPOINTS ===")
    
    endpoints = [
        {"method": "GET", "url": "/api/inventory", "label": "Get All Inventory"},
        {"method": "GET", "url": "/api/inventory/categories", "label": "Get Categories"},
        {"method": "GET", "url": "/api/inventory/low-stock", "label": "Get Low Stock Items"},
        {"method": "POST", "url": "/api/inventory/1/report-low", "data": {"urgency": "normal", "notes": "Test report"}, "label": "Report Low Stock"},
        {"method": "POST", "url": "/api/inventory/restock-request", "data": {"items": [{"id": 1, "quantity": 5}]}, "label": "Request Restock"},
    ]
    
    for endpoint in endpoints:
        try:
            method = endpoint["method"]
            url = f"{BASE_URL}{endpoint['url']}"
            label = endpoint.get("label", url)
            data = endpoint.get("data")
            
            print(f"\nTesting: {method} {url}")
            
            headers = add_auth_header()
            
            if method == "GET":
                response = requests.get(url, headers=headers)
            elif method == "POST":
                response = requests.post(url, json=data, headers=headers)
            elif method == "PUT":
                response = requests.put(url, json=data, headers=headers)
            elif method == "PATCH":
                response = requests.patch(url, json=data, headers=headers)
            elif method == "DELETE":
                response = requests.delete(url, headers=headers)
            
            print_response(response, label)
            
        except Exception as e:
            print(f"Error testing {endpoint['url']}: {e}")
        
        # Small delay to avoid overwhelming the server
        time.sleep(0.5)

def test_station_endpoints():
    """Test all station-related endpoints"""
    print("\n=== TESTING STATION ENDPOINTS ===")
    
    endpoints = [
        {"method": "GET", "url": "/api/stations", "label": "Get All Stations"},
        {"method": "GET", "url": "/api/stations/1", "label": "Get Station Details"},
        {"method": "PATCH", "url": "/api/stations/1/status", "data": {"status": "active"}, "label": "Update Station Status"},
        {"method": "GET", "url": "/api/stations/1/stats", "label": "Get Station Stats"},
        {"method": "PATCH", "url": "/api/stations/1/barista", "data": {"barista_name": "Test Barista"}, "label": "Assign Barista"}
    ]
    
    for endpoint in endpoints:
        try:
            method = endpoint["method"]
            url = f"{BASE_URL}{endpoint['url']}"
            label = endpoint.get("label", url)
            data = endpoint.get("data")
            
            print(f"\nTesting: {method} {url}")
            
            headers = add_auth_header()
            print(f"Using authorization header: {headers.get('Authorization', 'None')}")
            
            if method == "GET":
                response = requests.get(url, headers=headers)
            elif method == "POST":
                response = requests.post(url, json=data, headers=headers)
            elif method == "PUT":
                response = requests.put(url, json=data, headers=headers)
            elif method == "PATCH":
                response = requests.patch(url, json=data, headers=headers)
            elif method == "DELETE":
                response = requests.delete(url, headers=headers)
            
            print_response(response, label)
            
        except Exception as e:
            print(f"Error testing {endpoint['url']}: {e}")
        
        # Small delay to avoid overwhelming the server
        time.sleep(0.5)

def test_chat_endpoints():
    """Test all chat-related endpoints"""
    print("\n=== TESTING CHAT ENDPOINTS ===")
    
    endpoints = [
        {"method": "GET", "url": "/api/chat/messages", "label": "Get Chat Messages"},
        {"method": "POST", "url": "/api/chat/messages", "data": {"sender": "Tester", "content": "Test message"}, "label": "Send Chat Message"},
        {"method": "GET", "url": "/api/chat/stations", "label": "Get Chat Stations"},
    ]
    
    for endpoint in endpoints:
        try:
            method = endpoint["method"]
            url = f"{BASE_URL}{endpoint['url']}"
            label = endpoint.get("label", url)
            data = endpoint.get("data")
            
            print(f"\nTesting: {method} {url}")
            
            headers = add_auth_header()
            
            if method == "GET":
                response = requests.get(url, headers=headers)
            elif method == "POST":
                response = requests.post(url, json=data, headers=headers)
            elif method == "PUT":
                response = requests.put(url, json=data, headers=headers)
            elif method == "PATCH":
                response = requests.patch(url, json=data, headers=headers)
            elif method == "DELETE":
                response = requests.delete(url, headers=headers)
            
            print_response(response, label)
            
        except Exception as e:
            print(f"Error testing {endpoint['url']}: {e}")
        
        # Small delay to avoid overwhelming the server
        time.sleep(0.5)

def test_schedule_endpoints():
    """Test all schedule-related endpoints"""
    print("\n=== TESTING SCHEDULE ENDPOINTS ===")
    
    endpoints = [
        {"method": "GET", "url": "/api/schedule/today", "label": "Get Today's Schedule"},
    ]
    
    for endpoint in endpoints:
        try:
            method = endpoint["method"]
            url = f"{BASE_URL}{endpoint['url']}"
            label = endpoint.get("label", url)
            data = endpoint.get("data")
            
            print(f"\nTesting: {method} {url}")
            
            headers = add_auth_header()
            
            if method == "GET":
                response = requests.get(url, headers=headers)
            elif method == "POST":
                response = requests.post(url, json=data, headers=headers)
            elif method == "PUT":
                response = requests.put(url, json=data, headers=headers)
            elif method == "PATCH":
                response = requests.patch(url, json=data, headers=headers)
            elif method == "DELETE":
                response = requests.delete(url, headers=headers)
            
            print_response(response, label)
            
        except Exception as e:
            print(f"Error testing {endpoint['url']}: {e}")
        
        # Small delay to avoid overwhelming the server
        time.sleep(0.5)

def test_sms_endpoints():
    """Test all SMS-related endpoints"""
    print("\n=== TESTING SMS ENDPOINTS ===")
    
    endpoints = [
        {"method": "POST", "url": "/api/sms/send-test", "data": {"to": "+61400000000", "message": "Test SMS"}, "label": "Send Test SMS"},
    ]
    
    for endpoint in endpoints:
        try:
            method = endpoint["method"]
            url = f"{BASE_URL}{endpoint['url']}"
            label = endpoint.get("label", url)
            data = endpoint.get("data")
            
            print(f"\nTesting: {method} {url}")
            
            headers = add_auth_header()
            
            if method == "GET":
                response = requests.get(url, headers=headers)
            elif method == "POST":
                response = requests.post(url, json=data, headers=headers)
            elif method == "PUT":
                response = requests.put(url, json=data, headers=headers)
            elif method == "PATCH":
                response = requests.patch(url, json=data, headers=headers)
            elif method == "DELETE":
                response = requests.delete(url, headers=headers)
            
            print_response(response, label)
            
        except Exception as e:
            print(f"Error testing {endpoint['url']}: {e}")
        
        # Small delay to avoid overwhelming the server
        time.sleep(0.5)

def decode_jwt(token):
    """Decode JWT token to get payload information"""
    try:
        # Split the token into parts
        parts = token.split('.')
        if len(parts) != 3:
            return "Invalid token format (not a JWT token)"
        
        # Get the payload part (second part)
        payload_base64 = parts[1]
        
        # Adjust the base64 string for padding
        padding_needed = len(payload_base64) % 4
        if padding_needed:
            payload_base64 += '=' * (4 - padding_needed)
        
        # Decode base64
        try:
            payload_bytes = base64.b64decode(payload_base64)
            payload = json.loads(payload_bytes.decode('utf-8'))
            return payload
        except Exception as e:
            return f"Error decoding payload: {str(e)}"
    except Exception as e:
        return f"Error decoding token: {str(e)}"

def authenticate():
    """Authenticate and get JWT token"""
    print("Authenticating with the backend...")
    try:
        resp = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"username": "admin", "password": "adminpassword"},
            timeout=5
        )
        
        if resp.status_code == 200 and "token" in resp.json():
            token = resp.json()["token"]
            print("Authentication successful, token received")
            
            # Decode the token to examine claims
            payload = decode_jwt(token)
            print("\nToken payload (decoded):")
            print(json.dumps(payload, indent=2))
            
            # Check for role claim
            if isinstance(payload, dict) and 'role' in payload:
                print(f"\nUser role: {payload['role']}")
            else:
                print("\nWARNING: No 'role' claim found in token!")
            
            # Store token in add_auth_header function for reuse
            add_auth_header.token = token
            return token
        else:
            print(f"Authentication failed: {resp.text}")
            return None
    except requests.exceptions.RequestException as e:
        print(f"Authentication error: {str(e)}")
        return None

def main():
    """Main test function"""
    print("Testing All Frontend-Facing API Endpoints\n")
    
    # Check if server is running
    try:
        resp = requests.get(f"{BASE_URL}/api/test", timeout=2)
        if resp.status_code != 200:
            print(f"Server error: API test endpoint returned status {resp.status_code}")
            return
    except requests.exceptions.RequestException:
        print(f"Error: Cannot connect to server at {BASE_URL}")
        print("Make sure the Flask application is running at http://localhost:5001")
        return
        
    # Authenticate first to get JWT token
    token = authenticate()
    
    # Set the token for all requests
    if token:
        add_auth_header.token = token
        print(f"Token set for all requests: {token[:10]}...")
    
    # Get command line arguments
    if len(sys.argv) > 1:
        test_type = sys.argv[1].lower()
        
        if test_type == "--orders":
            test_order_endpoints()
        elif test_type == "--inventory":
            test_inventory_endpoints()
        elif test_type == "--stations":
            test_station_endpoints()
        elif test_type == "--chat":
            test_chat_endpoints()
        elif test_type == "--schedule":
            test_schedule_endpoints()
        elif test_type == "--sms":
            test_sms_endpoints()
        else:
            print(f"Unknown test type: {test_type}")
            print("Available options: --orders, --inventory, --stations, --chat, --schedule, --sms")
    else:
        # Test all endpoints
        test_order_endpoints()
        test_inventory_endpoints()
        test_station_endpoints()
        test_chat_endpoints()
        test_schedule_endpoints()
        test_sms_endpoints()
    
    print("\nAPI testing completed")

if __name__ == "__main__":
    main()