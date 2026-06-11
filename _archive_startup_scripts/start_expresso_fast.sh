#!/bin/bash
# Ultra-fast startup script with smart Twilio webhook updating

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 Coffee Cue Fast Start${NC}"

# Function to check if a service is running
check_service() {
    lsof -Pi :$2 -sTCP:LISTEN -t >/dev/null 2>&1
}

# Start all services in parallel
echo -e "\n${BLUE}Starting all services...${NC}"

# PostgreSQL
if ! brew services list | grep postgresql | grep started > /dev/null 2>&1; then
    brew services start postgresql@14 &
    PG_PID=$!
else
    echo -e "${GREEN}✓ PostgreSQL already running${NC}"
fi

# Backend (if not running)
if ! check_service "Backend" 5001; then
    osascript -e 'tell app "Terminal" to do script "cd \"'$(pwd)'\" && source venv/bin/activate && python run_server.py"' &
    BACKEND_PID=$!
else
    echo -e "${GREEN}✓ Backend already running${NC}"
fi

# Frontend (if not running)
if ! check_service "Frontend" 3000; then
    osascript -e 'tell app "Terminal" to do script "cd \"'$(pwd)'/Barista Front End\" && npm start"' &
    FRONTEND_PID=$!
else
    echo -e "${GREEN}✓ Frontend already running${NC}"
fi

# ngrok (if not running)
NGROK_RUNNING=false
if ! check_service "ngrok" 4040; then
    osascript -e 'tell app "Terminal" to do script "ngrok http 5001"' &
    NGROK_PID=$!
else
    echo -e "${GREEN}✓ ngrok already running${NC}"
    NGROK_RUNNING=true
fi

# Quick check if Twilio webhook update is needed (run in background)
if [ -f "twilio-config.json" ] || [ -n "$TWILIO_ACCOUNT_SID" ]; then
    (
        # Wait a bit for ngrok if it just started
        if [ "$NGROK_RUNNING" = false ]; then
            sleep 5
        fi
        
        # Check if update is needed
        if python3 check-twilio-webhook.py 2>/dev/null; then
            echo -e "\n${YELLOW}📡 Updating Twilio webhook...${NC}"
            python3 update-twilio-webhook.py
        else
            echo -e "\n${GREEN}✓ Twilio webhook is already up to date${NC}"
        fi
    ) &
fi

# Get URLs (wait a bit for services to start)
sleep 3

# Try to get ngrok URL
NGROK_URL=$(curl -s http://localhost:4040/api/tunnels 2>/dev/null | python3 -c "import sys, json; print(json.load(sys.stdin)['tunnels'][0]['public_url'])" 2>/dev/null || echo "")

# Display access information
echo -e "\n${GREEN}✅ Coffee Cue is starting!${NC}"
echo -e "\n${BLUE}Access your application at:${NC}"
echo -e "  Local Frontend: ${GREEN}http://localhost:3000${NC}"
echo -e "  Local Backend:  ${GREEN}http://localhost:5001${NC}"

if [ -n "$NGROK_URL" ]; then
    echo -e "  Public URL:     ${GREEN}${NGROK_URL}${NC}"
    echo -e "  SMS Webhook:    ${GREEN}${NGROK_URL}/api/sms/webhook${NC}"
    
    # Copy to clipboard
    echo "${NGROK_URL}/api/sms/webhook" | pbcopy
    echo -e "\n${YELLOW}📋 Webhook URL copied to clipboard!${NC}"
fi

echo -e "\n${BLUE}Services are launching in the background...${NC}"