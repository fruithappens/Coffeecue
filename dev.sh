#!/bin/bash
# dev.sh — one local-dev startup script to rule them all.
#
# Replaces the previous six:
#   start_expresso.sh, start_expresso_fast.sh, start_expresso_complete.sh,
#   start_expresso_enhanced.sh, start_expresso_with_twilio.sh, quick_start.sh
# Originals remain in _archive_startup_scripts/ for muscle-memory cases.
#
# NOTE: not to be confused with start.sh — that one is Railway's
# production entry point (just exec python3 run_server.py).
#
# Usage:
#   ./dev.sh                       # default: fast local dev (no ngrok)
#   ./dev.sh --with-ngrok          # also start ngrok and print the URL
#   ./dev.sh --with-twilio         # update Twilio webhook to the ngrok URL
#   ./dev.sh --background          # run backend + frontend in background
#   ./dev.sh --skip-db             # skip PostgreSQL startup (already running)
#   ./dev.sh --backend-only        # don't start the frontend
#   ./dev.sh --help                # show this help text
#
# Flags compose: `./dev.sh --with-ngrok --with-twilio` matches the old
# start_expresso_with_twilio.sh behaviour.

set -u  # error on unset vars. Deliberately not -e — we want to print
        # friendly messages and continue on sub-failures.

ROOT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$ROOT_DIR"
mkdir -p logs

# --- Colours (TTY only) ----------------------------------------------
if [ -t 1 ]; then
    GREEN='\033[0;32m'
    BLUE='\033[0;34m'
    YELLOW='\033[1;33m'
    RED='\033[0;31m'
    NC='\033[0m'
else
    GREEN='' BLUE='' YELLOW='' RED='' NC=''
fi

# --- Flag parsing -----------------------------------------------------
WITH_NGROK=0
WITH_TWILIO=0
BACKGROUND=0
SKIP_DB=0
BACKEND_ONLY=0
SHOW_HELP=0

for arg in "$@"; do
    case "$arg" in
        --with-ngrok)   WITH_NGROK=1 ;;
        --with-twilio)  WITH_TWILIO=1; WITH_NGROK=1 ;;  # twilio implies ngrok
        --background)   BACKGROUND=1 ;;
        --skip-db)      SKIP_DB=1 ;;
        --backend-only) BACKEND_ONLY=1 ;;
        --help|-h)      SHOW_HELP=1 ;;
        *) echo -e "${YELLOW}Unknown flag: $arg (use --help)${NC}" ;;
    esac
done

if [ "$SHOW_HELP" = "1" ]; then
    sed -n '1,25p' "$0" | sed 's/^# \{0,1\}//'
    exit 0
fi

# --- Helpers ----------------------------------------------------------
is_port_in_use() { lsof -Pi ":$1" -sTCP:LISTEN -t >/dev/null 2>&1; }

wait_for_port() {
    local port="$1"
    local label="$2"
    local timeout="${3:-30}"
    for ((i=0; i<timeout; i++)); do
        if is_port_in_use "$port"; then
            echo -e "${GREEN}  ✓ ${label} ready on port ${port}${NC}"
            return 0
        fi
        sleep 1
    done
    echo -e "${RED}  ✗ ${label} did not come up on port ${port} within ${timeout}s${NC}"
    return 1
}

kill_existing() {
    pkill -f "python3 run_server.py" 2>/dev/null
    pkill -f "react-scripts start" 2>/dev/null
    pkill -f "ngrok http" 2>/dev/null
    sleep 1
}

# --- Banner -----------------------------------------------------------
yn() { [ "$1" = "1" ] && echo yes || echo no; }
echo -e "${BLUE}========================================================${NC}"
echo -e "${BLUE}  Coffee Cue dev startup${NC}"
echo -e "${BLUE}========================================================${NC}"
echo -e "  ngrok:        $(yn $WITH_NGROK)"
echo -e "  twilio:       $(yn $WITH_TWILIO)"
echo -e "  background:   $(yn $BACKGROUND)"
echo -e "  skip db:      $(yn $SKIP_DB)"
echo -e "  backend only: $(yn $BACKEND_ONLY)"
echo

kill_existing

