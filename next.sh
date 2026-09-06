#!/bin/bash
# CupQ Next -- start the TEST COPY: backend + the built front end on ONE port,
# exactly like production. Open http://localhost:5001 here, or the LAN address
# it prints on a phone/tablet/TV on the same Wi-Fi.
cd "$(dirname "$0")"
mkdir -p logs
if ! pg_isready -h localhost -q; then echo "Postgres is not running: brew services start postgresql@15"; exit 1; fi
if lsof -nP -iTCP:5001 -sTCP:LISTEN >/dev/null 2>&1; then echo "Port 5001 is busy. Already running? ./stop.sh first."; exit 1; fi
if [ ! -d "Barista Front End/build" ]; then echo "No front-end build yet: run ./build.sh first"; exit 1; fi
nohup ./venv/bin/python run_server.py > logs/backend.log 2>&1 &
echo $! > logs/backend.pid
IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "this-mac")
echo "CupQ Next (TEST COPY) starting ..."
for i in 1 2 3 4 5 6 7 8 9 10; do sleep 1; curl -s -o /dev/null http://localhost:5001/api/health && break; done
if curl -s -o /dev/null http://localhost:5001/api/health; then
  echo "backend: up"
  echo "  This Mac:              http://localhost:5001"
  echo "  Phone / tablet / TV:   http://$IP:5001   (same Wi-Fi)"
  echo "  Sign in: coffeecue / adminpassword   Logs: logs/backend.log   Stop: ./stop.sh"
else
  echo "backend did not answer -- see logs/backend.log"; tail -20 logs/backend.log
fi
