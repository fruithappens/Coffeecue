#!/usr/bin/env python3
"""Debug the login response to see what we're getting"""

import requests
import json

# Base URL
BASE_URL = "http://localhost:5001"

def debug_login():
    """Debug the login response"""
    print("Debugging login response...")
    
    login_data = {
        "username": "barista",
        "password": "ExpressoBarista2025"
    }
    
    try:
        login_response = requests.post(f"{BASE_URL}/api/auth/login", json=login_data)
        print(f"Status: {login_response.status_code}")
        print(f"Headers: {dict(login_response.headers)}")
        print(f"Response text: {login_response.text}")
        
        if login_response.status_code == 200:
            try:
                json_response = login_response.json()
                print(f"JSON response: {json.dumps(json_response, indent=2)}")
            except:
                print("Response is not valid JSON")
        
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    debug_login()