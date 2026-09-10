#!/bin/bash
# Serve ANY checkout of the app on :5001 against a throwaway clone of the
# copy's database, so a cutover slice can be put in front of the harnesses
# exactly the way the copy is.
#
#   slice_serve.sh <checkout-dir> <dbname>     start (stops whatever owns :5001 first)
#   slice_serve.sh stop                        stop
#
# Why a clone per run: the feature harnesses create orders and pin stations,
# and a slice branch built from main will run its own migrations (19 on a
# copy-shaped DB). Neither should touch cupq_next itself. `createdb -T` needs
# no connections on the template, which is one more reason runs are serial.
#
# The checkout gets the copy's .env with DATABASE_URL swapped, the copy's
# venv (requirements.txt is identical on main and next), and the copy's
# node_modules symlinked in (package.json is identical too). The frontend is
# built and copied to static/ for the server to serve; static/ is vestigial
# in the repo and MUST be reset (git checkout -- static) before any commit.
set -e
COPY=/Users/stevewf/cupq-next
kill_5001() {
  for pid in $(lsof -nP -tiTCP:5001 -sTCP:LISTEN 2>/dev/null); do kill "$pid" 2>/dev/null || true; done
  sleep 1
}
if [ "$1" = "stop" ]; then kill_5001; echo "stopped"; exit 0; fi
DIR="$1"; DB="$2"
[ -d "$DIR" ] || { echo "no such checkout: $DIR"; exit 1; }
[ -n "$DB" ] || { echo "usage: slice_serve.sh <checkout-dir> <dbname>"; exit 1; }

kill_5001
# Fresh clone of the copy's DB for this run.
if psql -lqt | cut -d'|' -f1 | grep -qw "$DB"; then dropdb "$DB"; fi
createdb -T cupq_next "$DB"
echo "db: $DB (cloned from cupq_next)"

# Environment: the copy's, pointed at the clone.
sed -E "s#^DATABASE_URL=.*#DATABASE_URL=postgresql://localhost/$DB?gssencmode=disable\&sslmode=disable#" "$COPY/.env" > "$DIR/.env"
grep -q "^DATABASE_URL=postgresql://localhost/$DB" "$DIR/.env" || { echo ".env rewrite failed"; exit 1; }

# Frontend: build in place, serve from static/.
FE="$DIR/Barista Front End"
[ -e "$FE/node_modules" ] || ln -s "$COPY/Barista Front End/node_modules" "$FE/node_modules"
( cd "$FE" && DISABLE_ESLINT_PLUGIN=true CI=false GENERATE_SOURCEMAP=false npm run build 2>&1 | grep -E "Compiled|Failed|error" | head -5 )
[ -d "$FE/build" ] || { echo "frontend build failed"; exit 1; }
mkdir -p "$DIR/static" && cp -R "$FE/build/." "$DIR/static/"

# Backend: the copy's venv, this checkout's code, UTC like Railway.
mkdir -p "$DIR/logs"
# stdin closed and fully detached: when this script's output is piped
# (`slice_serve.sh ... | tail`), a background child that still holds the
# pipe keeps the reader waiting forever after the script has finished.
( cd "$DIR" && TZ=UTC nohup "$COPY/venv/bin/python" run_server.py < /dev/null > "$DIR/logs/backend.log" 2>&1 & echo $! > "$DIR/logs/backend.pid" ) < /dev/null > /dev/null 2>&1
for i in $(seq 1 20); do sleep 1; curl -s -o /dev/null http://localhost:5001/api/health && break; done
if curl -s -o /dev/null http://localhost:5001/api/health; then
  echo "serving $DIR on http://localhost:5001 (db $DB)"
  echo "migrations recorded: $(psql -tAc 'select string_agg(version::text, chr(44) order by version) from schema_migrations' "$DB" 2>/dev/null)"
else
  echo "server did not answer; tail of log:"; tail -30 "$DIR/logs/backend.log"; exit 1
fi
