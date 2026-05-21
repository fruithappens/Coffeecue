#!/bin/bash
# smoke_test_full.sh — top-level smoke test entry point.
#
# Today: just runs the API contract smoke test. Designed to grow:
# later we'll add a Playwright section after this for the 8 operator
# scenarios (see SELF_TEST_REPAIR_PROPOSAL.md step 2).
#
# Exit code is the API smoke's exit code (0=pass, 1=any fail, 2=bootstrap).
#
# Usage:
#   ./tests/smoke/smoke_test_full.sh
#   BASE_URL=http://localhost:5001 ./tests/smoke/smoke_test_full.sh
#
# Assumes the backend is already running. Won't start the stack.

set -u  # error on undefined vars

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
ROOT_DIR="$( cd "$SCRIPT_DIR/../.." && pwd )"

BASE_URL="${BASE_URL:-http://localhost:5001}"

echo "=========================================="
echo "Expresso smoke test"
echo "  base URL: $BASE_URL"
echo "  root:     $ROOT_DIR"
echo "=========================================="
echo

# Quick TCP probe so we fail fast with a friendly message rather than
# burning the per-request timeout on every check.
HOST=$(echo "$BASE_URL" | sed -E 's|^https?://||' | cut -d/ -f1 | cut -d: -f1)
PORT=$(echo "$BASE_URL" | sed -E 's|^https?://[^:/]+:?||' | cut -d/ -f1)
PORT=${PORT:-80}
if ! nc -z "$HOST" "$PORT" 2>/dev/null; then
  echo "✗ backend not reachable at $BASE_URL"
  echo "  → start it with: ./start_expresso.sh"
  exit 2
fi

# Find the python interpreter — prefer the project venv if present.
if [ -x "$ROOT_DIR/venv/bin/python" ]; then
  PYTHON="$ROOT_DIR/venv/bin/python"
elif command -v python3 >/dev/null 2>&1; then
  PYTHON=python3
else
  PYTHON=python
fi

cd "$ROOT_DIR"
"$PYTHON" tests/smoke/smoke_test_api.py --base-url "$BASE_URL"
API_RC=$?

echo
if [ $API_RC -eq 0 ]; then
  echo "✓ smoke passed"
else
  echo "✗ smoke failed (rc=$API_RC) — see logs/smoke_*.json"
fi

exit $API_RC
