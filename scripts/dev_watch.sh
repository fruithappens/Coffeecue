#!/bin/bash
#
# Dev-mode backend with auto-restart on .py file changes.
#
# Why this exists
# ---------------
# Flask's built-in reloader (use_reloader=True) hangs the child
# process when combined with eventlet (Flask-SocketIO async_mode).
# This script is the workaround: an external file-watcher that
# kills + respawns the backend whenever a Python file changes.
#
# Effect: edit a .py file under routes/ services/ utils/ etc. and
# the backend restarts in ~2 seconds, no manual intervention.
#
# Requires fswatch:  brew install fswatch
#
# Usage:
#   ./scripts/dev_watch.sh
#   PORT=5001 ./scripts/dev_watch.sh
#
# Ctrl-C stops both the watcher AND the backend.

set -uo pipefail

PORT="${PORT:-5001}"
VENV_PYTHON="${VENV_PYTHON:-/Users/stevewf/expresso/venv/bin/python}"

if ! command -v fswatch >/dev/null 2>&1; then
    echo "✗ fswatch not installed. Install with:  brew install fswatch"
    exit 1
fi
if [ ! -x "$VENV_PYTHON" ]; then
    echo "✗ Python not found at $VENV_PYTHON (set VENV_PYTHON env var)"
    exit 1
fi

# Track the backend PID so we can kill it cleanly on file change + Ctrl-C.
BACKEND_PID=""

start_backend() {
    echo "[$(date '+%H:%M:%S')] starting backend..."
    "$VENV_PYTHON" run_server.py > /tmp/expresso_backend.log 2>&1 &
    BACKEND_PID=$!
    # Wait briefly for bind so the next save doesn't race.
    for i in 1 2 3 4 5; do
        if nc -z localhost "$PORT" 2>/dev/null; then
            echo "[$(date '+%H:%M:%S')] backend UP (pid $BACKEND_PID, port $PORT)"
            return 0
        fi
        sleep 1
    done
    echo "[$(date '+%H:%M:%S')] backend didn't bind in 5s — check /tmp/expresso_backend.log"
}

stop_backend() {
    if [ -n "$BACKEND_PID" ] && kill -0 "$BACKEND_PID" 2>/dev/null; then
        kill -TERM "$BACKEND_PID" 2>/dev/null
        # Give it 2s to shut down cleanly, then SIGKILL.
        for i in 1 2; do
            if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
                return 0
            fi
            sleep 1
        done
        kill -KILL "$BACKEND_PID" 2>/dev/null
    fi
    # Also reap any orphaned backend on the port.
    lsof -ti:"$PORT" 2>/dev/null | xargs -r kill -9 2>/dev/null
}

cleanup() {
    echo
    echo "[$(date '+%H:%M:%S')] shutting down…"
    stop_backend
    exit 0
}
trap cleanup INT TERM

# Initial start.
stop_backend  # just in case something was already running
start_backend

# Watch for .py changes anywhere under the repo, EXCLUDING noise.
# fswatch -o emits a line per batch of events — debounced.
echo "[$(date '+%H:%M:%S')] watching .py files (Ctrl-C to stop)"
fswatch -o -l 0.5 \
    --exclude '__pycache__' \
    --exclude '\.pyc$' \
    --exclude 'venv/' \
    --exclude '_archive' \
    --exclude 'node_modules' \
    --exclude '\.git/' \
    --exclude 'logs/' \
    --exclude 'backups/' \
    --include '\.py$' \
    . | while read -r _; do
    echo "[$(date '+%H:%M:%S')] file change detected — restarting"
    stop_backend
    start_backend
done
