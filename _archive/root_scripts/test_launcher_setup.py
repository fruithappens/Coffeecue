#!/usr/bin/env python3
"""
Test script to verify the launcher setup is working correctly
"""
import sys
import requests
import psycopg2
from utils.database import get_db_connection, close_connection

def test_database():
    """Test database connection"""
    print("🔍 Testing database connection...")
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM users")
        count = cursor.fetchone()[0]
        cursor.close()
        close_connection(conn)
        print(f"✅ Database connected - {count} users found")
        return True
    except Exception as e:
        print(f"❌ Database error: {str(e)}")
        return False

def test_backend():
    """Test backend API"""
    print("\n🔍 Testing backend API...")
    try:
        response = requests.get("http://localhost:5001/api/auth/status", timeout=5)
        # 401 is expected for unauthenticated requests - it means the API is working
        if response.status_code in [200, 401]:
            print("✅ Backend API is running on port 5001")
            return True
        else:
            print(f"❌ Backend returned unexpected status {response.status_code}")
            return False
    except Exception as e:
        print(f"❌ Backend not accessible: {str(e)}")
        return False

def test_frontend():
    """Test frontend"""
    print("\n🔍 Testing frontend...")
    try:
        response = requests.get("http://localhost:3000", timeout=5)
        if response.status_code == 200:
            print("✅ Frontend is running on port 3000")
            return True
        else:
            print(f"❌ Frontend returned status {response.status_code}")
            return False
    except Exception as e:
        print(f"❌ Frontend not accessible: {str(e)}")
        return False

def test_login():
    """Test login functionality"""
    print("\n🔍 Testing login...")
    
    test_users = [
        ("coffeecue", "adminpassword", "admin"),
        ("barista", "barista123", "barista"),
        ("organizer", "organizer123", "organizer")
    ]
    
    all_passed = True
    for username, password, expected_role in test_users:
        try:
            response = requests.post(
                "http://localhost:5001/api/auth/login",
                json={"username": username, "password": password},
                headers={"Content-Type": "application/json"}
            )
            
            if response.status_code == 200:
                data = response.json()
                if data.get("status") == "success":
                    user_role = data.get("user", {}).get("role", "")
                    if user_role == expected_role:
                        print(f"✅ {username} login successful (role: {expected_role})")
                    else:
                        print(f"⚠️  {username} login successful but wrong role: {user_role}")
                        all_passed = False
                else:
                    print(f"❌ {username} login failed: {data.get('message', 'Unknown error')}")
                    all_passed = False
            else:
                print(f"❌ {username} login failed with status {response.status_code}")
                all_passed = False
                
        except Exception as e:
            print(f"❌ Error testing {username} login: {str(e)}")
            all_passed = False
    
    return all_passed

def main():
    print("=" * 60)
    print("☕ COFFEE CUE LAUNCHER SETUP TEST")
    print("=" * 60)
    
    # Run tests
    db_ok = test_database()
    backend_ok = test_backend()
    frontend_ok = test_frontend()
    login_ok = test_login() if backend_ok else False
    
    # Summary
    print("\n" + "=" * 60)
    print("📊 TEST SUMMARY")
    print("=" * 60)
    
    total_tests = 4
    passed_tests = sum([db_ok, backend_ok, frontend_ok, login_ok])
    
    print(f"\n✅ Passed: {passed_tests}/{total_tests}")
    
    if passed_tests == total_tests:
        print("\n🎉 All tests passed! The Coffee Cue system is ready to use.")
        print("\n📱 Access the app at: http://localhost:3000")
        return 0
    else:
        print("\n⚠️  Some tests failed. Please check the errors above.")
        print("\nTry running the launcher in 'Complete Setup' mode.")
        return 1

if __name__ == "__main__":
    sys.exit(main())