# --- PostgreSQL -------------------------------------------------------
if [ "$SKIP_DB" = "0" ]; then
    echo -e "${BLUE}▸ PostgreSQL${NC}"
    if command -v brew >/dev/null 2>&1; then
        if ! brew services list 2>/dev/null | grep -E 'postgresql.*started' > /dev/null; then
            brew services start postgresql@14 >/dev/null 2>&1 \
                || brew services start postgresql >/dev/null 2>&1 \
                || echo -e "${YELLOW}  could not start postgres via brew — is it installed?${NC}"
        else
            echo -e "${GREEN}  already running${NC}"
        fi
    fi
    # Create DB if missing. Silent if already present.
    if createdb expresso 2>/dev/null; then
        echo -e "${GREEN}  created database 'expresso'${NC}"
    else
        echo -e "${GREEN}  database 'expresso' exists${NC}"
    fi
fi

# --- Backend ----------------------------------------------------------
echo -e "${BLUE}▸ Backend (port 5001)${NC}"
if is_port_in_use 5001; then
    echo -e "${YELLOW}  port 5001 already in use — leaving as-is${NC}"
else
    if [ "$BACKGROUND" = "1" ]; then
        nohup python3 run_server.py > logs/backend.log 2>&1 &
        BACKEND_PID=$!
        echo -e "${GREEN}  started (pid $BACKEND_PID, log: logs/backend.log)${NC}"
    else
        python3 run_server.py &
        BACKEND_PID=$!
    fi
    wait_for_port 5001 "Backend" 30 || exit 1
fi

# --- Frontend ---------------------------------------------------------
if [ "$BACKEND_ONLY" = "0" ]; then
    echo -e "${BLUE}▸ Frontend (port 3000)${NC}"
    if is_port_in_use 3000; then
        echo -e "${YELLOW}  port 3000 already in use — leaving as-is${NC}"
    else
        ( cd "Barista Front End" && \
          if [ "$BACKGROUND" = "1" ]; then
              nohup npm start > "$ROOT_DIR/logs/frontend.log" 2>&1 &
              echo -e "${GREEN}  started (pid $!, log: logs/frontend.log)${NC}"
          else
              npm start &
          fi
        )
        wait_for_port 3000 "Frontend" 45
    fi
fi

# --- ngrok ------------------------------------------------------------
NGROK_URL=""
if [ "$WITH_NGROK" = "1" ]; then
    echo -e "${BLUE}▸ ngrok${NC}"
    if ! command -v ngrok >/dev/null 2>&1; then
        echo -e "${RED}  ngrok not installed — skipping${NC}"
    else
        nohup ngrok http 5001 > /tmp/coffee_ngrok.log 2>&1 &
        sleep 3
        NGROK_URL=$(curl -s http://127.0.0.1:4040/api/tunnels 2>/dev/null \
            | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['tunnels'][0]['public_url'] if d.get('tunnels') else '')" 2>/dev/null)
        if [ -n "$NGROK_URL" ]; then
            echo -e "${GREEN}  $NGROK_URL${NC}"
        else
            echo -e "${YELLOW}  could not extract public URL${NC}"
        fi
    fi
fi

# --- Twilio webhook ---------------------------------------------------
if [ "$WITH_TWILIO" = "1" ] && [ -n "$NGROK_URL" ]; then
    echo -e "${BLUE}▸ Twilio webhook${NC}"
    if [ -f "update_twilio_webhook.py" ]; then
        python3 update_twilio_webhook.py "$NGROK_URL/api/sms/webhook" \
            && echo -e "${GREEN}  updated${NC}" \
            || echo -e "${RED}  update failed (set manually in Twilio console)${NC}"
    else
        echo -e "${YELLOW}  update_twilio_webhook.py not found — set manually:${NC}"
        echo -e "${YELLOW}  ${NGROK_URL}/api/sms/webhook${NC}"
    fi
fi

# --- Done -------------------------------------------------------------
echo
echo -e "${GREEN}════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Coffee Cue is up.${NC}"
echo -e "  Backend:  http://localhost:5001/api/health"
[ "$BACKEND_ONLY" = "0" ] && echo -e "  Frontend: http://localhost:3000"
[ -n "$NGROK_URL" ] && echo -e "  Public:   $NGROK_URL"
echo -e "${GREEN}════════════════════════════════════════════════════════${NC}"

if [ "$BACKGROUND" = "0" ]; then
    echo -e "\nCtrl+C to stop. Logs are inline."
    wait
fi
