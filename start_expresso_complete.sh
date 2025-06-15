#!/bin/bash

# Fancy output
print_centered() {
  local text="$1"
  local width=$(tput cols)
  local padding=$(( (width - ${#text}) / 2 ))
  printf "%${padding}s" ""
  echo "$text"
}

print_status() {
  local status=$1
  local message=$2
  case $status in
    "success") echo "✅ $message" ;;
    "error") echo "❌ $message" ;;
    "working") echo "🔄 $message" ;;
    "info") echo "ℹ️  $message" ;;
  esac
}

# Header
clear
echo "========================================================================="
print_centered "☕ EXPRESSO COFFEE CUE SYSTEM - COMPLETE LAUNCHER ☕"
echo "========================================================================="
echo

# Get the directory of this script
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR"

# Function to check if program is installed
is_installed() {
  command -v "$1" >/dev/null 2>&1
}

# Function to launch a new terminal with a command
launch_terminal() {
  osascript -e "tell application \"Terminal\"
    do script \"cd '$DIR' && $1\"
    set custom title of front window to \"$2\"
  end tell"
}

# Check for required programs
print_status "info" "Checking system requirements..."

# Check Python 3
if ! is_installed python3; then
  print_status "error" "Python 3 is not installed. Please install it first."
  exit 1
else
  PYTHON_VERSION=$(python3 --version 2>&1 | cut -d' ' -f2)
  print_status "success" "Python $PYTHON_VERSION found"
fi

# Check Node.js
if ! is_installed node; then
  print_status "error" "Node.js is not installed. Please install it first."
  exit 1
else
  NODE_VERSION=$(node --version)
  print_status "success" "Node.js $NODE_VERSION found"
fi

# Check PostgreSQL
if ! is_installed psql; then
  print_status "error" "PostgreSQL is not installed. Please install it first:"
  echo "   brew install postgresql@15"
  exit 1
else
  print_status "success" "PostgreSQL found"
fi

# Check ngrok
if ! is_installed ngrok; then
  print_status "error" "ngrok is not installed. Please install it first:"
  echo "   brew install ngrok/ngrok/ngrok"
  exit 1
else
  print_status "success" "ngrok found"
fi

# Start PostgreSQL if not running
if ! pgrep -x postgres > /dev/null; then
  print_status "working" "Starting PostgreSQL..."
  brew services start postgresql@15
  sleep 3
else
  print_status "success" "PostgreSQL is already running"
fi

# Create the expresso database if it doesn't exist
print_status "working" "Checking database..."
if ! psql -lqt | cut -d \| -f 1 | grep -qw expresso; then
  print_status "working" "Creating database..."
  createdb expresso
  if [ $? -eq 0 ]; then
    print_status "success" "Database created"
  else
    print_status "error" "Failed to create database"
    exit 1
  fi
else
  print_status "success" "Database already exists"
fi

# Initialize database tables
print_status "working" "Initializing database tables..."
if [ -f "pg_init.py" ]; then
  python3 pg_init.py > /dev/null 2>&1
  if [ $? -eq 0 ]; then
    print_status "success" "Database tables initialized"
  else
    print_status "error" "Failed to initialize database tables"
  fi
else
  print_status "error" "pg_init.py not found"
fi

# Install Python dependencies if needed
if [ ! -d "venv" ]; then
  print_status "working" "Creating Python virtual environment..."
  python3 -m venv venv
fi

print_status "working" "Installing Python dependencies..."
source venv/bin/activate
pip install -r requirements.txt > /dev/null 2>&1
if [ $? -eq 0 ]; then
  print_status "success" "Python dependencies installed"
else
  print_status "error" "Failed to install Python dependencies"
fi

# Install frontend dependencies if needed
if [ ! -d "Barista Front End/node_modules" ]; then
  print_status "working" "Installing frontend dependencies (this may take a few minutes)..."
  cd "Barista Front End"
  npm install > /dev/null 2>&1
  if [ $? -eq 0 ]; then
    print_status "success" "Frontend dependencies installed"
  else
    print_status "error" "Failed to install frontend dependencies"
  fi
  cd ..
else
  print_status "success" "Frontend dependencies already installed"
fi

# Check if there's test data
print_status "working" "Checking for test data..."
ADMIN_EXISTS=$(python3 -c "
from utils.database import get_db_connection, close_connection
try:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT COUNT(*) FROM users WHERE username = %s', ('coffeecue',))
    count = cursor.fetchone()[0]
    cursor.close()
    close_connection(conn)
    print(count)
except:
    print(0)
" 2>/dev/null)

if [ "$ADMIN_EXISTS" = "0" ]; then
  print_status "working" "Creating admin user..."
  python3 create_admin.py > /dev/null 2>&1
  print_status "success" "Admin user created"
fi

# Create test users if needed
if [ -f "create_test_users.py" ]; then
  python3 create_test_users.py > /dev/null 2>&1
  print_status "success" "Test users ready"
fi

# Create test stations if needed
if [ -f "create_test_stations.py" ]; then
  python3 create_test_stations.py > /dev/null 2>&1
  print_status "success" "Test stations ready"
fi

# Load test data if needed
if [ -f "load_test_data.py" ]; then
  python3 load_test_data.py > /dev/null 2>&1
  print_status "success" "Test data loaded"
fi

echo
print_status "info" "Starting services..."

# Start ngrok in a new terminal
print_status "working" "Starting ngrok..."
launch_terminal "ngrok http 5001 --log=stdout" "Expresso - ngrok"
sleep 2

# Start backend server in a new terminal
print_status "working" "Starting backend server..."
launch_terminal "source venv/bin/activate && python3 run_server.py" "Expresso - Backend"
sleep 3

# Start frontend in a new terminal
print_status "working" "Starting frontend..."
launch_terminal "cd 'Barista Front End' && npm start" "Expresso - Frontend"

# Show the user how to access the app
echo
echo "========================================================================="
print_centered "🚀 EXPRESSO COFFEE CUE SYSTEM IS RUNNING 🚀"
echo "========================================================================="
echo
echo "🌐 Local URLs:"
echo "   • Backend API: http://localhost:5001"
echo "   • Frontend: http://localhost:3000"
echo
echo "🔗 Public URL (via ngrok):"
echo "   • Check the ngrok terminal window"
echo "   • Or visit: http://localhost:4040"
echo
echo "👤 Login Credentials:"
echo "   • Admin: coffeecue / adminpassword"
echo "   • Barista: barista / barista123"
echo "   • Organizer: organizer / organizer123"
echo
echo "📱 Mobile Access:"
echo "   • Use the ngrok URL to access from mobile devices"
echo
echo "✋ To stop all services, close the terminal windows"
echo "========================================================================="

# Open the frontend in the default browser after a delay
sleep 5
open "http://localhost:3000"