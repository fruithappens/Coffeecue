#!/bin/bash

# Coffee Cue Test Framework Launcher

echo "☕ Coffee Cue Comprehensive Test Framework"
echo "========================================"
echo ""

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
    echo ""
fi

# Check if backend is running
if ! curl -s http://localhost:5001/api/health > /dev/null 2>&1; then
    echo "⚠️  Warning: Backend server not detected on port 5001"
    echo "Please ensure the Coffee Cue backend is running"
    echo ""
fi

# Check if frontend is running
if ! curl -s http://localhost:3000 > /dev/null 2>&1; then
    echo "⚠️  Warning: Frontend not detected on port 3000"
    echo "Please ensure the Coffee Cue frontend is running"
    echo ""
fi

# Create reports directory
mkdir -p reports/screenshots

echo "Starting test framework..."
echo "Monitor progress at: http://localhost:8080"
echo ""

# Run the test framework
node src/index.js $@