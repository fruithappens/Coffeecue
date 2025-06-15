#!/usr/bin/env python
"""
Mock API Server for Expresso that will accept any JWT token
Used for testing the frontend without the full backend
"""
from flask import Flask, jsonify, request
from flask_cors import CORS
import random
import time
import datetime
import json

app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "*"}})

# Sample data for the mock server
STATIONS = [
    {
        "id": 1,
        "name": "Main Station",
        "status": "active",
        "barista": "John Barista",
        "queue_length": 3,
        "last_activity": (datetime.datetime.now() - datetime.timedelta(minutes=2)).isoformat(),
        "capabilities": ["espresso", "milk-steaming", "tea"],
        "location": "Main Hall"
    },
    {
        "id": 2,
        "name": "Express Station",
        "status": "active",
        "barista": "Sarah Barista",
        "queue_length": 1,
        "last_activity": (datetime.datetime.now() - datetime.timedelta(minutes=5)).isoformat(),
        "capabilities": ["espresso", "milk-steaming"],
        "location": "Side Entrance"
    },
    {
        "id": 3,
        "name": "VIP Station",
        "status": "inactive",
        "barista": None,
        "queue_length": 0,
        "last_activity": (datetime.datetime.now() - datetime.timedelta(minutes=60)).isoformat(),
        "capabilities": ["espresso", "milk-steaming", "tea", "specialty"],
        "location": "VIP Area"
    }
]

PENDING_ORDERS = [
    {
        "id": "po_001",
        "orderNumber": "P001",
        "customerName": "John Smith",
        "phoneNumber": "+61412345678",
        "coffeeType": "Large Flat White",
        "milkType": "Full Cream",
        "sugar": "1 sugar",
        "extraHot": False,
        "priority": False,
        "status": "pending",
        "createdAt": (datetime.datetime.now() - datetime.timedelta(minutes=10)).isoformat(),
        "waitTime": 10,
        "expectedCompletionTime": (datetime.datetime.now() + datetime.timedelta(minutes=5)).isoformat(),
        "stationId": 1,
        "batchGroup": "flat-white"
    },
    {
        "id": "po_002",
        "orderNumber": "P002",
        "customerName": "Sarah Williams",
        "phoneNumber": "+61423456789",
        "coffeeType": "Regular Cappuccino",
        "milkType": "Almond",
        "sugar": "No sugar",
        "extraHot": True,
        "priority": True,
        "status": "pending",
        "createdAt": (datetime.datetime.now() - datetime.timedelta(minutes=7)).isoformat(),
        "waitTime": 7,
        "expectedCompletionTime": (datetime.datetime.now() + datetime.timedelta(minutes=3)).isoformat(),
        "stationId": 1,
        "batchGroup": "cappuccino-almond"
    }
]

# Routes
@app.route('/api/test', methods=['GET'])
def test():
    # Check authorization header for diagnostic purposes, but accept anything
    auth_header = request.headers.get('Authorization')
    print(f"Received auth header: {auth_header}")
    
    # Extract token if present
    token = None
    if auth_header and auth_header.startswith('Bearer '):
        token = auth_header.split(' ')[1]
        print(f"Token: {token}")
        
        # Try to decode token parts for logging
        try:
            parts = token.split('.')
            if len(parts) >= 2:
                # Base64 decode the payload
                import base64
                pad = '=' * (4 - len(parts[1]) % 4)
                payload = parts[1] + pad
                decoded = base64.b64decode(payload)
                payload_json = json.loads(decoded)
                print(f"Token payload: {payload_json}")
                print(f"Subject type: {type(payload_json.get('sub'))}")
        except Exception as e:
            print(f"Error decoding token: {str(e)}")
    
    return jsonify({
        "success": True,
        "message": "API is available",
        "timestamp": datetime.datetime.now().isoformat()
    })

@app.route('/api/stations', methods=['GET'])
def get_stations():
    return jsonify(STATIONS)

@app.route('/api/orders/pending', methods=['GET'])
def get_pending_orders():
    return jsonify(PENDING_ORDERS)

@app.route('/api/schedule/today', methods=['GET'])
def get_today_schedule():
    return jsonify({
        "success": True,
        "schedule": [
            {
                "id": 1,
                "date": datetime.datetime.now().strftime('%Y-%m-%d'),
                "shifts": [
                    {
                        "id": "shift1",
                        "startTime": "08:00",
                        "endTime": "12:00",
                        "barista": "John Barista",
                        "stationId": 1
                    },
                    {
                        "id": "shift2",
                        "startTime": "12:00",
                        "endTime": "16:00",
                        "barista": "Sarah Barista",
                        "stationId": 2
                    }
                ]
            }
        ]
    })

@app.route('/api/settings/wait-time', methods=['POST'])
def update_wait_time():
    # Parse the request body
    data = request.json
    wait_time = data.get('waitTime', 10)
    
    return jsonify({
        "success": True,
        "message": f"Wait time updated to {wait_time} minutes",
        "waitTime": wait_time
    })

# Catch-all route for any other API endpoints
@app.route('/api/<path:path>', methods=['GET', 'POST', 'PUT', 'DELETE'])
def catch_all(path):
    method = request.method
    print(f"Received {method} request for: /api/{path}")
    
    return jsonify({
        "success": True,
        "message": f"Mock response for {method} /api/{path}",
        "path": path,
        "method": method
    })

if __name__ == '__main__':
    print("Starting mock API server on http://localhost:5001")
    print("This server accepts ANY JWT token and returns sample data")
    print("Press CTRL+C to stop the server")
    app.run(debug=True, host='0.0.0.0', port=5001)