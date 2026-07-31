#!/bin/bash
# Coffee Cue live mirror — the disaster-recovery tab.
# Reads bench creds the same way as run_bench_auth.sh (never printed).
set -e
cd "$(dirname "$0")"
if [ -f "$HOME/.coffeecue_bench_env" ]; then . "$HOME/.coffeecue_bench_env"
elif [ -f ".bench_env" ]; then . ".bench_env"
else echo "No bench env found (~/.coffeecue_bench_env)"; exit 1; fi
export BENCH_TARGET BENCH_USER BENCH_PASS
exec python3 live_mirror.py
