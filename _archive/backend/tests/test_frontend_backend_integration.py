#!/usr/bin/env python
"""
Test script for the Expresso frontend-backend integration
Tests all API endpoints and data flows required by the frontend
"""
import requests
import json
import sys
import time
import random
import string

BASE_URL = "http://localhost:5001"
JWT_TOKEN = None  # Will store auth token once obtained

def print_response(response, label=None):
    """Print response in a readable format"""
    if label:
        print(f"\n=== {label} ===")
    
    try:
        # Try to parse as JSON
        json_data = response.json()
        print(f"Status: {response.status_code}")
        print(json.dumps(json_data, indent=2))
        return json_data
    except ValueError:
        # Not JSON, print as text
        print(f"Status: {response.status_code}")
        print(response.text)
        return response.text

def authenticate():
    """Authenticate with the API to get a JWT token"""
    global JWT_TOKEN
    
    print("\n=== Authenticating with the API ===")
    auth_data = {
        "username": "barista",
        "password": "barista123"  # Default test password, change if needed
    }
    
    try:
        response = requests.post(f"{BASE_URL}/api/auth/login", json=auth_data)
        result = print_response(response, "Authentication")
        
        if response.status_code == 200 and 'token' in result:
            JWT_TOKEN = result['token']
            print(f"Successfully authenticated: Token received")
            return True
        else:
            print("Authentication failed")
            return False
    except requests.RequestException as e:
        print(f"Error during authentication: {e}")
        return False

def get_headers():
    """Get headers for authenticated requests"""
    headers = {'Content-Type': 'application/json'}
    if JWT_TOKEN:
        headers['Authorization'] = f'Bearer {JWT_TOKEN}'
    return headers

def random_string(length=6):
    """Generate a random string for test data"""
    return ''.join(random.choices(string.ascii_letters + string.digits, k=length))

