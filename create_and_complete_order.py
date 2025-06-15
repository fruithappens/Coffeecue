#!/usr/bin/env python3
"""
Create a test order and then try to complete it
"""
from utils.database import get_db_connection, close_connection
import json
from datetime import datetime
import random

# Create a test order
conn = get_db_connection()
cursor = conn.cursor()

# Generate random order number
order_number = f"TEST{random.randint(10000, 99999)}"

# Create order details
order_details = {
    "name": "Test Customer",
    "type": "Large Latte",
    "milk": "Oat",
    "sugar": "1 sugar",
    "extras": []
}

# Insert the order
cursor.execute('''
    INSERT INTO orders (order_number, phone, order_details, status, station_id, created_at, updated_at)
    VALUES (%s, %s, %s, %s, %s, %s, %s)
''', (
    order_number,
    "+61400000000",
    json.dumps(order_details),
    "pending",
    1,
    datetime.now(),
    datetime.now()
))

conn.commit()
print(f"✅ Created test order: {order_number}")

cursor.close()
close_connection(conn)

# Now test completing it
import requests

# Login
login_data = {
    "username": "barista",
    "password": "barista123"
}

print("\nLogging in...")
response = requests.post(
    "http://localhost:5001/api/auth/login",
    json=login_data,
    headers={"Content-Type": "application/json"}
)

if response.status_code != 200:
    print(f"Login failed: {response.text}")
    exit(1)

token = response.json()["token"]
print("✅ Login successful")

# Headers with token
headers = {
    "Authorization": f"Bearer {token}",
    "Content-Type": "application/json"
}

# Start the order
print(f"\nStarting order {order_number}...")
start_response = requests.post(
    f"http://localhost:5001/api/orders/{order_number}/start",
    headers=headers,
    json={"station_id": 1}
)

print(f"Start response status: {start_response.status_code}")
if start_response.status_code == 200:
    print("✅ Order started successfully")
else:
    print(f"Start response: {start_response.text}")

# Complete the order
print(f"\nCompleting order {order_number}...")
complete_response = requests.post(
    f"http://localhost:5001/api/orders/{order_number}/complete",
    headers=headers
)

print(f"Complete response status: {complete_response.status_code}")
print(f"Complete response: {complete_response.text}")

if complete_response.status_code == 200:
    print("✅ Order completed successfully!")
else:
    print("❌ Failed to complete order")