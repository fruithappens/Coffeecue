#!/bin/bash

echo "🚀 Quick Starting Expresso..."

# Kill any existing processes
pkill -f "python3 run_server.py" 2>/dev/null
pkill -f "npm start" 2>/dev/null

# Start backend
echo "Starting backend on port 5001..."
cd /Users/stevewf/expresso
python3 run_server.py &

# Wait for backend to start
sleep 3

# Start frontend
echo "Starting frontend on port 3000..."
cd "/Users/stevewf/expresso/Barista Front End"
npm start &

# Wait a bit then open browser
sleep 5
open "http://localhost:3000"

echo "✅ System started!"
echo "Frontend: http://localhost:3000"
echo "Backend: http://localhost:5001"
echo ""
echo "Login as:"
echo "  Admin: coffeecue / adminpassword"
echo "  Barista: barista / barista123"