#!/bin/bash

# Fix CORS issue in backend and restart server
# This script locates and fixes the CORS configuration in the Flask app

# Color definitions for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}=== Expresso CORS Fix Tool ===${NC}"
echo -e "This script will attempt to fix the CORS issue in your backend server."

# Navigate to the backend directory (the expresso root, not from Barista Front End)
cd /Users/stevewf/expresso || { echo -e "${RED}Error: Cannot navigate to expresso directory${NC}"; exit 1; }

# Check if we're in the right place
if [ ! -f "app.py" ]; then
    echo -e "${RED}Error: app.py not found in $(pwd)${NC}"
    echo -e "${YELLOW}Please run this script from the Barista Front End directory${NC}"
    exit 1
fi

echo -e "${GREEN}Found app.py in $(pwd)${NC}"

# Create a backup of app.py
BACKUP_FILE="app.py.bak.cors.$(date +%s)"
cp app.py "$BACKUP_FILE" || { echo -e "${RED}Error: Failed to create backup${NC}"; exit 1; }
echo -e "${GREEN}Created backup at $BACKUP_FILE${NC}"

# Check for CORS configuration pattern
if grep -q "CORS(app, origins=\[" app.py; then
    echo -e "${GREEN}Found CORS configuration in app.py${NC}"
    
    # Fix the CORS configuration
    # Replace any multi-origin configuration with a single wildcard
    sed -i.temp 's/CORS(app, origins=\[[^]]*\])/CORS(app, origins=["*"])/' app.py
    rm -f app.py.temp
    
    echo -e "${GREEN}CORS configuration updated to use a single wildcard origin${NC}"
else
    echo -e "${YELLOW}Could not find standard CORS configuration pattern${NC}"
    echo -e "${YELLOW}Attempting to add CORS configuration...${NC}"
    
    # Check if Flask-CORS is imported
    if ! grep -q "from flask_cors import CORS" app.py; then
        # Add the import if it doesn't exist
        sed -i.temp '1s/^/from flask_cors import CORS\n/' app.py
        rm -f app.py.temp
        echo -e "${GREEN}Added Flask-CORS import${NC}"
    fi
    
    # Check for Flask app instance pattern
    if grep -q "app = Flask" app.py; then
        # Add CORS configuration after the app creation
        sed -i.temp '/app = Flask/a\\nCORS(app, origins=["*"])  # Added by fix script' app.py
        rm -f app.py.temp
        echo -e "${GREEN}Added CORS configuration after Flask app creation${NC}"
    else
        echo -e "${RED}Could not find Flask app creation pattern${NC}"
        echo -e "${RED}Manual fix required. Please edit app.py to fix CORS settings${NC}"
        exit 1
    fi
fi

# Check if the configuration was successfully updated
if grep -q 'CORS(app, origins=\["\\*"\])' app.py; then
    echo -e "${GREEN}CORS configuration successfully updated${NC}"
else
    echo -e "${YELLOW}CORS update may not have succeeded. Please check app.py manually${NC}"
fi

# Try to restart the server
echo -e "${YELLOW}Attempting to restart the backend server...${NC}"

# Check for common Python run patterns
if [ -f "run_server.py" ]; then
    echo -e "${GREEN}Found run_server.py, restarting server...${NC}"
    # Kill any existing Python processes
    pkill -f "python.*run_server.py" 2>/dev/null
    nohup python run_server.py > server.log 2>&1 &
    echo -e "${GREEN}Server restarted. Check server.log for details${NC}"
elif [ -f "start.sh" ]; then
    echo -e "${GREEN}Found start.sh, executing...${NC}"
    ./start.sh
    echo -e "${GREEN}Server restart attempted via start.sh${NC}"
else
    echo -e "${YELLOW}No standard start script found. Trying to restart with python app.py...${NC}"
    # Kill any existing Python processes
    pkill -f "python.*app.py" 2>/dev/null
    nohup python app.py > server.log 2>&1 &
    echo -e "${GREEN}Server restart attempted. Check server.log for details${NC}"
fi

echo -e "${GREEN}=======================================================${NC}"
echo -e "${GREEN}CORS fix applied. Please try the application again.${NC}"
echo -e "${GREEN}If issues persist, you may need to manually modify app.py${NC}"
echo -e "${GREEN}Backup was created at: $BACKUP_FILE${NC}"
echo -e "${GREEN}=======================================================${NC}"