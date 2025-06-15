#!/bin/bash

echo "☕ Coffee Cue Comprehensive Test Suite"
echo "====================================="

# Create test results directory
mkdir -p ../test-results/screenshots

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing test framework dependencies..."
    npm install
fi

# Check if backend is running
echo "🔍 Checking backend status..."
if ! curl -s http://localhost:5001/api/health > /dev/null; then
    echo "⚠️  Backend not running. Please start it with: python run_server.py"
    exit 1
fi

# Check if frontend is running
echo "🔍 Checking frontend status..."
if ! curl -s http://localhost:3000 > /dev/null; then
    echo "⚠️  Frontend not running. Please start it with: cd 'Barista Front End' && npm start"
    exit 1
fi

# Run the full test suite
echo "🚀 Starting comprehensive test suite..."
node orchestrator.js

# Generate summary after tests
echo "📊 Generating test summary..."
node claude-summary.js

echo "✅ Testing complete! Check ./test-results/ for reports"