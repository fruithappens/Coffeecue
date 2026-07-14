#!/bin/bash
# Launch the Coffee Cue Test Bench UI (http://localhost:5055).
# Uses the repo venv; needs flask + requests (both already in requirements).
cd "$(dirname "$0")"
PY="venv/bin/python3"
if [ ! -x "$PY" ]; then
  echo "No venv found — using system python3 (needs: pip install flask requests)"
  PY="python3"
fi
exec "$PY" testbench/app.py
