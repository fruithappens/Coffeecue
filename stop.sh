#!/bin/bash
cd "$(dirname "$0")"
[ -f logs/backend.pid ] && kill "$(cat logs/backend.pid)" 2>/dev/null && rm -f logs/backend.pid && echo "CupQ Next stopped" || echo "not running"
