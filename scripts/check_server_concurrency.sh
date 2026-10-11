#!/usr/bin/env bash
# Does one stuck request stall the whole server?
#
# The August 2026 outages were exactly that: a single blocking call held the
# only worker and every other request queued behind it. run_server.py now
# monkey-patches eventlet first and makes psycopg2 cooperative (psycogreen),
# and Socket.IO runs eventlet's WSGI server, not the development server.
# This script proves it still holds -- run it against a LOCAL or STAGING copy
# (never production: it locks the orders table for 8 seconds).
#
# Usage: DB_URL=postgres://...copy... BASE=http://localhost:5001 TOKEN=<admin JWT> \
#        scripts/check_server_concurrency.sh
set -euo pipefail
: "${DB_URL:?set DB_URL to the copy's database}"
: "${BASE:=http://localhost:5001}"
: "${TOKEN:?set TOKEN to an admin JWT for that copy}"
case "$DB_URL" in *railway*|*rlwy*) echo "Refusing: DB_URL looks like production"; exit 2;; esac

echo "Server header (should NOT say Werkzeug):"
curl -s -D - -o /dev/null "$BASE/api/health" | grep -i '^server' || echo "  (none: eventlet)"

psql "$DB_URL" -c "BEGIN; LOCK TABLE orders IN ACCESS EXCLUSIVE MODE; SELECT pg_sleep(8); COMMIT;" >/dev/null 2>&1 &
sleep 1
curl -s -m 20 -o /dev/null -w "orders (waits on the lock): %{http_code} %{time_total}s\n" \
  -H "Authorization: Bearer $TOKEN" "$BASE/api/orders" &
sleep 0.5
fail=0
for i in 1 2 3; do
  t=$(curl -s -m 20 -o /dev/null -w "%{time_total}" "$BASE/api/health")
  echo "health while orders is stuck: ${t}s"
  awk -v t="$t" 'BEGIN{exit !(t>1)}' && fail=1
done
wait
if [ "$fail" = 1 ]; then echo "FAIL: other requests stalled behind one stuck request"; exit 1; fi
echo "PASS: the server kept answering while one request was stuck"
