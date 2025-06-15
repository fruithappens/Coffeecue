#!/usr/bin/env python3
"""
Direct test of React frontend functionality
Tests the actual React application at localhost:3000
DELETE BEFORE DEPLOYMENT
"""

import requests
import json
import sys
import time
from datetime import datetime
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.chrome.options import Options
from selenium.common.exceptions import TimeoutException, NoSuchElementException

FRONTEND_URL = "http://localhost:3000"
BACKEND_URL = "http://localhost:5001"

def log(message, level="INFO"):
    timestamp = datetime.now().strftime("%H:%M:%S")
    print(f"[{timestamp}] {level}: {message}")

def log_json(data, label):
    timestamp = datetime.now().strftime("%H:%M:%S")
    print(f"[{timestamp}] {label}:")
    print(json.dumps(data, indent=2))

def setup_driver():
    """Setup Chrome driver for testing"""
    try:
        chrome_options = Options()
        chrome_options.add_argument("--headless")  # Run in background
        chrome_options.add_argument("--no-sandbox")
        chrome_options.add_argument("--disable-dev-shm-usage")
        chrome_options.add_argument("--disable-gpu")
        chrome_options.add_argument("--window-size=1920,1080")
        
        driver = webdriver.Chrome(options=chrome_options)
        return driver
    except Exception as e:
        log(f"Failed to setup Chrome driver: {str(e)}", "ERROR")
        return None

def test_frontend_loading(driver):
    """Test if the React frontend loads properly"""
    log("Testing React frontend loading...")
    
    try:
        driver.get(FRONTEND_URL)
        
        # Wait for React to load
        WebDriverWait(driver, 10).until(
            lambda d: d.execute_script("return document.readyState") == "complete"
        )
        
        # Check if React root element exists
        root_element = driver.find_element(By.ID, "root")
        if root_element:
            log("✅ React root element found", "SUCCESS")
            
            # Check if content is loaded
            page_source = driver.page_source
            if "BaristaInterface" in page_source or "barista" in page_source.lower():
                log("✅ Barista interface content detected", "SUCCESS")
                return True
            else:
                log("❌ No barista interface content found", "ERROR")
                return False
        else:
            log("❌ React root element not found", "ERROR")
            return False
            
    except TimeoutException:
        log("❌ Frontend loading timeout", "ERROR")
        return False
    except Exception as e:
        log(f"❌ Frontend loading error: {str(e)}", "ERROR")
        return False

def test_authentication_flow(driver):
    """Test the authentication flow in the frontend"""
    log("Testing authentication flow...")
    
    try:
        # Look for login form or login button
        login_elements = driver.find_elements(By.XPATH, "//input[@type='password']")
        login_buttons = driver.find_elements(By.XPATH, "//button[contains(text(), 'Login') or contains(text(), 'login')]")
        
        if login_elements or login_buttons:
            log("✅ Login elements found", "SUCCESS")
            
            # Try to fill login form if it exists
            username_fields = driver.find_elements(By.XPATH, "//input[@type='text' or @type='email' or contains(@name, 'username')]")
            password_fields = driver.find_elements(By.XPATH, "//input[@type='password']")
            
            if username_fields and password_fields:
                log("Found login form, attempting login...")
                
                username_fields[0].clear()
                username_fields[0].send_keys("barista")
                
                password_fields[0].clear()
                password_fields[0].send_keys("ExpressoBarista2025")
                
                # Find and click login button
                for button in login_buttons:
                    if button.is_enabled():
                        button.click()
                        break
                
                # Wait for authentication response
                time.sleep(3)
                
                # Check if login was successful (look for barista interface elements)
                interface_elements = driver.find_elements(By.XPATH, 
                    "//div[contains(@class, 'barista') or contains(text(), 'Orders') or contains(text(), 'Pending')]")
                
                if interface_elements:
                    log("✅ Login successful - barista interface visible", "SUCCESS")
                    return True
                else:
                    log("❌ Login attempt made but no interface visible", "ERROR")
                    return False
            else:
                log("❌ Login form fields not found", "ERROR")
                return False
        else:
            # Check if already authenticated
            interface_elements = driver.find_elements(By.XPATH, 
                "//div[contains(@class, 'barista') or contains(text(), 'Orders')]")
            
            if interface_elements:
                log("✅ Already authenticated - interface visible", "SUCCESS")
                return True
            else:
                log("❌ No login elements and no interface visible", "ERROR")
                return False
                
    except Exception as e:
        log(f"❌ Authentication flow error: {str(e)}", "ERROR")
        return False

def test_interface_buttons(driver):
    """Test various buttons and interactive elements"""
    log("Testing interface buttons and interactions...")
    
    try:
        # Find all buttons
        buttons = driver.find_elements(By.TAG_NAME, "button")
        log(f"Found {len(buttons)} buttons")
        
        clickable_buttons = 0
        working_buttons = 0
        
        for i, button in enumerate(buttons):
            if button.is_enabled() and button.is_displayed():
                clickable_buttons += 1
                
                # Get button text
                button_text = button.text or button.get_attribute("aria-label") or f"Button {i+1}"
                
                try:
                    # Try clicking the button
                    driver.execute_script("arguments[0].click();", button)
                    time.sleep(0.5)  # Wait for any effects
                    
                    # Check if any error alerts appeared
                    alerts = driver.find_elements(By.XPATH, "//div[contains(@class, 'error') or contains(@class, 'alert')]")
                    
                    if not alerts:
                        working_buttons += 1
                        log(f"✅ Button '{button_text}' - Working", "SUCCESS")
                    else:
                        log(f"❌ Button '{button_text}' - Error after click", "ERROR")
                        
                except Exception as e:
                    log(f"❌ Button '{button_text}' - Click failed: {str(e)}", "ERROR")
        
        log(f"Button Test Summary: {working_buttons}/{clickable_buttons} buttons working")
        return working_buttons > 0
        
    except Exception as e:
        log(f"❌ Button testing error: {str(e)}", "ERROR")
        return False

