#!/usr/bin/env python
"""
Test script for the Expresso consolidated API endpoints
"""
import requests
import json
import sys

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

def test_system_endpoints():
    """Test system endpoints"""
    # Test system status
    response = requests.get(f"{BASE_URL}/api/status")
    print_response(response, "System Status")
    
    # Test API connectivity
    response = requests.get(f"{BASE_URL}/api/test")
    print_response(response, "API Test")

def test_display_endpoints():
    """Test display endpoints (public)"""
    # Test display config
    response = requests.get(f"{BASE_URL}/api/display/config")
    print_response(response, "Display Config")
    
    # Test display orders
    response = requests.get(f"{BASE_URL}/api/display/orders")
    print_response(response, "Display Orders")

def test_order_endpoints():
    """Test order management endpoints"""
    # Create a test order first for reliable testing
    print("\n=== Creating Test Order ===")
    test_order_data = {
        "name": "Test Customer",
        "type": "Cappuccino",
        "milk": "Full cream",
        "size": "Regular",
        "sugar": "No sugar",
        "notes": "Created via API for testing"
    }
    response = requests.post(f"{BASE_URL}/api/debug/create-test-order", json=test_order_data)
    if response.status_code == 200 and "order_number" in response.json():
        # Use the real order number from the created order
        order_id = response.json()["order_number"]
        print(f"Successfully created test order with ID: {order_id}")
    else:
        # Fallback to a static ID if order creation fails
        order_id = "test_order_123"
        print(f"Failed to create test order, using static ID: {order_id}")
    
    print_response(response, "Create Test Order")
    
    # Test starting an order
    print("\n=== Testing Order Start ===")
    response = requests.post(f"{BASE_URL}/api/orders/{order_id}/start")
    print_response(response, "Start Order")
    
    # Test completing an order
    print("\n=== Testing Order Complete ===")
    response = requests.post(f"{BASE_URL}/api/orders/{order_id}/complete")
    print_response(response, "Complete Order")
    
    # Test marking an order as picked up
    print("\n=== Testing Order Pickup ===")
    response = requests.post(f"{BASE_URL}/api/orders/{order_id}/pickup")
    print_response(response, "Pickup Order")
    
    # Test batch processing orders
    print("\n=== Testing Batch Order Processing ===")
    batch_data = {
        "order_ids": ["batch_order_1", "batch_order_2"],
        "action": "start"
    }
    response = requests.post(f"{BASE_URL}/api/orders/batch", json=batch_data)
    print_response(response, "Batch Process Orders")
    
    # Test sending customer message
    print("\n=== Testing Order Message ===")
    message_data = {
        "message": "Your order is almost ready!"
    }
    response = requests.post(f"{BASE_URL}/api/orders/{order_id}/message", json=message_data)
    print_response(response, "Send Order Message")

def test_inventory_endpoints():
    """Test inventory management endpoints"""
    # Test getting inventory items
    response = requests.get(f"{BASE_URL}/api/inventory")
    print_response(response, "Get Inventory Items")
    
    # Test reporting low stock
    item_id = 1  # Sample item ID
    low_stock_data = {
        "urgency": "normal",
        "notes": "Running low on milk"
    }
    response = requests.post(f"{BASE_URL}/api/inventory/{item_id}/report-low", json=low_stock_data)
    print_response(response, "Report Low Stock")
    
    # Test creating restock request
    restock_data = {
        "items": [
            {"id": 1, "quantity": 5},
            {"id": 2, "quantity": 10}
        ],
        "notes": "Weekly restock"
    }
    response = requests.post(f"{BASE_URL}/api/inventory/restock-request", json=restock_data)
    print_response(response, "Create Restock Request")

def main():
    """Main test function"""
    print("Testing Expresso API Endpoints\n")
    
    try:
        if len(sys.argv) > 1:
            if sys.argv[1] == "--all":
                # Test all endpoints
                test_system_endpoints()
                test_display_endpoints()
                test_order_endpoints()
                test_inventory_endpoints()
            elif sys.argv[1] == "--orders":
                # Test only order endpoints
                test_order_endpoints()
            elif sys.argv[1] == "--inventory":
                # Test only inventory endpoints
                test_inventory_endpoints()
            elif sys.argv[1] == "--display":
                # Test only display endpoints
                test_display_endpoints()
        else:
            # Test only system endpoints by default
            test_system_endpoints()
            
        print("\nAPI testing completed successfully!")
    except requests.RequestException as e:
        print(f"\nError connecting to API: {e}")
        print("Make sure the Flask application is running at http://localhost:5001")
        sys.exit(1)

if __name__ == "__main__":
    main()