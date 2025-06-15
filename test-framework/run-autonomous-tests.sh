#!/bin/bash

echo "╔════════════════════════════════════════════════╗"
echo "║     🤖 Coffee Cue Autonomous Test System       ║"
echo "║           Starting up...                       ║"
echo "╚════════════════════════════════════════════════╝"
echo ""

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install puppeteer
fi

# Parse command line arguments
HEADLESS=""
RETRIES=""
VERBOSE=""

for arg in "$@"
do
    case $arg in
        --headless)
        HEADLESS="--headless"
        shift
        ;;
        --retries=*)
        RETRIES="${arg#*=}"
        shift
        ;;
        --verbose)
        VERBOSE="--verbose"
        shift
        ;;
        *)
        # unknown option
        ;;
    esac
done

# Build command
CMD="node autonomous-test-system.js"

if [ ! -z "$HEADLESS" ]; then
    CMD="$CMD --headless"
fi

if [ ! -z "$RETRIES" ]; then
    CMD="$CMD --retries=$RETRIES"
fi

if [ ! -z "$VERBOSE" ]; then
    CMD="$CMD --verbose"
fi

# Run the autonomous test system
echo "🚀 Launching autonomous test system..."
echo "   Command: $CMD"
echo ""

$CMD

# Capture exit code
EXIT_CODE=$?

# Show results
echo ""
if [ $EXIT_CODE -eq 0 ]; then
    echo "✅ All tests passed successfully!"
else
    echo "❌ Tests failed. Check the report for details."
fi

# Open the latest report
LATEST_REPORT=$(ls -t test-results/autonomous-test-report-*.html 2>/dev/null | head -1)
if [ ! -z "$LATEST_REPORT" ]; then
    echo "📊 Opening test report: $LATEST_REPORT"
    open "$LATEST_REPORT" 2>/dev/null || echo "   Please open manually: $LATEST_REPORT"
fi

exit $EXIT_CODE