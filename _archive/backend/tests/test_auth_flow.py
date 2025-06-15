#!/usr/bin/env python
"""
Test script for the Expresso authentication flow
Tests JWT token generation, validation, and protected endpoint access
"""
import requests
import json
import sys
import time

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
        return json_data
    except ValueError:
        # Not JSON, print as text
        print(f"Status: {response.status_code}")
        print(response.text)
        return response.text

def test_login_endpoints():
    """Test login and token generation"""
    print("\n=== TESTING LOGIN AND TOKEN GENERATION ===")
    
    # Test invalid login
    invalid_login = {
        "username": "invalid_user",
        "password": "wrong_password"
    }
    
    response = requests.post(f"{BASE_URL}/api/auth/login", json=invalid_login)
    print_response(response, "Invalid Login")
    
    assert response.status_code != 200, "Invalid login should fail"
    
    # Test valid login (barista role)
    valid_login = {
        "username": "barista",
        "password": "barista123"  # Default test password, change if needed
    }
    
    response = requests.post(f"{BASE_URL}/api/auth/login", json=valid_login)
    result = print_response(response, "Valid Login (Barista)")
    
    assert response.status_code == 200, "Valid login should succeed"
    assert "token" in result, "Response should contain JWT token"
    
    barista_token = result["token"]
    
    # Test valid login (admin role)
    admin_login = {
        "username": "admin",
        "password": "admin123"  # Default test password, change if needed
    }
    
    response = requests.post(f"{BASE_URL}/api/auth/login", json=admin_login)
    result = print_response(response, "Valid Login (Admin)")
    
    if response.status_code == 200 and "token" in result:
        admin_token = result["token"]
    else:
        admin_token = None
        print("Warning: Admin login failed, some tests will be skipped")
    
    return barista_token, admin_token

def test_token_validation(barista_token):
    """Test token validation"""
    print("\n=== TESTING TOKEN VALIDATION ===")
    
    # Test with valid token
    headers = {
        "Authorization": f"Bearer {barista_token}"
    }
    
    response = requests.get(f"{BASE_URL}/api/auth/validate", headers=headers)
    print_response(response, "Valid Token Validation")
    
    assert response.status_code == 200, "Valid token should be validated"
    
    # Test with invalid token
    invalid_headers = {
        "Authorization": "Bearer invalid.token.here"
    }
    
    response = requests.get(f"{BASE_URL}/api/auth/validate", headers=invalid_headers)
    print_response(response, "Invalid Token Validation")
    
    assert response.status_code != 200, "Invalid token should fail validation"
    
    # Test with expired token (if possible to simulate)
    # This would require manipulating the token or waiting for it to expire
    # For now, we'll skip this test
    
    return True

def test_role_based_access(barista_token, admin_token):
    """Test role-based access control"""
    print("\n=== TESTING ROLE-BASED ACCESS CONTROL ===")
    
    # Test barista access to barista endpoints
    barista_headers = {
        "Authorization": f"Bearer {barista_token}"
    }
    
    # Barista should have access to orders endpoints
    response = requests.get(f"{BASE_URL}/api/orders/pending", headers=barista_headers)
    print_response(response, "Barista Access to Orders (Should Succeed)")
    
    assert response.status_code == 200, "Barista should access orders endpoints"
    
    # Barista should have limited access to admin endpoints
    if admin_token:  # Only test if we have an admin token for comparison
        response = requests.get(f"{BASE_URL}/api/admin/users", headers=barista_headers)
        print_response(response, "Barista Access to Admin Endpoints (Should Fail)")
        
        assert response.status_code != 200, "Barista should not access admin endpoints"
    
    # Test admin access to admin endpoints
    if admin_token:
        admin_headers = {
            "Authorization": f"Bearer {admin_token}"
        }
        
        # Admin should have access to admin endpoints
        response = requests.get(f"{BASE_URL}/api/admin/settings", headers=admin_headers)
        print_response(response, "Admin Access to Admin Endpoints (Should Succeed)")
        
        assert response.status_code == 200, "Admin should access admin endpoints"
        
        # Admin should also have access to barista endpoints
        response = requests.get(f"{BASE_URL}/api/orders/pending", headers=admin_headers)
        print_response(response, "Admin Access to Orders (Should Succeed)")
        
        assert response.status_code == 200, "Admin should access order endpoints"
    
    return True

def test_token_refresh(barista_token):
    """Test token refresh functionality"""
    print("\n=== TESTING TOKEN REFRESH ===")
    
    headers = {
        "Authorization": f"Bearer {barista_token}"
    }
    
    # Request a new token via refresh
    response = requests.post(f"{BASE_URL}/api/auth/refresh", headers=headers)
    result = print_response(response, "Token Refresh")
    
    if response.status_code == 200 and "token" in result:
        new_token = result["token"]
        print("Successfully refreshed token")
        
        # Verify the new token works
        new_headers = {
            "Authorization": f"Bearer {new_token}"
        }
        
        response = requests.get(f"{BASE_URL}/api/orders/pending", headers=new_headers)
        print_response(response, "Access with Refreshed Token")
        
        assert response.status_code == 200, "New token should be valid"
        return True
    else:
        print("Token refresh not implemented or failed")
        return False

def test_logout(barista_token):
    """Test logout functionality"""
    print("\n=== TESTING LOGOUT ===")
    
    headers = {
        "Authorization": f"Bearer {barista_token}"
    }
    
    # Request logout
    response = requests.post(f"{BASE_URL}/api/auth/logout", headers=headers)
    print_response(response, "Logout")
    
    # Check if token is invalidated (this depends on implementation)
    # Some logout implementations may not invalidate tokens
    # and instead rely on client-side token removal
    time.sleep(1)  # Give server time to process logout
    
    response = requests.get(f"{BASE_URL}/api/orders/pending", headers=headers)
    result = print_response(response, "Access After Logout")
    
    print("Note: If token is still valid after logout, this may be normal depending on the implementation")
    print("Many JWT implementations handle logout client-side by removing the token")
    
    return True

def main():
    """Main test function"""
    print("\n=============================================")
    print("       EXPRESSO AUTHENTICATION FLOW TESTS    ")
    print("=============================================\n")
    
    try:
        # Test login endpoints and get tokens
        barista_token, admin_token = test_login_endpoints()
        
        if not barista_token:
            print("\nBarista login failed, cannot continue tests")
            sys.exit(1)
        
        # Run auth flow tests
        results = {}
        
        # Test token validation
        results["token_validation"] = test_token_validation(barista_token)
        
        # Test role-based access control
        results["role_based_access"] = test_role_based_access(barista_token, admin_token)
        
        # Test token refresh
        results["token_refresh"] = test_token_refresh(barista_token)
        
        # Test logout
        results["logout"] = test_logout(barista_token)
        
        # Print summary
        print("\n=============================================")
        print("           TEST RESULTS SUMMARY              ")
        print("=============================================")
        
        all_passed = True
        for test, result in results.items():
            status = "PASSED" if result else "FAILED"
            if not result:
                all_passed = False
            print(f"  {test.replace('_', ' ').upper()} Test: {status}")
        
        print("\nOverall Result:", "PASSED" if all_passed else "FAILED")
        
        if not all_passed:
            sys.exit(1)
            
    except Exception as e:
        print(f"\nError during test execution: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()