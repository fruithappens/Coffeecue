#!/bin/bash

echo "🚀 Starting Coffee Cue Development Environment"
echo "=============================================="

# Kill any existing processes
echo "🧹 Cleaning up existing processes..."
pkill -f "react-scripts" 2>/dev/null
pkill -f "run_server.py" 2>/dev/null

# Wait a moment for cleanup
sleep 2

# Start backend on port 5001
echo "🔧 Starting Flask Backend on port 5001..."
cd "/Users/stevewf/expresso"
python3 run_server.py &
BACKEND_PID=$!

# Wait for backend to start
sleep 5

# Check if we can use React dev server on an alternative port
echo "⚡ Attempting to start React Development Server..."
cd "/Users/stevewf/expresso/Barista Front End"

# Try different ports until we find one that works
# Using Chrome-safe ports (avoiding 3000-4999 range)
for PORT in 8080 8000 8888 9000 9001 9002; do
    echo "🔍 Trying React dev server on port $PORT..."
    
    # Test if port is available
    if ! lsof -i:$PORT >/dev/null 2>&1; then
        echo "✅ Port $PORT is available, starting React dev server..."
        
        # Start React dev server
        PORT=$PORT HOST=0.0.0.0 npm start &
        REACT_PID=$!
        
        # Wait a moment for it to start
        sleep 10
        
        # Test if it's actually accessible
        if curl -s http://localhost:$PORT >/dev/null 2>&1; then
            echo "🎉 SUCCESS! React dev server running on port $PORT"
            echo ""
            echo "📱 Frontend (React): http://localhost:$PORT"
            echo "🔧 Backend (Flask):  http://localhost:5001"
            echo "📦 Migration Tool:   http://localhost:5001/static/localStorage-to-database-migration.html"
            echo ""
            echo "✨ Development environment ready!"
            echo "   - Frontend changes will hot-reload"
            echo "   - Backend API available for testing"
            echo "   - Proper development separation maintained"
            echo ""
            echo "Press Ctrl+C to stop all services"
            
            # Wait for user to stop
            trap 'echo "🛑 Stopping services..."; kill $BACKEND_PID $REACT_PID 2>/dev/null; exit 0' INT
            wait
            break
        else
            echo "❌ Port $PORT didn't work, killing process and trying next..."
            kill $REACT_PID 2>/dev/null
        fi
    else
        echo "🚫 Port $PORT is in use, trying next..."
    fi
done

# If we get here, no React dev server worked
echo "⚠️  React development server couldn't start on any port"
echo "🔄 Falling back to production mode via Flask backend"
echo ""
echo "📱 Building React app for production..."
npm run build

echo "📋 Copying build to Flask static directory..."
cp -r build/* "../static/"

echo "✅ System ready in production mode:"
echo "   🌐 Access everything at: http://localhost:5001"
echo "   📝 Note: Changes require rebuilding React app"

# Keep backend running
echo ""
echo "Press Ctrl+C to stop backend service"
trap 'echo "🛑 Stopping backend..."; kill $BACKEND_PID 2>/dev/null; exit 0' INT
wait