#!/usr/bin/env bash
# deploy_restore.sh — put production back on the last known-good serving
# configuration, fast, without needing the Railway dashboard.
#
# WHY THIS EXISTS
# Production deploys from `main`. There is no CLI here and no rollback
# button we can reach, so "restore" means: force the deploy config back to
# the known-good values, push, and wait for the site to answer again. On
# 2026-08-20 that round trip was done by hand three times under pressure;
# this is the same steps, in order, with the waiting built in.
#
#   ./scripts/deploy_restore.sh              # restore + wait for healthy
#   ./scripts/deploy_restore.sh --check      # report only, change nothing
#
# The known-good SERVING config is deliberately hard-coded rather than read
# from a file: the whole point is that it still works when the repo is in a
# state we do not trust.
set -uo pipefail

BASE="${EXPRESSO_URL:-https://web-production-4cc9c.up.railway.app}"
GOOD_START='python run_server.py'
GOOD_CMD='CMD ["python", "run_server.py"]'
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT" || exit 1

say() { printf '  %s\n' "$*"; }

health() { curl -s -m 10 -o /dev/null -w '%{http_code}' "$BASE/api/health" 2>/dev/null; }

# Healthy means healthy CONSISTENTLY. The gunicorn failure on 2026-08-20
# boot-served-died on a ~120s cycle, so a single 200 proves nothing — it
# just means you sampled during a good window.
settled() {
  local need="${1:-6}" gap="${2:-15}" ok=0 code
  for _ in $(seq 1 "$need"); do
    code=$(health)
    [ "$code" = "200" ] && ok=$((ok+1)) || ok=0
    printf '   %s health=%s (%d/%d consecutive)\n' "$(date -u +%H:%M:%S)" "${code:-000}" "$ok" "$need"
    [ "$ok" -ge "$need" ] && return 0
    sleep "$gap"
  done
  return 1
}

if [ "${1:-}" = "--check" ]; then
  say "URL:            $BASE"
  say "health now:     $(health)"
  say "main start cmd: $(git show origin/main:railway.json 2>/dev/null | grep -o '"startCommand": "[^"]*"')"
  say "local  start cmd: $(grep -o '"startCommand": "[^"]*"' railway.json 2>/dev/null)"
  exit 0
fi

say "restoring production to the known-good server config"
git fetch -q origin || { say "FETCH FAILED — check the network"; exit 1; }
BR="restore/known-good-$(date -u +%Y%m%d-%H%M%S)"
git checkout -q -B "$BR" origin/main || exit 1

python3 - "$GOOD_START" <<'PY'
import json, pathlib, re, sys
cmd = sys.argv[1]
j = pathlib.Path('railway.json'); c = json.loads(j.read_text())
c.setdefault('deploy', {})['startCommand'] = cmd
j.write_text(json.dumps(c, indent=2) + '\n')
t = pathlib.Path('railway.toml')
if t.exists():
    t.write_text(re.sub(r'^startCommand = .*$', f'startCommand = "{cmd}"',
                        t.read_text(), flags=re.M))
d = pathlib.Path('Dockerfile'); x = d.read_text()
for line in x.splitlines():
    if line.startswith('CMD '):
        x = x.replace(line, 'CMD ["python", "run_server.py"]')
        break
d.write_text(x)
PY

if git diff --quiet; then
  say "deploy config already matches known-good"
  say "forcing a redeploy anyway — Railway has silently skipped deploys before"
  git commit -q --allow-empty -m "Restore: force redeploy of the known-good server config"
else
  git add railway.json railway.toml Dockerfile 2>/dev/null
  git commit -q -m "Restore: put production back on the known-good server config

Automated restore. Serving config forced back to 'python run_server.py'."
fi

git push -q origin "HEAD:main" || { say "PUSH FAILED — restore did NOT happen"; exit 1; }
say "pushed to main; waiting for the deploy"
sleep 25

if settled 6 15; then
  say "RESTORED — healthy on 6 consecutive checks"
  exit 0
fi
say "STILL NOT HEALTHY after the restore push."
say "Open Railway > Deployments and redeploy the latest commit by hand."
exit 1
