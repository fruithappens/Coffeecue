#!/bin/bash
# Rebuild the front end (needed after any change to "Barista Front End/src")
# and put it where Flask serves it from (static/), the same way the
# Dockerfile does for production.
cd "$(dirname "$0")/Barista Front End" && DISABLE_ESLINT_PLUGIN=true CI=false GENERATE_SOURCEMAP=false npm run build 2>&1 | grep -E "Compiled|Failed|main\.[a-f0-9]+\.js" || exit 1
cd .. && cp -R "Barista Front End/build/." static/ && echo "copied build -> static/  (restart with ./stop.sh && ./next.sh)"
