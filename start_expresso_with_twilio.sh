#!/bin/bash
# Enhanced startup script that automatically updates Twilio webhook

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 Starting Expresso with Twilio Integration${NC}"

# Function to check if a service is running
check_service() {
    if lsof -Pi :$2 -sTCP:LISTEN -t >/dev/null ; then
        echo -e "${GREEN}✓ $1 is already running on port $2${NC}"
        return 0
    else
        echo -e "${YELLOW}✗ $1 is not running on port $2${NC}"
        return 1
    fi
}

# Function to wait for service to start
wait_for_service() {
    echo -n "Waiting for $1 to start on port $2..."
    for i in {1..30}; do
        if lsof -Pi :$2 -sTCP:LISTEN -t >/dev/null ; then
            echo -e " ${GREEN}ready!${NC}"
            return 0
        fi
        echo -n "."
        sleep 1
    done
    echo -e " ${RED}timeout!${NC}"
    return 1
}

# Start PostgreSQL if not running
echo -e "\n${BLUE}1. Checking PostgreSQL...${NC}"
if ! brew services list | grep postgresql | grep started > /dev/null; then
    echo "Starting PostgreSQL..."
    brew services start postgresql@14
    sleep 3
fi

# Start backend
echo -e "\n${BLUE}2. Starting Backend Server...${NC}"
if ! check_service "Backend" 5001; then
    osascript -e 'tell app "Terminal" to do script "cd \"'$(pwd)'\" && source venv/bin/activate && python run_server.py"'
    wait_for_service "Backend" 5001
fi

# Start frontend
echo -e "\n${BLUE}3. Starting Frontend Development Server...${NC}"
if ! check_service "Frontend" 3000; then
    osascript -e 'tell app "Terminal" to do script "cd \"'$(pwd)'/Barista Front End\" && npm start"'
    wait_for_service "Frontend" 3000
fi

# Start ngrok
echo -e "\n${BLUE}4. Starting ngrok tunnel...${NC}"
if ! check_service "ngrok" 4040; then
    osascript -e 'tell app "Terminal" to do script "ngrok http 5001"'
    echo "Waiting for ngrok to establish tunnel..."
    sleep 5  # Give ngrok time to start and establish tunnel
fi

# Update Twilio webhook if credentials are set
echo -e "\n${BLUE}5. Updating Twilio webhook...${NC}"
if [ -n "$TWILIO_ACCOUNT_SID" ] && [ -n "$TWILIO_AUTH_TOKEN" ] && [ -n "$TWILIO_PHONE_NUMBER_SID" ]; then
    python3 update-twilio-webhook.py
else
    echo -e "${YELLOW}⚠️  Twilio credentials not found in environment.${NC}"
    echo "To enable automatic webhook updates, add these to your ~/.zshrc or ~/.bash_profile:"
    echo ""
    echo "export TWILIO_ACCOUNT_SID='your_account_sid'"
    echo "export TWILIO_AUTH_TOKEN='your_auth_token'"
    echo "export TWILIO_PHONE_NUMBER_SID='your_phone_number_sid'"
    echo ""
    echo "You can find these values in your Twilio Console:"
    echo "- Account SID: On your Twilio Console Dashboard"
    echo "- Auth Token: On your Twilio Console Dashboard (click to reveal)"
    echo "- Phone Number SID: Go to Phone Numbers > Manage > Active Numbers > Click your number"
    echo "  The SID is in the URL or on the phone number's configuration page"
fi

# Get and display ngrok URL
echo -e "\n${BLUE}6. Getting public URL...${NC}"
sleep 2
NGROK_URL=$(curl -s http://localhost:4040/api/tunnels | python3 -c "import sys, json; print(json.load(sys.stdin)['tunnels'][0]['public_url'])" 2>/dev/null)

if [ -n "$NGROK_URL" ]; then
    echo -e "${GREEN}✅ All services are running!${NC}"
    echo -e "\n${BLUE}Access your application at:${NC}"
    echo -e "  Local Frontend: ${GREEN}http://localhost:3000${NC}"
    echo -e "  Local Backend:  ${GREEN}http://localhost:5001${NC}"
    echo -e "  Public URL:     ${GREEN}${NGROK_URL}${NC}"
    echo -e "  SMS Webhook:    ${GREEN}${NGROK_URL}/api/sms/webhook${NC}"
    
    # Copy webhook URL to clipboard
    echo "${NGROK_URL}/api/sms/webhook" | pbcopy
    echo -e "\n${YELLOW}📋 Webhook URL copied to clipboard!${NC}"
else
    echo -e "${YELLOW}⚠️  Could not retrieve ngrok URL${NC}"
fi

echo -e "\n${BLUE}To stop all services, use: ${NC}killall ngrok && brew services stop postgresql@14"