#!/usr/bin/env python3
"""Coffee Cue LIVE MIRROR — the disaster-recovery tab.

Runs on the operator's laptop during an event. Every POLL_SECONDS it
pulls the live queue and rewrites two LOCAL files:

  testbench/live_mirror/orders.csv   — spreadsheet-ready (Excel opens it)
  testbench/live_mirror/board.html   — keep this open in a browser tab

If the app dies mid-event, the tab is holding the last-known queue —
timestamp, order, station, status — under a red "APP UNREACHABLE"
banner, and baristas keep serving from it. The mirror lives OUTSIDE the
app on purpose: a backup that dies with the thing it's backing up isn't
one.

Optional Google Sheets feed: set SHEET_WEBHOOK_URL to a Google Apps
Script web-app URL (template in testbench/sheets_webhook_template.gs —
one-time 5-minute setup in the operator's own Google account) and every
poll also posts the current queue there, so the sheet survives even
this laptop dying.

Usage:
    bash testbench/run_live_mirror.sh          # uses bench creds env
"""
from __future__ import annotations

import csv
import datetime as dt
import html
import json
import os
import sys
import time
import urllib.request

BASE = os.environ.get('BENCH_TARGET', '').rstrip('/')
USER = os.environ.get('BENCH_USER', '')
PASS = os.environ.get('BENCH_PASS', '')
SHEET_WEBHOOK_URL = os.environ.get('SHEET_WEBHOOK_URL', '')
POLL_SECONDS = int(os.environ.get('MIRROR_POLL_SECONDS', '10'))

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'live_mirror')
CSV_PATH = os.path.join(OUT_DIR, 'orders.csv')
HTML_PATH = os.path.join(OUT_DIR, 'board.html')

_token = None


def _req(method, path, body=None, auth=True, timeout=15):
    req = urllib.request.Request(
        BASE + path, method=method,
        headers={'Content-Type': 'application/json',
                 **({'Authorization': f'Bearer {_token}'} if auth and _token else {})},
        data=json.dumps(body).encode() if body is not None else None)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def login():
    global _token
    out = _req('POST', '/api/auth/login',
               {'username': USER, 'password': PASS}, auth=False)
    _token = out.get('token')
    return bool(_token)


def fetch_queue():
    """pending (authed) + inProgress/ready (public display feed)."""
    rows = []

    def add(lst, status):
        for o in lst or []:
            rows.append({
                'order': str(o.get('order_number') or o.get('orderNumber')
                             or o.get('id') or ''),
                'status': status,
                'station': str(o.get('station_id') or o.get('stationId') or ''),
                'name': str(o.get('customerName') or o.get('customer_name') or ''),
                'drink': ' '.join(str(p) for p in (
                    o.get('size') or '', o.get('coffeeType') or o.get('coffee_type') or '') if p),
                'milk': str(o.get('milkType') or o.get('milk_type') or ''),
                'created': str(o.get('createdAt') or o.get('created_at')
                               or o.get('completedAt') or ''),
            })
    try:
        pend = _req('GET', '/api/orders/pending')
        add(pend.get('data') or pend.get('orders') or [], 'PENDING')
    except Exception:
        # token may have expired mid-event — one silent re-login attempt
        try:
            login()
            pend = _req('GET', '/api/orders/pending')
            add(pend.get('data') or pend.get('orders') or [], 'PENDING')
        except Exception:
            raise
    disp = _req('GET', '/api/display/orders', auth=False)
    wrap = disp.get('orders') or {}
    add(wrap.get('inProgress'), 'MAKING')
    add(wrap.get('ready'), 'READY')
    return rows


def write_csv(rows, synced_at):
    with open(CSV_PATH, 'w', newline='') as f:
        w = csv.writer(f)
        w.writerow(['synced_at', 'order', 'status', 'station', 'name',
                    'drink', 'milk', 'created'])
        for r in rows:
            w.writerow([synced_at, r['order'], r['status'], r['station'],
                        r['name'], r['drink'], r['milk'], r['created']])


STATUS_COLOR = {'PENDING': '#2563eb', 'MAKING': '#d97706', 'READY': '#16a34a'}


