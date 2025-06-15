#!/usr/bin/env python3
"""Test stations API endpoint"""
import requests
import json

# Base URL
BASE_URL = "http://localhost:5001"

print("1. Testing /api/stations without auth...")
response = requests.get(f"{BASE_URL}/api/stations")
print(f"   Status: {response.status_code}")
print(f"   Response: {json.dumps(response.json(), indent=2) if response.status_code == 200 else response.text}")