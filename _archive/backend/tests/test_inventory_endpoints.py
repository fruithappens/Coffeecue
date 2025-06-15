#!/usr/bin/env python3
"""
Test script for inventory API endpoints
"""
import urllib.request
import urllib.error
import json
import sys

# Base URL 
BASE_URL = "http://localhost:5001"

def test_endpoint(endpoint, data=None, method="GET"):
    """Test an API endpoint"""
    url = f"{BASE_URL}{endpoint}"
    print(f"\n----- Testing {method} {url} -----")
    
    try:
        if method == "GET":
            request = urllib.request.Request(url)
        elif method == "POST":
            request = urllib.request.Request(url, method="POST")
            request.add_header('Content-Type', 'application/json')
            if data:
                data_bytes = json.dumps(data).encode('utf-8')
                request.data = data_bytes
        else:
            print(f"Unsupported method: {method}")
            return False
        
        try:
            with urllib.request.urlopen(request) as response:
                status_code = response.getcode()
                print(f"Status Code: {status_code}")
                
                response_body = response.read().decode('utf-8')
                try:
                    json_response = json.loads(response_body)
                    pretty_json = json.dumps(json_response, indent=2)
                    print("Response:")
                    print(pretty_json)
                    return True
                except json.JSONDecodeError:
                    print("Response is not valid JSON:")
                    print(response_body)
                    return False
                
        except urllib.error.HTTPError as e:
            print(f"Request failed with status code {e.code}")
            print(f"Response: {e.read().decode('utf-8')}")
            return False
            
    except Exception as e:
        print(f"Error: {e}")
        return False

def main():
    # Test add-milk-options endpoint
    milk_test = test_endpoint("/api/inventory/add-milk-options", method="POST", data={})
    
    # Test add-coffee-types endpoint
    coffee_test = test_endpoint("/api/inventory/add-coffee-types", method="POST", data={})
    
    # Test add-custom-item endpoint
    custom_item_data = {
        "name": "Test Custom Item",
        "category": "milk",
        "amount": 5,
        "capacity": 10,
        "unit": "L"
    }
    custom_item_test = test_endpoint("/api/inventory/add-custom-item", method="POST", data=custom_item_data)
    
    # Summary
    print("\n----- Test Summary -----")
    print(f"Add Milk Options: {'PASS' if milk_test else 'FAIL'}")
    print(f"Add Coffee Types: {'PASS' if coffee_test else 'FAIL'}")
    print(f"Add Custom Item: {'PASS' if custom_item_test else 'FAIL'}")
    
    # Overall result
    if milk_test and coffee_test and custom_item_test:
        print("\nAll tests PASSED!")
        return 0
    else:
        print("\nSome tests FAILED!")
        return 1

if __name__ == "__main__":
    sys.exit(main())