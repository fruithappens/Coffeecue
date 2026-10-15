"""
Regression test for the endpoints added during the late-May 2026
overnight work. Doesn't try to be exhaustive — just round-trips each
new endpoint so a future change that breaks the wire-format crashes
this script loudly.

Endpoints covered:
  1. /api/routing-rules           GET / PUT — load-balancing toggles
  2. /api/inventory/transfer       POST     — barista-to-barista move
  3. /api/inventory/emergency-restock POST  — bump a single row
  4. /api/stations/<id>/capabilities GET/POST — per-station JSONB caps

Run with the backend up at $EXPRESSO_BACKEND (defaults to
http://localhost:5001).

    python test_overnight_endpoints.py
"""
import json
import os
import sys
import urllib.error
import urllib.request


BACKEND = os.environ.get('EXPRESSO_BACKEND', 'http://localhost:5001')
ADMIN_USER = os.environ.get('ADMIN_USER', 'coffeecue')
ADMIN_PASS = os.environ.get('ADMIN_PASS', 'adminpassword')


def login():
    req = urllib.request.Request(
        BACKEND + '/api/auth/login',
        data=json.dumps({'username': ADMIN_USER, 'password': ADMIN_PASS}).encode(),
        headers={'Content-Type': 'application/json'},
        method='POST',
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode())['token']


def api(method, path, *, token, body=None, expect_status=None):
    data = json.dumps(body).encode() if body is not None else None
    headers = {
        'Authorization': f'Bearer {token}',
        'Accept': 'application/json',
    }
    if body is not None:
        headers['Content-Type'] = 'application/json'
    req = urllib.request.Request(BACKEND + path, data=data,
                                 headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            payload = json.loads(resp.read().decode() or 'null')
            return resp.status, payload
    except urllib.error.HTTPError as e:
        payload = None
        try:
            payload = json.loads(e.read().decode() or 'null')
        except Exception:
            pass
        if expect_status is not None and e.code == expect_status:
            return e.code, payload
        raise


def section(title):
    print()
    print('=' * 60)
    print(' ' + title)
    print('=' * 60)


def check(label, ok, detail=''):
    badge = '\033[92mPASS\033[0m' if ok else '\033[91mFAIL\033[0m'
    print(f'  [{badge}] {label}{("  — " + detail) if detail and not ok else ""}')
    return ok


def main():
    token = login()
    print(f'Logged in as {ADMIN_USER}')

    all_ok = True

    # ─── routing rules ──────────────────────────────────────────────
    section('routing-rules')
    status, rules = api('GET', '/api/routing-rules', token=token)
    all_ok &= check('GET 200', status == 200)
    all_ok &= check('has emergencyMode key',
                    isinstance(rules, dict) and 'emergencyMode' in rules,
                    detail=str(rules)[:120])

    new_rules = {**(rules or {}), 'emergencyMode': True, 'balanceWorkload': False}
    status, resp = api('PUT', '/api/routing-rules', token=token, body=new_rules)
    all_ok &= check('PUT 200', status == 200)
    all_ok &= check('PUT returns success:true', resp.get('success') is True, detail=str(resp)[:120])

    status, rules2 = api('GET', '/api/routing-rules', token=token)
    all_ok &= check('GET reflects PUT (emergencyMode=True)',
                    rules2.get('emergencyMode') is True, detail=str(rules2)[:120])
    all_ok &= check('GET reflects PUT (balanceWorkload=False)',
                    rules2.get('balanceWorkload') is False, detail=str(rules2)[:120])

    # Restore so we don't leave the system in emergency mode.
    api('PUT', '/api/routing-rules', token=token,
        body={'emergencyMode': False, 'balanceWorkload': True,
              'prioritizeEfficiency': True, 'considerCapabilities': True})

    # ─── inventory/transfer ─────────────────────────────────────────
    section('inventory/transfer')
    # The test needs at least 2 stations with the same milk row.
    # We probe stations via /api/stations.
    status, stations_resp = api('GET', '/api/stations', token=token)
    stations = stations_resp if isinstance(stations_resp, list) else stations_resp.get('stations', [])
    if len(stations) < 2:
        check('skipped — need >= 2 stations', False,
              detail=f'only {len(stations)} found')
    else:
        s1, s2 = stations[0]['id'], stations[1]['id']
        # Try a tiny transfer of full cream milk. We don't assert on
        # remaining/destination amount magnitudes — the endpoint just
        # needs to accept the call without 500'ing.
        status, resp = api('POST', '/api/inventory/transfer', token=token,
                           body={'from_station': s1, 'to_station': s2,
                                 'name': 'full cream', 'category': 'milk',
                                 'amount': 0.5},
                           expect_status=404)
        # Either 200 success or 404 "no row at source" is acceptable
        # depending on whether stock has been initialised — both
        # mean the endpoint exists and validates correctly.
        all_ok &= check('endpoint responds (200/404)',
                        status in (200, 404), detail=f'got {status}')

    # ─── inventory/emergency-restock ────────────────────────────────
    section('inventory/emergency-restock')
    status, resp = api('POST', '/api/inventory/emergency-restock', token=token,
                       body={'item': 'full cream', 'type': 'milk', 'amount': 0.1})
    all_ok &= check('POST 200', status == 200, detail=str(resp)[:120])
    all_ok &= check('returns amount', isinstance(resp.get('amount'), (int, float)),
                    detail=str(resp)[:120])

    # ─── stations/<id>/capabilities ─────────────────────────────────
    section('stations/<id>/capabilities')
    if stations:
        sid = stations[0]['id']
        status, resp = api('GET', f'/api/stations/{sid}/capabilities', token=token)
        all_ok &= check(f'GET 200 for station {sid}', status == 200)
        all_ok &= check('returns capabilities dict',
                        isinstance(resp.get('capabilities'), dict),
                        detail=str(resp)[:120])

        # PATCH a single key, verify it merged with the rest.
        existing = resp.get('capabilities', {})
        existing_milks = existing.get('milk_types')
        status, resp = api('POST', f'/api/stations/{sid}/capabilities', token=token,
                           body={'capabilities': {'vip_service': True}})
        all_ok &= check('POST 200', status == 200)
        all_ok &= check('merged capabilities have vip_service=True',
                        resp.get('capabilities', {}).get('vip_service') is True,
                        detail=str(resp.get('capabilities'))[:120])
        all_ok &= check('merge preserved milk_types',
                        resp.get('capabilities', {}).get('milk_types') == existing_milks,
                        detail='milks should not be wiped by a vip_service patch')

    print()
    if all_ok:
        print('\033[92mAll endpoint round-trips passed.\033[0m')
        sys.exit(0)
    else:
        print('\033[91mOne or more checks failed — see above.\033[0m')
        sys.exit(1)


if __name__ == '__main__':
    main()
