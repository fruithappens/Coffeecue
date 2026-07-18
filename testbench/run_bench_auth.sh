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

# Look for the credentials file in the repo first, then the operator's home
# dir. The home-dir location survives worktrees, branch switches and stale
# checkouts (the repo path may not exist yet).
ENVFILE=""
for candidate in "testbench/.bench_env" "$HOME/.coffeecue_bench_env"; do
  if [ -f "$candidate" ]; then ENVFILE="$candidate"; break; fi
done
if [ -z "$ENVFILE" ]; then
  echo "ERROR: no credentials file found."
  echo "Looked for: testbench/.bench_env and \$HOME/.coffeecue_bench_env"
  echo "Create one with: export BENCH_USER=... / BENCH_PASS=... / BENCH_TARGET=..."
  echo "(Both locations are kept out of git.)"
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
