#!/bin/bash
# Rebuild the front end (needed after any change to "Barista Front End/src")
# and put it where Flask serves it from (static/), the same way the
# Dockerfile does for production.
cd "$(dirname "$0")/Barista Front End" || exit 1
# Undefined identifiers compile fine and crash at runtime (a cleanup once left
# the settings tab referencing a removed state setter). Catch them before the build.
UNDEF=$(npx eslint --no-eslintrc --parser @babel/eslint-parser --parser-options "requireConfigFile:false,babelOptions:{presets:['@babel/preset-react']}" --plugin react --rule 'react/jsx-no-undef: error' --rule 'no-undef: error' --env browser,es2021,node,jest "src/components/barista/**/*.js" "src/design/**/*.js" "src/components/barista/queue/*.js" 2>&1 | grep -cE "no-undef|jsx-no-undef")
if [ "$UNDEF" != "0" ]; then echo "BUILD BLOCKED: $UNDEF undefined identifier(s) -- run the eslint no-undef check to see them"; exit 1; fi
DISABLE_ESLINT_PLUGIN=true CI=false GENERATE_SOURCEMAP=false npm run build 2>&1 | grep -E "Compiled|Failed|main\.[a-f0-9]+\.js" | tee /tmp/cupq_build.log; grep -q "Failed" /tmp/cupq_build.log && { echo "BUILD FAILED -- nothing copied"; exit 1; }
cd .. && cp -R "Barista Front End/build/." static/ && echo "copied build -> static/  (restart with ./stop.sh && ./next.sh)"
