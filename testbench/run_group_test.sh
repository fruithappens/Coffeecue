#!/bin/bash
# Live group SMS test — capture & review. Credentials from the same
# gitignored env file as the bench.
#   bash testbench/run_group_test.sh start    # just before the group texts
#   bash testbench/run_group_test.sh report   # when they're done
set +x
cd "$(dirname "$0")/.." || exit 2
ENVFILE=""
for candidate in "testbench/.bench_env" "$HOME/.coffeecue_bench_env"; do
  if [ -f "$candidate" ]; then ENVFILE="$candidate"; break; fi
done
[ -z "$ENVFILE" ] && { echo "ERROR: no credentials file"; exit 2; }
set -a; . "$ENVFILE"; set +a
PY="venv/bin/python3"; [ -x "$PY" ] || PY="python3"
exec "$PY" testbench/group_capture.py "${1:-report}"
