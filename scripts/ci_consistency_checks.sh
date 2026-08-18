#!/usr/bin/env bash
#
# Consistency guardrails — static checks for the *class* of bug that kept
# slipping into production: the same fact (e.g. "is a station open?") read from
# the wrong field or a different store in different screens, so views disagree.
#
# These are cheap greps, no DB/server needed. Each check prints PASS/FAIL and
# the offending lines. The script exits non-zero if ANY check fails, which (with
# branch protection on) blocks the merge before it can auto-deploy to an event.
#
# Add new rules as new "check_*" blocks. Keep them low-false-positive.

set -uo pipefail

SRC="Barista Front End/src"
FAIL=0

note() { printf '\n\033[1m%s\033[0m\n' "$1"; }
ok()   { printf '  \033[32m✓ %s\033[0m\n' "$1"; }
bad()  { printf '  \033[31m✗ %s\033[0m\n' "$1"; FAIL=1; }

# ---------------------------------------------------------------------------
# Check 1: stations must use `status` (active/maintenance/inactive), NEVER the
# phantom `is_active` field. The stations API returns `status`; `is_active`
# silently reads undefined → "always inactive / always 0" bugs (hit the Support
# Operations tab and PredictiveIntelligence). Users legitimately have is_active,
# so we only flag lines that mention a station, and skip comment lines.
# ---------------------------------------------------------------------------
note "Check 1: stations use status, not the phantom is_active field"
hits=$(grep -rnE "is_active" "$SRC" --include='*.js' --include='*.jsx' 2>/dev/null \
  | grep -iE "station" \
  | grep -vE ":[0-9]+:[[:space:]]*//" \
  | grep -vE ":[0-9]+:[[:space:]]*\*" \
  || true)
if [ -n "$hits" ]; then
  bad "station code uses is_active — use status === 'active' instead:"
  printf '%s\n' "$hits" | sed 's/^/      /'
else
  ok "none"
fi

# ---------------------------------------------------------------------------
# Check 2: the public Display screen must NOT read display settings from the
# auth-gated useSettings() — it has no login, so those come back empty. Display
# content/appearance must be read from the public /display/config (config.*).
# Flags `settings?.display...` or `settings?.show...` in DisplayScreen.js.
# ---------------------------------------------------------------------------
note "Check 2: DisplayScreen reads settings from public config, not the auth-gated hook"
disp="$SRC/components/display/DisplayScreen.js"
if [ -f "$disp" ]; then
  # Specific appearance/content keys only — NOT settings?.displaySettings
  # (the legitimate authenticated in-app merge) or displayTimeout.
  hits=$(grep -nE "settings\?\.(displayTheme|displayFontSize|displayZoom|displayRotation|displayMode|showCompletedOrders|showWaitTimes|showNameOnDisplay|showOrderDetails)" "$disp" 2>/dev/null \
    | grep -vE ":[0-9]+:[[:space:]]*//" \
    | grep -vE ":[0-9]+:[[:space:]]*\*" \
    || true)
  if [ -n "$hits" ]; then
    bad "DisplayScreen reads display settings from useSettings (won't reach a public display) — use config.* from /display/config:"
    printf '%s\n' "$hits" | sed 's/^/      /'
  else
    ok "none"
  fi
else
  ok "DisplayScreen.js not found (skipped)"
fi


# ---------------------------------------------------------------------------
# Check 4: SQL must not write columns the orders table does not have.
#
# Every emergency control that mutated orders wrote `notes = '...'`. There is
# no `notes` column — it is `barista_notes`. So "Stop All Operations",
# "Resume Operations" and "Clear ALL Queues" all returned HTTP 500 and did
# NOTHING, and nobody knew until they were tested. A dead button in the
# emergency panel is worse than no button: it is discovered mid-crisis.
#
# The check greps for writes to `orders` naming a column that is not in the
# schema. Extend ORDERS_PHANTOM as new near-miss names appear.
# ---------------------------------------------------------------------------
note "Check 4: SQL does not write phantom columns on the orders table"
ORDERS_PHANTOM='notes|customer_name|drink|order_status'
hits=$(grep -rnE "UPDATE[[:space:]]+orders[[:space:]]+SET" routes/ services/ --include='*.py' -A 2 2>/dev/null \
  | grep -E "(^|[^_a-z])($ORDERS_PHANTOM)[[:space:]]*=" \
  | grep -vE "barista_notes" \
  | grep -vE "^[^:]*:[0-9]+[:-][[:space:]]*#" \
  || true)
if [ -n "$hits" ]; then
  bad "SQL writes a column the orders table does not have (it is barista_notes, not notes):"
  printf '%s\n' "$hits" | sed 's/^/      /'
else
  ok "none"
fi

printf '\n'
if [ "$FAIL" -ne 0 ]; then
  echo "Consistency checks FAILED — see above. These guard against the 'two views of the same fact disagree' bug class."
  exit 1
fi
echo "All consistency checks passed."
