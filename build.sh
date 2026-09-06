#!/bin/bash
# Rebuild the front end (needed after any change to "Barista Front End/src").
cd "$(dirname "$0")/Barista Front End" && DISABLE_ESLINT_PLUGIN=true CI=false GENERATE_SOURCEMAP=false npm run build 2>&1 | grep -E "Compiled|Failed|main\.[a-f0-9]+\.js" ; cd .. && echo "restart with ./stop.sh && ./next.sh"