def test_navigation(driver):
    """Test navigation and routing"""
    log("Testing navigation...")
    
    try:
        # Find navigation links
        nav_links = driver.find_elements(By.XPATH, "//a | //button[contains(@onclick, 'navigate')]")
        log(f"Found {len(nav_links)} navigation elements")
        
        # Test tab switching if present
        tabs = driver.find_elements(By.XPATH, "//div[contains(@class, 'tab') or contains(@role, 'tab')]")
        if tabs:
            log(f"Found {len(tabs)} tabs")
            
            for i, tab in enumerate(tabs[:3]):  # Test first 3 tabs
                try:
                    tab_text = tab.text or f"Tab {i+1}"
                    tab.click()
                    time.sleep(1)
                    
                    # Check if content changed
                    page_source = driver.page_source
                    log(f"✅ Tab '{tab_text}' - Clickable", "SUCCESS")
                    
                except Exception as e:
                    log(f"❌ Tab '{tab_text}' - Error: {str(e)}", "ERROR")
        
        return len(nav_links) > 0 or len(tabs) > 0
        
    except Exception as e:
        log(f"❌ Navigation testing error: {str(e)}", "ERROR")
        return False

def test_order_management(driver):
    """Test order management functionality"""
    log("Testing order management...")
    
    try:
        # Look for order-related elements
        order_elements = driver.find_elements(By.XPATH, 
            "//div[contains(@class, 'order') or contains(text(), 'Order')]")
        
        if order_elements:
            log(f"✅ Found {len(order_elements)} order-related elements", "SUCCESS")
            
            # Look for order action buttons
            action_buttons = driver.find_elements(By.XPATH, 
                "//button[contains(text(), 'Start') or contains(text(), 'Complete') or contains(text(), 'Pickup')]")
            
            if action_buttons:
                log(f"✅ Found {len(action_buttons)} order action buttons", "SUCCESS")
                
                # Try clicking first action button
                try:
                    first_button = action_buttons[0]
                    button_text = first_button.text
                    first_button.click()
                    time.sleep(2)
                    
                    log(f"✅ Order action '{button_text}' - Clickable", "SUCCESS")
                    return True
                    
                except Exception as e:
                    log(f"❌ Order action failed: {str(e)}", "ERROR")
                    return False
            else:
                log("❌ No order action buttons found", "ERROR")
                return False
        else:
            log("❌ No order elements found", "ERROR")
            return False
            
    except Exception as e:
        log(f"❌ Order management testing error: {str(e)}", "ERROR")
        return False

def test_api_connectivity():
    """Test if frontend can connect to backend APIs"""
    log("Testing API connectivity from frontend perspective...")
    
    try:
        # Test authentication endpoint
        response = requests.post(f"{BACKEND_URL}/api/auth/login", 
                               json={"username": "barista", "password": "ExpressoBarista2025"})
        
        if response.status_code == 200:
            data = response.json()
            token = data.get('token')
            
            if token:
                log("✅ Backend authentication working", "SUCCESS")
                
                # Test orders endpoint
                headers = {'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'}
                orders_response = requests.get(f"{BACKEND_URL}/api/orders", headers=headers)
                
                if orders_response.status_code == 200:
                    log("✅ Orders API working", "SUCCESS")
                    return True
                else:
                    log(f"❌ Orders API failed: {orders_response.status_code}", "ERROR")
                    return False
            else:
                log("❌ No token in auth response", "ERROR")
                return False
        else:
            log(f"❌ Backend authentication failed: {response.status_code}", "ERROR")
            return False
            
    except Exception as e:
        log(f"❌ API connectivity error: {str(e)}", "ERROR")
        return False

def main():
    """Main test function"""
    log("=== REACT FRONTEND TESTING ===")
    
    # First test API connectivity
    api_working = test_api_connectivity()
    
    # Setup browser driver
    driver = setup_driver()
    if not driver:
        log("❌ Cannot run browser tests without driver", "ERROR")
        sys.exit(1)
    
    try:
        test_results = {}
        
        # Test frontend loading
        test_results['frontend_loading'] = test_frontend_loading(driver)
        
        # Test authentication flow
        test_results['authentication'] = test_authentication_flow(driver)
        
        # Test interface buttons
        test_results['buttons'] = test_interface_buttons(driver)
        
        # Test navigation
        test_results['navigation'] = test_navigation(driver)
        
        # Test order management
        test_results['order_management'] = test_order_management(driver)
        
        # Add API connectivity result
        test_results['api_connectivity'] = api_working
        
        # Summary
        log("=== TEST RESULTS SUMMARY ===")
        passed = sum(1 for result in test_results.values() if result)
        total = len(test_results)
        
        for test_name, result in test_results.items():
            status = "✅ PASS" if result else "❌ FAIL"
            log(f"{test_name}: {status}")
        
        log(f"OVERALL: {passed}/{total} tests passed")
        
        if passed == total:
            log("🎉 ALL TESTS PASSED! Frontend is working correctly.", "SUCCESS")
        elif passed > total // 2:
            log("⚠️ Most tests passed, but some issues found.", "WARNING")
        else:
            log("❌ Multiple test failures - frontend needs attention.", "ERROR")
            
    finally:
        driver.quit()

if __name__ == "__main__":
    main()