def write_html(rows, synced_at, app_ok, down_since):
    trs = '\n'.join(
        f"<tr><td class='num'>#{html.escape(r['order'])}</td>"
        f"<td><span class='pill' style='background:{STATUS_COLOR.get(r['status'], '#666')}'>"
        f"{r['status']}</span></td>"
        f"<td>{html.escape(r['station'])}</td>"
        f"<td>{html.escape(r['name'])}</td>"
        f"<td>{html.escape(r['drink'])}"
        f"{(' · ' + html.escape(r['milk'])) if r['milk'] else ''}</td></tr>"
        for r in rows)
    banner = '' if app_ok else (
        f"<div class='down'>&#9888; APP UNREACHABLE since {down_since} — "
        f"this is the LAST KNOWN queue. Serve from here; tick orders off on paper.</div>")
    doc = f"""<meta charset='utf-8'>
<meta http-equiv='refresh' content='{POLL_SECONDS // 2 or 5}'>
<title>Coffee Cue LIVE MIRROR</title>
<style>
 body{{font-family:system-ui,sans-serif;margin:16px;background:#f8fafc}}
 h1{{font-size:20px;margin:0 0 4px}}
 .sync{{color:#475569;font-size:14px;margin-bottom:12px}}
 .down{{background:#dc2626;color:#fff;font-size:22px;font-weight:700;
        padding:14px;border-radius:10px;margin:10px 0}}
 table{{border-collapse:collapse;width:100%;background:#fff;border-radius:10px;
        overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1)}}
 th,td{{padding:9px 12px;text-align:left;border-bottom:1px solid #e2e8f0;font-size:16px}}
 th{{background:#0f172a;color:#fff;font-size:13px;text-transform:uppercase}}
 .num{{font-weight:800;font-size:18px}}
 .pill{{color:#fff;padding:2px 10px;border-radius:99px;font-size:13px;font-weight:700}}
 .stale{{background:#dc2626;color:#fff;padding:10px;border-radius:8px;
         font-size:18px;font-weight:700;display:none;margin:10px 0}}
</style>
<h1>Coffee Cue — live mirror (disaster tab)</h1>
<div class='sync'>Last sync <b>{synced_at}</b> · {len(rows)} live order(s) ·
 refreshes every {POLL_SECONDS // 2 or 5}s</div>
<div class='stale' id='stale'>&#9888; This mirror hasn't updated in over a minute —
 the mirror script on this laptop may have stopped. Data below is the last capture.</div>
{banner}
<table><tr><th>Order</th><th>Status</th><th>Station</th><th>Name</th><th>Drink</th></tr>
{trs if trs else "<tr><td colspan='5' style='color:#64748b'>Queue is empty.</td></tr>"}
</table>
<script>
 var rendered = {int(time.time() * 1000)};
 setInterval(function () {{
   if (Date.now() - rendered > 75000)
     document.getElementById('stale').style.display = 'block';
 }}, 5000);
</script>"""
    with open(HTML_PATH, 'w') as f:
        f.write(doc)


def push_sheet(rows, synced_at):
    if not SHEET_WEBHOOK_URL:
        return
    try:
        req = urllib.request.Request(
            SHEET_WEBHOOK_URL, method='POST',
            headers={'Content-Type': 'application/json'},
            data=json.dumps({'synced_at': synced_at, 'rows': rows}).encode())
        urllib.request.urlopen(req, timeout=10).read()
    except Exception as e:
        print(f"  sheet push failed (mirror still fine): {e}")


def main():
    if not (BASE and USER and PASS):
        print('Set BENCH_TARGET/BENCH_USER/BENCH_PASS (run via run_live_mirror.sh).')
        return 2
    os.makedirs(OUT_DIR, exist_ok=True)
    if not login():
        print('Login failed.')
        return 2
    print(f"Mirroring {BASE} every {POLL_SECONDS}s")
    print(f"  Open in a browser tab:  file://{HTML_PATH}")
    print(f"  Spreadsheet copy:       {CSV_PATH}")
    if SHEET_WEBHOOK_URL:
        print('  Google Sheet feed:      ON')
    down_since = None
    last_rows = []
    while True:
        now = dt.datetime.now().strftime('%H:%M:%S')
        try:
            rows = fetch_queue()
            last_rows = rows
            down_since = None
            write_csv(rows, now)
            write_html(rows, now, app_ok=True, down_since=None)
            push_sheet(rows, now)
            print(f"[{now}] synced {len(rows)} order(s)")
        except KeyboardInterrupt:
            raise
        except Exception as e:
            if down_since is None:
                down_since = now
            write_html(last_rows, now, app_ok=False, down_since=down_since)
            print(f"[{now}] APP UNREACHABLE ({e}) — tab shows last known queue")
        try:
            time.sleep(POLL_SECONDS)
        except KeyboardInterrupt:
            print('\nMirror stopped.')
            return 0


if __name__ == '__main__':
    sys.exit(main())
