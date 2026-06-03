#!/usr/bin/env bash
# Overnight-fix verification suite.
# Run against the live Railway URL after the 3 commits land.
#
# Tests the changes Claude made overnight:
#   - Capability gate on POST /orders
#   - State-machine guards on /start, /complete, /pickup
#   - Backend single-source-of-truth for ready SMS (frontend removed)
#   - WS new-order emit (smoke-checked via creating an order)
#
# Uses phoneless orders so no SMS fires.
set -u

BASE="${BASE:-https://web-production-4cc9c.up.railway.app}"
PASS=0
FAIL=0

# ---------- helpers ----------
login() {
  curl -s --max-time 8 -X POST "$BASE/api/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"username":"coffeecue","password":"adminpassword"}' |
    python3 -c "import sys, json; print(json.load(sys.stdin).get('token',''))"
}

post() {
  local path=$1
  local body=$2
  curl -s --max-time 8 -X POST "$BASE$path" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "$body" \
    -w "\n__HTTP__:%{http_code}"
}

assert() {
  local desc=$1
  local got=$2
  local want=$3
  if [ "$got" = "$want" ]; then
    echo "  PASS  $desc  (got $got)"
    PASS=$((PASS + 1))
  else
    echo "  FAIL  $desc  (got $got, want $want)"
    FAIL=$((FAIL + 1))
  fi
}

# ---------- setup ----------
TOKEN=$(login)
[ -z "$TOKEN" ] && { echo "LOGIN FAILED"; exit 1; }
echo "Token captured."

# ---------- tests ----------

echo ""
echo "=========================================="
echo "  Capability gate: POST /api/orders"
echo "=========================================="

# Test 1: non-existent station_id rejected
RESP=$(post /api/orders '{"order_type":"walk-in","customer_name":"V1","coffee_type":"latte","milk_type":"oat","size":"medium","sugar":"None","station_id":99}')
CODE=$(echo "$RESP" | grep -oE '__HTTP__:[0-9]+' | tr -d '__HTTP__:' )
assert "station_id=99 rejected" "$CODE" "400"

# Test 2: milk not available at station rejected
RESP=$(post /api/orders '{"order_type":"walk-in","customer_name":"V2","coffee_type":"latte","milk_type":"coconut","size":"medium","sugar":"None","station_id":1}')
CODE=$(echo "$RESP" | grep -oE '__HTTP__:[0-9]+' | tr -d '__HTTP__:' )
assert "coconut at station 1 rejected" "$CODE" "400"

# Test 3: valid order accepted
RESP=$(post /api/orders '{"order_type":"walk-in","customer_name":"V3","coffee_type":"latte","milk_type":"oat","size":"medium","sugar":"None","station_id":1}')
CODE=$(echo "$RESP" | grep -oE '__HTTP__:[0-9]+' | tr -d '__HTTP__:' )
assert "valid oat latte at station 1 accepted" "$CODE" "200"

# Capture the valid order id for state-machine tests
VALID_ID=$(echo "$RESP" | python3 -c "import sys, json, re; t=sys.stdin.read(); body=re.sub(r'__HTTP__:\d+$', '', t).strip(); d=json.loads(body); print(d.get('data', {}).get('order_number', ''))")
echo "  (test order_number: $VALID_ID)"

echo ""
echo "=========================================="
echo "  State machine guards"
echo "=========================================="

# Test 4: normal lifecycle on the test order
post "/api/orders/$VALID_ID/start" "{}" > /dev/null
post "/api/orders/$VALID_ID/complete" "{}" > /dev/null
post "/api/orders/$VALID_ID/pickup" "{}" > /dev/null

# Now it's picked_up. Test that subsequent transitions behave correctly.

# Test 5: /start on a picked_up order — 409
RESP=$(post "/api/orders/$VALID_ID/start" "{}")
CODE=$(echo "$RESP" | grep -oE '__HTTP__:[0-9]+' | tr -d '__HTTP__:' )
assert "/start on picked_up returns 409" "$CODE" "409"

# Test 6: /complete on a picked_up order — 200 noop
RESP=$(post "/api/orders/$VALID_ID/complete" "{}")
CODE=$(echo "$RESP" | grep -oE '__HTTP__:[0-9]+' | tr -d '__HTTP__:' )
NOOP=$(echo "$RESP" | python3 -c "import sys, json, re; t=sys.stdin.read(); body=re.sub(r'__HTTP__:\d+$', '', t).strip(); d=json.loads(body); print(d.get('noop', False))" 2>/dev/null)
assert "/complete on picked_up returns 200" "$CODE" "200"
assert "/complete on picked_up has noop=true" "$NOOP" "True"

# Test 7: /pickup on a picked_up order — 200 noop
RESP=$(post "/api/orders/$VALID_ID/pickup" "{}")
CODE=$(echo "$RESP" | grep -oE '__HTTP__:[0-9]+' | tr -d '__HTTP__:' )
NOOP=$(echo "$RESP" | python3 -c "import sys, json, re; t=sys.stdin.read(); body=re.sub(r'__HTTP__:\d+$', '', t).strip(); d=json.loads(body); print(d.get('noop', False))" 2>/dev/null)
assert "/pickup on picked_up returns 200" "$CODE" "200"
assert "/pickup on picked_up has noop=true" "$NOOP" "True"

# Test 8: idempotent /complete — create fresh order, hit complete twice
RESP=$(post /api/orders '{"order_type":"walk-in","customer_name":"V8","coffee_type":"latte","milk_type":"oat","size":"medium","sugar":"None","station_id":1}')
ID2=$(echo "$RESP" | python3 -c "import sys, json, re; t=sys.stdin.read(); body=re.sub(r'__HTTP__:\d+$', '', t).strip(); d=json.loads(body); print(d.get('data', {}).get('order_number', ''))")
post "/api/orders/$ID2/start" "{}" > /dev/null
post "/api/orders/$ID2/complete" "{}" > /dev/null
# Second complete — should be noop
RESP=$(post "/api/orders/$ID2/complete" "{}")
NOOP=$(echo "$RESP" | python3 -c "import sys, json, re; t=sys.stdin.read(); body=re.sub(r'__HTTP__:\d+$', '', t).strip(); d=json.loads(body); print(d.get('noop', False))" 2>/dev/null)
assert "second /complete is noop (no duplicate SMS)" "$NOOP" "True"
# Cleanup
post "/api/orders/$ID2/pickup" "{}" > /dev/null

echo ""
echo "=========================================="
echo "  Health checks (should still be green)"
echo "=========================================="

for path in api/health api/health/full api/catalog/milk api/catalog/drink api/orders/pending api/orders/in-progress api/orders/completed; do
  CODE=$(curl -s --max-time 8 -o /dev/null -w "%{http_code}" "$BASE/$path" -H "Authorization: Bearer $TOKEN")
  if [ "$path" = "api/health" ] || [ "$path" = "api/health/full" ]; then
    assert "$path" "$CODE" "200"
  else
    # Authed endpoints might be 200 or 401 if token is wonky — accept 200 only
    assert "$path" "$CODE" "200"
  fi
done

echo ""
echo "=========================================="
echo "  Summary"
echo "=========================================="
TOTAL=$((PASS + FAIL))
echo "  $PASS / $TOTAL passed"
[ "$FAIL" -gt 0 ] && exit 1 || exit 0
