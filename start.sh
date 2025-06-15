#!/bin/bash
# Railway startup script
which python3 >/dev/null 2>&1 && exec python3 run_server.py
which python >/dev/null 2>&1 && exec python run_server.py
echo "No Python interpreter found"
exit 1