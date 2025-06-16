#!/bin/bash

echo "Expresso Authentication Fix Script"
echo "=================================="
echo ""

# Step 1: Check if backend is running
echo "1. Checking backend server..."
if curl -s http://localhost:5001/api/health > /dev/null; then
    echo "   ✅ Backend is running"
else
    echo "   ❌ Backend is not running! Please start it with: python3 run_server.py"
    exit 1
fi

# Step 2: Reset admin user
echo ""
echo "2. Resetting admin user..."
python3 create_admin.py "postgres://stevewf:@localhost:5432/expresso" coffeecue admin@coffeecue.com adminpassword --force

# Step 3: Test login
echo ""
echo "3. Testing login..."
TOKEN=$(curl -s -X POST http://localhost:5001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"coffeecue","password":"adminpassword"}' | \
  python3 -c "import sys, json; print(json.load(sys.stdin).get('token', ''))")

if [ -z "$TOKEN" ]; then
    echo "   ❌ Login failed!"
    exit 1
else
    echo "   ✅ Login successful!"
fi

echo ""
echo "=================================="
echo "✅ Authentication has been fixed!"
echo ""
echo "To use the system:"
echo "1. Go to http://localhost:3000"
echo "2. Login with:"
echo "   Username: coffeecue"
echo "   Password: adminpassword"
echo ""
echo "If you're already logged in but seeing 'offline mode':"
echo "1. Open browser console (F12)"
echo "2. Run: localStorage.clear()"
echo "3. Refresh the page and login again"
echo ""