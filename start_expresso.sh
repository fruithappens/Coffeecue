#!/bin/bash

# Fancy output
print_centered() {
  local text="$1"
  local width=$(tput cols)
  local padding=$(( (width - ${#text}) / 2 ))
  printf "%${padding}s" ""
  echo "$text"
}

# Check if enhanced version exists and redirect to it
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR"

if [ -f "start_expresso_enhanced.sh" ]; then
  echo "🚀 Redirecting to Enhanced Coffee Cue System v2.0..."
  echo "   (with database persistence and automatic backups)"
  sleep 2
  exec ./start_expresso_enhanced.sh
fi

# Header (fallback if enhanced version not available)
clear
echo "========================================================================="
print_centered "☕ EXPRESSO COFFEE CUE SYSTEM - ENTERPRISE SECURE ☕"
print_centered "🛡️ WITH ADVANCED SECURITY FEATURES 🛡️"
echo "========================================================================="
echo "🔐 Security Features Active:"
echo "  ✅ JWT Token Security with Blacklisting"
echo "  ✅ Database Encryption & SSL Connections"
echo "  ✅ Advanced Audit Logging & Monitoring"
echo "  ✅ File Upload Security & Malware Protection"
echo "  ✅ Brute Force Protection & Rate Limiting"
echo "  ✅ Error Message Sanitization"
echo "  ✅ Enhanced Content Security Policy"
echo "  ✅ Real-time Threat Detection"
echo "========================================================================="
echo

# Function to check if program is installed
is_installed() {
  command -v "$1" >/dev/null 2>&1
}

# Check for required programs
if ! is_installed ngrok; then
  echo "❌ ngrok is not installed. Please install it first:"
  echo "   brew install ngrok/ngrok/ngrok"
  exit 1
fi

# Start each component in a separate terminal tab
# Function to launch a new terminal with a command
launch_terminal() {
  osascript -e "tell application \"Terminal\"
    do script \"cd '$DIR' && $1\"
    set custom title of front window to \"$2\"
  end tell"
}

# Start PostgreSQL if not running
if ! pgrep -x postgres > /dev/null; then
  echo "🔄 Starting PostgreSQL..."
  brew services start postgresql@15
  sleep 3
fi

# Create the expresso database if it doesn't exist
echo "🔄 Checking database..."
if ! psql -lqt | cut -d \| -f 1 | grep -qw expresso; then
  echo "🔄 Initializing database..."
  python3 pg_init.py
else
  echo "✅ Database already exists"
fi

# Start ngrok in a new terminal
echo "🔄 Starting ngrok in a new terminal..."
launch_terminal "ngrok http 5001 --log=stdout" "Expresso - ngrok"
sleep 2

# Start backend server in a new terminal
echo "🔄 Starting backend server in a new terminal..."
launch_terminal "python3 run_server.py" "Expresso - Backend"
sleep 2

# Start frontend in a new terminal
echo "🔄 Starting frontend in a new terminal..."
launch_terminal "cd 'Barista Front End' && npm start" "Expresso - Frontend"

# Show the user how to access the app
echo
echo "========================================================================="
print_centered "🚀 EXPRESSO COFFEE CUE SYSTEM IS STARTING 🚀"
echo "========================================================================="
echo
echo "🌐 Local URLs:"
echo "   • Backend: http://localhost:5001"
echo "   • Frontend: http://localhost:3000"
echo
echo "🔗 To get the public ngrok URL, check the ngrok terminal window"
echo "   or visit: http://localhost:4040"
echo
echo "👤 Admin login:"
echo "   • Username: coffeecue"
echo "   • Password: adminpassword"
echo
echo "✋ To stop all services, close the terminal windows"
echo "========================================================================="