def test_order_lifecycle():
    """Test the complete order lifecycle from creation to pickup"""
    print("\n=== TESTING COMPLETE ORDER LIFECYCLE ===")
    
    # 1. Create a test order
    customer_name = f"Test Customer {random_string()}"
    test_order = {
        "name": customer_name,
        "type": "Cappuccino",
        "milk": "Oat milk",
        "size": "Regular",
        "sugar": "1 sugar",
        "notes": "Testing complete order flow"
    }
    
    try:
        # Create the order
        response = requests.post(
            f"{BASE_URL}/api/debug/create-test-order", 
            json=test_order,
            headers=get_headers()
        )
        result = print_response(response, "Create Order")
        
        if response.status_code != 200 or "order_number" not in result:
            print("Failed to create test order")
            return False
        
        order_id = result["order_number"]
        print(f"Created order with ID: {order_id}")
        
        # 2. Check pending orders - verify our order is there
        time.sleep(1)  # Small delay to ensure order is processed
        response = requests.get(
            f"{BASE_URL}/api/orders/pending",
            headers=get_headers()
        )
        result = print_response(response, "Pending Orders")
        
        # Verify our order is in the pending list
        found = False
        if response.status_code == 200 and "orders" in result:
            for order in result["orders"]:
                if "order_number" in order and order["order_number"] == order_id:
                    found = True
                    break
        
        if not found:
            print(f"Order {order_id} not found in pending orders!")
            return False
        
        print(f"Order {order_id} found in pending orders - success!")
        
        # 3. Start the order
        response = requests.post(
            f"{BASE_URL}/api/orders/{order_id}/start",
            headers=get_headers()
        )
        print_response(response, "Start Order")
        
        if response.status_code != 200:
            print(f"Failed to start order {order_id}")
            return False
        
        # 4. Check in-progress orders
        time.sleep(1)
        response = requests.get(
            f"{BASE_URL}/api/orders/in-progress",
            headers=get_headers()
        )
        result = print_response(response, "In-Progress Orders")
        
        # Verify our order is in the in-progress list
        found = False
        if response.status_code == 200 and "orders" in result:
            for order in result["orders"]:
                if "order_number" in order and order["order_number"] == order_id:
                    found = True
                    break
        
        if not found:
            print(f"Order {order_id} not found in in-progress orders!")
            return False
        
        print(f"Order {order_id} found in in-progress orders - success!")
        
        # 5. Complete the order
        response = requests.post(
            f"{BASE_URL}/api/orders/{order_id}/complete",
            headers=get_headers()
        )
        print_response(response, "Complete Order")
        
        if response.status_code != 200:
            print(f"Failed to complete order {order_id}")
            return False
        
        # 6. Check completed orders
        time.sleep(1)
        response = requests.get(
            f"{BASE_URL}/api/orders/completed",
            headers=get_headers()
        )
        result = print_response(response, "Completed Orders")
        
        # Verify our order is in the completed list
        found = False
        if response.status_code == 200 and "orders" in result:
            for order in result["orders"]:
                if "order_number" in order and order["order_number"] == order_id:
                    found = True
                    break
        
        if not found:
            print(f"Order {order_id} not found in completed orders!")
            return False
        
        print(f"Order {order_id} found in completed orders - success!")
        
        # 7. Mark order as picked up
        response = requests.post(
            f"{BASE_URL}/api/orders/{order_id}/pickup",
            headers=get_headers()
        )
        print_response(response, "Pickup Order")
        
        if response.status_code != 200:
            print(f"Failed to mark order {order_id} as picked up")
            return False
        
        # 8. Check order history (should include our order)
        time.sleep(1)
        response = requests.get(
            f"{BASE_URL}/api/orders/history?limit=20",
            headers=get_headers()
        )
        result = print_response(response, "Order History")
        
        # Verify our order is in history
        found = False
        if response.status_code == 200 and "orders" in result:
            for order in result["orders"]:
                if "order_number" in order and order["order_number"] == order_id:
                    found = True
                    break
        
        if not found:
            print(f"Order {order_id} not found in order history!")
            return False
        
        print(f"Order {order_id} found in order history - success!")
        
        # 9. Get specific order details
        response = requests.get(
            f"{BASE_URL}/api/orders/{order_id}",
            headers=get_headers()
        )
        result = print_response(response, f"Order {order_id} Details")
        
        if response.status_code != 200:
            print(f"Failed to get details for order {order_id}")
            return False
        
        # Verify order details
        if result.get("name") != customer_name:
            print(f"Order details mismatch: Expected customer {customer_name}")
            return False
        
        print("Complete order lifecycle test PASSED!")
        return True
        
    except requests.RequestException as e:
        print(f"Error during order lifecycle test: {e}")
        return False

