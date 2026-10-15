#!/usr/bin/env python3
"""
Test barista authentication directly
"""
from auth import verify_login
import logging

logging.basicConfig(level=logging.DEBUG)

def test_barista_login():
    """Test barista login directly"""
    print("Testing barista login...")
    
    result = verify_login('barista', 'barista123')
    
    if result:
        print(f"✅ Login successful!")
        print(f"   User ID: {result['id']}")
        print(f"   Username: {result['username']}")
        print(f"   Role: {result['role']}")
    else:
        print("❌ Login failed")

if __name__ == "__main__":
    test_barista_login()