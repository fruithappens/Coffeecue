#!/usr/bin/env bash
# Read-only smoke test of a running CupQ copy. Safe against production: it
# only reads public pages, checks that protected ones still refuse, and pokes
# the printer endpoint without a MAC (which registers nothing). It never
# creates orders, sends texts or logs in.
#
# Usage: scripts/smoke_live.sh https://cupq.app
set -uo pipefail
BASE="${1:-https://cupq.app}"
pass=0; fail=0
ok()   { echo "  ok    $1"; pass=$((pass+1)); }
bad()  { echo "  FAIL  $1"; fail=$((fail+1)); }
code() { curl -s -o /dev/null -m 20 -w '%{http_code}' "$@"; }

echo "Smoke test: $BASE"
[ "$(code "$BASE/api/health")" = 200 ] && ok "health answers" || bad "health"
body=$(curl -s -m 20 "$BASE/")
echo "$body" | grep -q 'id="root"' && ok "app page loads" || bad "app page (/) missing root element"
[ "$(code "$BASE/run")" = 200 ] && ok "runner route serves the app" || bad "/run"
curl -s -m 20 "$BASE/api/app-version" | grep -q '"success": *true' && ok "version endpoint" || bad "app-version"
menu=$(curl -s -m 20 "$BASE/api/display/menu")
echo "$menu" | grep -q '"success": *true' && echo "$menu" | grep -q '"menu"' && ok "public menu" || bad "display/menu"
[ "$(code "$BASE/api/orders")" = 401 ] && ok "orders still need a login" || bad "orders did not refuse an anonymous request"
[ "$(code "$BASE/api/sms/meter")" = 401 ] && ok "text meter needs a login" || bad "sms/meter auth"
[ "$(code -X POST -H 'Content-Type: application/json' -d '{}' "$BASE/cloudprnt")" = 200 ] && ok "printer endpoint alive" || bad "cloudprnt"
curl -s -m 20 -D - -o /dev/null "$BASE/api/health" | grep -qi '^x-content-type-options: *nosniff' && ok "security headers on" || bad "security headers missing"
curl -s -m 20 -X OPTIONS "$BASE/api/public/demo-request" -H 'Origin: https://cupq.com.au' \
  -H 'Access-Control-Request-Method: POST' -H 'Access-Control-Request-Headers: content-type' -D - -o /dev/null \
  | grep -qi '^access-control-allow-origin: *https://cupq.com.au' && ok "website demo form allowed" || bad "demo-request CORS"

echo "$pass passed, $fail failed"
[ "$fail" = 0 ]