def test_batch_processing():
    """Test batch processing of orders"""
    print("\n=== TESTING BATCH ORDER PROCESSING ===")
    
    # Create 3 test orders for batch processing
    order_ids = []
    
    try:
        for i in range(3):
            customer_name = f"Batch Customer {i+1}"
            test_order = {
                "name": customer_name,
                "type": "Cappuccino" if i % 2 == 0 else "Flat White",
                "milk": "Full cream" if i % 2 == 0 else "Soy milk",
                "size": "Regular",
                "sugar": f"{i} sugar",
                "notes": f"Batch test order {i+1}"
            }
            
            response = requests.post(
                f"{BASE_URL}/api/debug/create-test-order", 
                json=test_order,
                headers=get_headers()
            )
            
            if response.status_code == 200 and "order_number" in response.json():
                order_id = response.json()["order_number"]
                order_ids.append(order_id)
                print(f"Created batch test order {i+1} with ID: {order_id}")
            else:
                print(f"Failed to create batch test order {i+1}")
        
        if len(order_ids) < 2:
            print("Not enough orders created for batch test")
            return False
            
        # Perform batch start
        batch_data = {
            "order_ids": order_ids,
            "action": "start"
        }
        
        response = requests.post(
            f"{BASE_URL}/api/orders/batch",
            json=batch_data,
            headers=get_headers()
        )
        print_response(response, "Batch Order Start")
        
        if response.status_code != 200:
            print("Batch start operation failed")
            return False
            
        # Check if orders are in progress
        time.sleep(1)
        response = requests.get(
            f"{BASE_URL}/api/orders/in-progress",
            headers=get_headers()
        )
        result = print_response(response, "In-Progress Orders After Batch Start")
        
        # Verify our batch orders are in the in-progress list
        in_progress_count = 0
        if response.status_code == 200 and "orders" in result:
            for batch_order_id in order_ids:
                for order in result["orders"]:
                    if "order_number" in order and order["order_number"] == batch_order_id:
                        in_progress_count += 1
                        break
        
        if in_progress_count != len(order_ids):
            print(f"Not all batch orders are in-progress! Found {in_progress_count} of {len(order_ids)}")
            return False
            
        print(f"All {len(order_ids)} batch orders found in in-progress - success!")
        
        # Perform batch complete
        batch_data = {
            "order_ids": order_ids,
            "action": "complete"
        }
        
        response = requests.post(
            f"{BASE_URL}/api/orders/batch",
            json=batch_data,
            headers=get_headers()
        )
        print_response(response, "Batch Order Complete")
        
        if response.status_code != 200:
            print("Batch complete operation failed")
            return False
            
        # Check if orders are completed
        time.sleep(1)
        response = requests.get(
            f"{BASE_URL}/api/orders/completed",
            headers=get_headers()
        )
        result = print_response(response, "Completed Orders After Batch Complete")
        
        # Verify our batch orders are in the completed list
        completed_count = 0
        if response.status_code == 200 and "orders" in result:
            for batch_order_id in order_ids:
                for order in result["orders"]:
                    if "order_number" in order and order["order_number"] == batch_order_id:
                        completed_count += 1
                        break
        
        if completed_count != len(order_ids):
            print(f"Not all batch orders are completed! Found {completed_count} of {len(order_ids)}")
            return False
            
        print(f"All {len(order_ids)} batch orders found in completed - success!")
        
        print("Batch order processing test PASSED!")
        return True
        
    except requests.RequestException as e:
        print(f"Error during batch processing test: {e}")
        return False

def test_station_management():
    """Test station management endpoints"""
    print("\n=== TESTING STATION MANAGEMENT ===")
    
    try:
        # 1. Get all stations
        response = requests.get(
            f"{BASE_URL}/api/stations",
            headers=get_headers()
        )
        result = print_response(response, "Get All Stations")
        
        if response.status_code != 200 or "stations" not in result:
            print("Failed to get stations")
            return False
            
        stations = result["stations"]
        if len(stations) == 0:
            print("No stations found, skipping station tests")
            return True
            
        # Get the first station for testing
        station_id = stations[0].get("id", "1")
        
        # 2. Get station details
        response = requests.get(
            f"{BASE_URL}/api/stations/{station_id}",
            headers=get_headers()
        )
        print_response(response, f"Station {station_id} Details")
        
        # 3. Update station status
        status_data = {
            "status": "active"
        }
        
        response = requests.put(
            f"{BASE_URL}/api/stations/{station_id}/status",
            json=status_data,
            headers=get_headers()
        )
        print_response(response, f"Update Station {station_id} Status")
        
        # 4. Assign barista to station
        barista_data = {
            "barista_id": "test_barista"
        }
        
        response = requests.put(
            f"{BASE_URL}/api/stations/{station_id}/assign",
            json=barista_data,
            headers=get_headers()
        )
        print_response(response, f"Assign Barista to Station {station_id}")
        
        print("Station management test PASSED!")
        return True
        
    except requests.RequestException as e:
        print(f"Error during station management test: {e}")
        return False

def test_inventory_endpoints():
    """Test inventory management endpoints"""
    print("\n=== TESTING INVENTORY MANAGEMENT ===")
    
    try:
        # 1. Get inventory items
        response = requests.get(
            f"{BASE_URL}/api/inventory",
            headers=get_headers()
        )
        result = print_response(response, "Get Inventory Items")
        
        if response.status_code != 200 or "items" not in result:
            print("Failed to get inventory items")
            return False
            
        items = result["items"]
        if len(items) == 0:
            print("No inventory items found, skipping inventory tests")
            return True
            
        # Get the first item for testing
        item_id = items[0].get("id", "1")
        
        # 2. Update inventory item level
        update_data = {
            "quantity": 50,
            "notes": "Updated via test script"
        }
        
        response = requests.put(
            f"{BASE_URL}/api/inventory/{item_id}",
            json=update_data,
            headers=get_headers()
        )
        print_response(response, f"Update Inventory Item {item_id}")
        
        # 3. Report low stock
        low_stock_data = {
            "urgency": "normal",
            "notes": "Running low on this item"
        }
        
        response = requests.post(
            f"{BASE_URL}/api/inventory/{item_id}/report-low",
            json=low_stock_data,
            headers=get_headers()
        )
        print_response(response, f"Report Low Stock for Item {item_id}")
        
        # 4. Get inventory usage
        response = requests.get(
            f"{BASE_URL}/api/inventory/usage?days=7",
            headers=get_headers()
        )
        print_response(response, "Get Inventory Usage (7 days)")
        
        print("Inventory management test PASSED!")
        return True
        
    except requests.RequestException as e:
        print(f"Error during inventory test: {e}")
        return False

