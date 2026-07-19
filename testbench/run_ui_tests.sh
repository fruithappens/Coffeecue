#!/bin/bash
# Phase C — run the Cypress UI tests against a live Coffee Cue, using the
# same gitignored credentials file as the API bench (no secrets in specs,
# no secrets in argv). Defaults to production; override with BENCH_TARGET.
#
#   bash testbench/run_ui_tests.sh                     # all ui_* specs
#   bash testbench/run_ui_tests.sh ui_kiosk_order      # one spec by name
#
# The specs are self-cleaning: kiosk/board orders are phoneless (zero SMS
# risk), tagged ZZBenchUI*, and cancelled via the API afterwards.
set +x
cd "$(dirname "$0")/.." || exit 2

ENVFILE=""
for candidate in "testbench/.bench_env" "$HOME/.coffeecue_bench_env"; do
  if [ -f "$candidate" ]; then ENVFILE="$candidate"; break; fi
done
if [ -z "$ENVFILE" ]; then
  echo "ERROR: no credentials file (testbench/.bench_env or ~/.coffeecue_bench_env)"
  exit 2
fi
set -a
# shellcheck disable=SC1090
. "$ENVFILE"
set +a

export CYPRESS_BASE_URL="${BENCH_TARGET:-https://web-production-4cc9c.up.railway.app}"
export CYPRESS_BENCH_USER="$BENCH_USER"
export CYPRESS_BENCH_PASS="$BENCH_PASS"

SPEC="cypress/e2e/ui_*.cy.js"
if [ -n "$1" ]; then SPEC="cypress/e2e/${1%.cy.js}.cy.js"; fi

cd "Barista Front End" || exit 2
exec npx cypress run --spec "$SPEC"
