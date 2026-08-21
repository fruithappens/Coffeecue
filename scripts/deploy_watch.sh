#!/usr/bin/env bash
# deploy_watch.sh — watch production after a risky deploy and RESTORE IT
# AUTOMATICALLY if it misbehaves.
#
#   ./scripts/deploy_watch.sh [minutes] [--no-restore]
#
# WHY THE FLAP TEST MATTERS
# The gunicorn attempt on 2026-08-20 did not fail by staying down. It booted,
# served for a bit, had its worker SIGKILLed on a ~120s cycle, booted again.
# Sampling once would have shown 200 and looked fine. So this fails the deploy
# on EITHER symptom:
#   - hard down: 3 consecutive non-200
#   - flapping:  any non-200 at all after the settle window, which on a
#                healthy server should never happen
#
# Exit 0 = healthy for the whole window. Exit 1 = failed (and restored).
set -uo pipefail

BASE="${EXPRESSO_URL:-https://web-production-4cc9c.up.railway.app}"
MINUTES="${1:-10}"
RESTORE=1
[ "${2:-}" = "--no-restore" ] && RESTORE=0
GAP=15
SETTLE=90            # ignore the first 90s: that is the deploy itself
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

say() { printf '  %s\n' "$*"; }
health() { curl -s -m 10 -o /dev/null -w '%{http_code}' "$BASE/api/health" 2>/dev/null; }

END=$(( $(date +%s) + MINUTES*60 ))
START=$(date +%s)
consec_bad=0; bad_total=0; samples=0; settled_bad=0

say "watching $BASE for ${MINUTES}m (first ${SETTLE}s ignored as deploy time)"
while [ "$(date +%s)" -lt "$END" ]; do
  code=$(health); samples=$((samples+1))
  elapsed=$(( $(date +%s) - START ))
  in_settle=$([ "$elapsed" -lt "$SETTLE" ] && echo 1 || echo 0)

  if [ "$code" = "200" ]; then
    consec_bad=0
  else
    consec_bad=$((consec_bad+1)); bad_total=$((bad_total+1))
    [ "$in_settle" = "0" ] && settled_bad=$((settled_bad+1))
  fi
  printf '   %s health=%-3s %s\n' "$(date -u +%H:%M:%S)" "${code:-000}" \
    "$([ "$in_settle" = "1" ] && echo '(settling)' || echo '')"

  if [ "$consec_bad" -ge 3 ] && [ "$in_settle" = "0" ]; then
    say "FAILED: 3 consecutive non-200 — the site is down"
    break
  fi
  if [ "$settled_bad" -ge 2 ]; then
    say "FAILED: $settled_bad non-200 after settling — this is the flap signature"
    break
  fi
  sleep "$GAP"
done

if [ "$consec_bad" -ge 3 ] || [ "$settled_bad" -ge 2 ]; then
  if [ "$RESTORE" = "1" ]; then
    say "auto-restoring the known-good config"
    "$ROOT/scripts/deploy_restore.sh"
  else
    say "--no-restore set; leaving production as it is"
  fi
  exit 1
fi

say "HEALTHY: $samples samples over ${MINUTES}m, $bad_total non-200 (all inside the settle window)"
exit 0