def test_settings_api():
    """Test settings API endpoints"""
    print("\n=== TESTING SETTINGS API ===")
    
    try:
        # 1. Get all settings
        response = requests.get(
            f"{BASE_URL}/api/settings",
            headers=get_headers()
        )
        result = print_response(response, "Get All Settings")
        
        if response.status_code != 200 or "settings" not in result:
            print("Failed to get settings")
            return False
        
        # 2. Get specific setting group
        response = requests.get(
            f"{BASE_URL}/api/settings/display",
            headers=get_headers()
        )
        print_response(response, "Get Display Settings")
        
        # 3. Update a setting
        # Get a setting key to update
        setting_key = None
        if "settings" in result and len(result["settings"]) > 0:
            for setting in result["settings"]:
                if "key" in setting:
                    setting_key = setting["key"]
                    break
        
        if setting_key:
            update_data = {
                "value": f"Updated value {random_string()}",
                "notes": "Updated via test script"
            }
            
            response = requests.put(
                f"{BASE_URL}/api/settings/{setting_key}",
                json=update_data,
                headers=get_headers()
            )
            print_response(response, f"Update Setting {setting_key}")
        
        print("Settings API test PASSED!")
        return True
        
    except requests.RequestException as e:
        print(f"Error during settings API test: {e}")
        return False

def main():
    """Main test function"""
    print("\n=============================================")
    print("EXPRESSO FRONTEND-BACKEND INTEGRATION TESTS")
    print("=============================================\n")
    
    # First authenticate to get JWT token
    if not authenticate():
        print("\nAuthentication failed, cannot continue with tests")
        sys.exit(1)
    
    # Run tests based on command line arguments
    try:
        tests_to_run = []
        
        if len(sys.argv) > 1:
            # Parse command line arguments
            if "--all" in sys.argv:
                tests_to_run = ["order", "batch", "station", "inventory", "settings"]
            else:
                if "--order" in sys.argv:
                    tests_to_run.append("order")
                if "--batch" in sys.argv:
                    tests_to_run.append("batch")
                if "--station" in sys.argv:
                    tests_to_run.append("station")
                if "--inventory" in sys.argv:
                    tests_to_run.append("inventory")
                if "--settings" in sys.argv:
                    tests_to_run.append("settings")
        else:
            # Default: run all tests
            tests_to_run = ["order", "batch", "station", "inventory", "settings"]
        
        # Execute selected tests
        results = {}
        
        if "order" in tests_to_run:
            results["order"] = test_order_lifecycle()
            
        if "batch" in tests_to_run:
            results["batch"] = test_batch_processing()
            
        if "station" in tests_to_run:
            results["station"] = test_station_management()
            
        if "inventory" in tests_to_run:
            results["inventory"] = test_inventory_endpoints()
            
        if "settings" in tests_to_run:
            results["settings"] = test_settings_api()
        
        # Print summary
        print("\n=============================================")
        print("           TEST RESULTS SUMMARY              ")
        print("=============================================")
        
        all_passed = True
        for test, result in results.items():
            status = "PASSED" if result else "FAILED"
            if not result:
                all_passed = False
            print(f"  {test.upper()} Test: {status}")
        
        print("\nOverall Result:", "PASSED" if all_passed else "FAILED")
        
        if not all_passed:
            sys.exit(1)
            
    except Exception as e:
        print(f"\nError during test execution: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()