#!/bin/bash
# Run the Test Bench with credentials from testbench/.bench_env — WITHOUT ever
# printing them. This lets an assistant run the FULL authenticated bench
# without the password appearing in any command or transcript: the password
# lives only in .bench_env (gitignored), which the operator creates by hand.
#
# Create testbench/.bench_env (once) with:
#   export BENCH_USER=benchbot
#   export BENCH_PASS=your-password-here
#   export BENCH_TARGET=https://web-production-4cc9c.up.railway.app
#
# Then:  bash testbench/run_bench_auth.sh [--suites all] [--allow-... flags]
#
# Security: this script disables shell tracing and never echoes the secrets;
# run_bench.py reads BENCH_USER/BENCH_PASS from the environment and does not
# log them; the reports never contain them.
set +x
cd "$(dirname "$0")/.."

ENVFILE="testbench/.bench_env"
if [ ! -f "$ENVFILE" ]; then
  echo "ERROR: $ENVFILE not found."
  echo "Create it with export BENCH_USER=... / BENCH_PASS=... / BENCH_TARGET=..."
  echo "(It is gitignored and never committed.)"
  exit 2
fi

set -a
# shellcheck disable=SC1090
. "$ENVFILE"
set +a

if [ -z "$BENCH_USER" ] || [ -z "$BENCH_PASS" ]; then
  echo "ERROR: BENCH_USER / BENCH_PASS not set in $ENVFILE"
  exit 2
fi

PY="venv/bin/python3"
[ -x "$PY" ] || PY="python3"

# Pass everything through; credentials come from the environment (not argv),
# so they never appear in the process list or this script's arguments.
exec "$PY" testbench/run_bench.py \
  --base-url "${BENCH_TARGET:-https://web-production-4cc9c.up.railway.app}" \
  "$@"
