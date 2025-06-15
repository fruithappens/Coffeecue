#!/usr/bin/env python
"""
Test CORS headers on the API endpoints
"""
import requests
import json
from urllib.parse import urljoin

BASE_URL = "http://localhost:5001"

def test_cors_headers(endpoint):
    """Test if the endpoint has proper CORS headers"""
    url = urljoin(BASE_URL, endpoint)
    
    print(f"\nTesting CORS headers for: {url}")
    
    # First do an OPTIONS request (preflight)
    try:
        options_response = requests.options(
            url, 
            headers={
                'Origin': 'http://localhost:3000',
                'Access-Control-Request-Method': 'GET',
                'Access-Control-Request-Headers': 'Authorization,Content-Type'
            },
            timeout=5
        )
        
        print(f"OPTIONS Status Code: {options_response.status_code}")
        
        # Check if CORS headers are present
        cors_headers = [
            'Access-Control-Allow-Origin',
            'Access-Control-Allow-Methods',
            'Access-Control-Allow-Headers',
            'Access-Control-Allow-Credentials'
        ]
        
        print("CORS Headers:")
        for header in cors_headers:
            value = options_response.headers.get(header)
            if value:
                print(f"  ✅ {header}: {value}")
            else:
                print(f"  ❌ {header}: Missing")
        
        # Check all headers for debugging
        print("\nAll response headers:")
        for header, value in options_response.headers.items():
            print(f"  {header}: {value}")
            
    except requests.exceptions.RequestException as e:
        print(f"Error during OPTIONS request: {e}")
    
    # Then do a GET request to check actual access
    try:
        get_response = requests.get(
            url,
            headers={
                'Origin': 'http://localhost:3000'
            },
            timeout=5
        )
        
        print(f"\nGET Status Code: {get_response.status_code}")
        
        # Check if CORS headers are present in the GET response
        print("CORS Headers in GET response:")
        for header in cors_headers:
            value = get_response.headers.get(header)
            if value:
                print(f"  ✅ {header}: {value}")
            else:
                print(f"  ❌ {header}: Missing")
        
        # Check if we got a valid response
        try:
            response_data = get_response.json()
            print("\nResponse data:")
            print(json.dumps(response_data, indent=2)[:500] + "..." if len(json.dumps(response_data)) > 500 else json.dumps(response_data, indent=2))
        except:
            print("\nResponse is not JSON:")
            print(get_response.text[:500] + "..." if len(get_response.text) > 500 else get_response.text)
            
    except requests.exceptions.RequestException as e:
        print(f"Error during GET request: {e}")

def main():
    """Test CORS headers on key API endpoints"""
    print("CORS Headers Test\n")
    
    endpoints = [
        "/api/test",
        "/api/auth/login",
        "/api/orders/pending",
        "/api/stations"
    ]
    
    for endpoint in endpoints:
        test_cors_headers(endpoint)
    
    print("\nCORS testing complete!")

if __name__ == "__main__":
    main()