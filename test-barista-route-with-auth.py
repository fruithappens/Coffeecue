#!/usr/bin/env python3
"""Test barista route with proper authentication"""

import requests
import json

# Base URL
BASE_URL = "http://localhost:5001"

def test_barista_route_with_auth():
    """Test the barista route with authentication"""
    print("Testing barista route with authentication...")
    
    # First, get a JWT token by logging in
    login_data = {
        "username": "barista",
        "password": "ExpressoBarista2025"
    }
    
    try:
        # Login to get JWT token
        print("1. Logging in to get JWT token...")
        login_response = requests.post(f"{BASE_URL}/api/auth/login", json=login_data)
        print(f"Login status: {login_response.status_code}")
        
        if login_response.status_code == 200:
            login_result = login_response.json()
            token = login_result.get('token')
            print(f"✓ Login successful, got token: {token[:50]}..." if token else "✗ No token in response")
            
            if token:
                # Test accessing the barista route with JWT token
                print("\n2. Testing barista route with JWT token...")
                headers = {
                    'Authorization': f'Bearer {token}'
                }
                barista_response = requests.get(f"{BASE_URL}/barista/", headers=headers)
                print(f"Barista route status: {barista_response.status_code}")
                print(f"Response headers: {dict(barista_response.headers)}")
                
                if barista_response.status_code == 200:
                    print("✓ Barista route accessible with JWT token")
                    print(f"Content length: {len(barista_response.text)} bytes")
                    if "barista" in barista_response.text.lower():
                        print("✓ Response contains barista content")
                elif barista_response.status_code == 302:
                    print("✗ Still getting redirect - JWT auth may not be working for Flask templates")
                    print(f"Redirect location: {barista_response.headers.get('Location')}")
                else:
                    print(f"✗ Unexpected status: {barista_response.status_code}")
                    print(f"Response: {barista_response.text[:200]}...")
        else:
            print(f"✗ Login failed: {login_response.text}")
            
    except Exception as e:
        print(f"✗ Error: {e}")

if __name__ == "__main__":
    test_barista_route_with_auth()