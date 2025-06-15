#!/bin/bash

echo "☕ Coffee Cue Simple Test Suite"
echo "====================================="

# Create test results directory
mkdir -p test-results/screenshots

# Check if backend is running
echo "🔍 Checking backend status..."
if curl -s http://localhost:5001/api/health > /dev/null 2>&1 || curl -s http://localhost:5001/api/orders > /dev/null 2>&1; then
    echo "✅ Backend is running"
else
    echo "❌ Backend not detected on port 5001"
    echo "   Please ensure backend is running: python3 run_server.py"
    exit 1
fi

# Check if frontend is running
echo "🔍 Checking frontend status..."
if curl -s http://localhost:3000 > /dev/null 2>&1; then
    echo "✅ Frontend is running"
else
    echo "❌ Frontend not detected on port 3000"
    echo "   Please ensure frontend is running: cd 'Barista Front End' && npm start"
    exit 1
fi

echo ""
echo "🧪 Running API Tests..."
echo "========================"
node api-test.js

echo ""
echo "📋 Manual Testing"
echo "================="
echo "Open the following in your browser for manual UI testing:"
echo "👉 file://$PWD/manual-test-checklist.html"
echo ""

# Open test reports
if [ -f "api-test-report.html" ]; then
    echo "📊 Opening API test report..."
    open api-test-report.html 2>/dev/null || echo "   View at: file://$PWD/api-test-report.html"
fi

if [ -f "manual-test-checklist.html" ]; then
    echo "📋 Opening manual test checklist..."
    open manual-test-checklist.html 2>/dev/null || echo "   View at: file://$PWD/manual-test-checklist.html"
fi

echo ""
echo "✅ Testing ready! Use the manual checklist to verify UI functionality."