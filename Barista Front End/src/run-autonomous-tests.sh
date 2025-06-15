#!/bin/bash

# Coffee Cue Autonomous Test System Runner
# This script sets up and runs the autonomous testing system

echo "☕ Coffee Cue Autonomous Test System"
echo "===================================="
echo ""

# Check if node is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js first."
    exit 1
fi

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed. Please install npm first."
    exit 1
fi

# Navigate to the autonomous test directory
cd "$(dirname "$0")"

# Install dependencies if needed
if [ ! -d "node_modules/puppeteer" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

# Create necessary directories
mkdir -p test-logs
mkdir -p test-screenshots

# Check if frontend is running
echo "🔍 Checking if frontend is running..."
if ! curl -s http://localhost:3000 > /dev/null; then
    echo "⚠️  Frontend not detected at http://localhost:3000"
    echo "Would you like to start it? (y/n)"
    read -r response
    if [[ "$response" =~ ^[Yy]$ ]]; then
        echo "Starting frontend in background..."
        cd .. && npm start &
        FRONTEND_PID=$!
        echo "Waiting for frontend to start..."
        sleep 10
    fi
fi

# Check if backend is running
echo "🔍 Checking if backend is running..."
if ! curl -s http://localhost:5001/api/health > /dev/null; then
    echo "⚠️  Backend not detected at http://localhost:5001"
    echo "Tests may fail for API-dependent features"
fi

# Parse command line arguments
HEADLESS=""
RETRIES="--retries=5"
URL="--url=http://localhost:3000"

for arg in "$@"; do
    case $arg in
        --headless)
            HEADLESS="--headless"
            ;;
        --retries=*)
            RETRIES="$arg"
            ;;
        --url=*)
            URL="$arg"
            ;;
        --help)
            echo "Usage: $0 [options]"
            echo ""
            echo "Options:"
            echo "  --headless        Run tests in headless mode (no browser window)"
            echo "  --retries=N       Number of retry attempts (default: 5)"
            echo "  --url=URL         Frontend URL (default: http://localhost:3000)"
            echo "  --help            Show this help message"
            exit 0
            ;;
    esac
done

# Run the autonomous test system
echo ""
echo "🚀 Starting autonomous test system..."
echo "Configuration:"
echo "  - Mode: ${HEADLESS:-GUI}"
echo "  - Max retries: ${RETRIES#--retries=}"
echo "  - URL: ${URL#--url=}"
echo ""

node autonomous-test-system.js $HEADLESS $RETRIES $URL

TEST_EXIT_CODE=$?

# Clean up
if [ ! -z "$FRONTEND_PID" ]; then
    echo ""
    echo "Stopping frontend..."
    kill $FRONTEND_PID 2>/dev/null
fi

# Display results
echo ""
if [ $TEST_EXIT_CODE -eq 0 ]; then
    echo "✅ Autonomous test system completed successfully!"
    echo ""
    echo "📊 Reports available in:"
    echo "  - test-logs/report-*.html"
    echo "  - test-logs/summary-*.json"
    echo "  - test-logs/session-*.log"
else
    echo "❌ Autonomous test system failed!"
    echo "Check the logs for details."
fi

exit $TEST_EXIT_CODE