#!/bin/bash
# The fake camera feed for the badge harnesses: a QR holding "badge-test-1"
# (the mirror row the harnesses insert), as a Y4M Chrome can play through
# --use-file-for-fake-video-capture. /tmp gets swept by macOS after three
# days, so this is rerun whenever /tmp/badge.y4m is missing.
set -e
OUT=${1:-/tmp/badge.y4m}
PNG=$(mktemp /tmp/badgeXXXXXX).png
"$(dirname "$0")/../../venv/bin/python" - "$PNG" <<'PY'
import sys, qrcode
img = qrcode.make("badge-test-1", box_size=14, border=6).convert("RGB")
img = img.resize((720, 720))
canvas = __import__('PIL.Image', fromlist=['Image']).new("RGB", (1280, 720), "white")
canvas.paste(img, (280, 0))
canvas.save(sys.argv[1])
PY
ffmpeg -loglevel error -y -loop 1 -i "$PNG" -t 8 -r 15 -pix_fmt yuv420p -s 1280x720 "$OUT"
rm -f "$PNG"
ls -la "$OUT" | awk '{print $5" bytes -> "$9}'
