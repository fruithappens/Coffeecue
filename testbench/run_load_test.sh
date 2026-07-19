#!/bin/bash
# Load test against the live target (sized for a 400-person event).
#   bash testbench/run_load_test.sh
set +x
cd "$(dirname "$0")/.." || exit 2
ENVFILE=""
for candidate in "testbench/.bench_env" "$HOME/.coffeecue_bench_env"; do
  if [ -f "$candidate" ]; then ENVFILE="$candidate"; break; fi
done
[ -z "$ENVFILE" ] && { echo "ERROR: no credentials file"; exit 2; }
set -a; . "$ENVFILE"; set +a
PY="venv/bin/python3"; [ -x "$PY" ] || PY="python3"
exec "$PY" testbench/load_test.py
