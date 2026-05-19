"""
Regression test for the persistence + data-shape work in this round.

Covers:
  1. /api/barista-profiles GET → empty {}, PUT one → GET returns it
  2. /api/station-defaults    GET → empty {}, PUT a map → GET returns it
  3. /api/sms/templates       GET → 200 with {templates: {...}}
  4. /api/orders/pending      response shape — must include the
     camelCase aliases the Barista UI relies on (batchGroup,
     promisedTime, waitTime, milkType, stationId, customerName,
     coffeeType, vip). Previously these were snake_case only and
     batch-grouping silently never triggered.
"""
import json
import os
import sys
import urllib.parse
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


def api(method, path, *, token, body=None):
    data = json.dumps(body).encode() if body is not None else None
    headers = {
        'Authorization': f'Bearer {token}',
        'Accept': 'application/json',
    }
    if body is not None:
        headers['Content-Type'] = 'application/json'
    req = urllib.request.Request(BACKEND + path, data=data,
                                 headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=10) as resp:
        return resp.status, json.loads(resp.read().decode())


def sms(phone, body):
    data = urllib.parse.urlencode({'From': phone, 'Body': body, 'To': '+15550000000'}).encode()
    req = urllib.request.Request(
        BACKEND + '/sms', data=data,
        headers={'Content-Type': 'application/x-www-form-urlencoded'},
        method='POST',
    )
    urllib.request.urlopen(req, timeout=10).read()


def db_query(sql):
    import psycopg2
    db_url = os.environ.get(
        'DATABASE_URL', 'postgresql://localhost/expresso_test_1779151198')
    conn = psycopg2.connect(db_url)
    try:
        cur = conn.cursor()
        cur.execute(sql)
        try:
            return cur.fetchall()
        except psycopg2.ProgrammingError:
            return None
    finally:
        conn.commit()
        conn.close()


def step(label, fn):
    print(f"\n▶ {label}")
    try:
        fn()
    except AssertionError as e:
        print(f"  ✗ FAIL: {e}")
        return False
    except Exception as e:
        print(f"  ✗ ERROR: {type(e).__name__}: {e}")
        return False
    print(f"  ✓ ok")
    return True


# ---- Scenarios ----------------------------------------------------------


def scenario_barista_profiles_round_trip():
    """Clear, save one, fetch back."""
    db_query("DELETE FROM settings WHERE key = 'barista_profiles'")
    token = login()
    status, payload = api('GET', '/api/barista-profiles', token=token)
    assert status == 200 and payload == {}, f"empty fetch unexpected: {payload}"
    status, _ = api('PUT', '/api/barista-profiles/Alex', token=token,
                     body={'skillLevel': 'expert', 'specializations': ['latte art']})
    assert status == 200, f"PUT failed: {status}"
    status, payload = api('GET', '/api/barista-profiles', token=token)
    assert status == 200, f"GET after save failed: {status}"
    assert payload.get('Alex', {}).get('skillLevel') == 'expert', \
        f"profile not saved correctly: {payload}"


def scenario_station_defaults_round_trip():
    db_query("DELETE FROM settings WHERE key = 'station_defaults'")
    token = login()
    status, payload = api('GET', '/api/station-defaults', token=token)
    assert status == 200 and payload == {}, f"empty fetch unexpected: {payload}"
    body = {
        '1': {'coffeeType': 'Latte', 'milkType': 'oat', 'size': 'medium'},
        '2': {'coffeeType': 'Espresso', 'size': 'small'},
    }
    status, payload = api('PUT', '/api/station-defaults', token=token, body=body)
    assert status == 200 and payload.get('success') is True, \
        f"PUT failed: {payload}"
    assert payload.get('station_count') == 2
    status, payload = api('GET', '/api/station-defaults', token=token)
    assert payload.get('1', {}).get('milkType') == 'oat', \
        f"station 1 default not saved: {payload}"
    assert payload.get('2', {}).get('coffeeType') == 'Espresso', \
        f"station 2 default not saved: {payload}"


def scenario_branding_settings_round_trip():
    db_query("DELETE FROM settings WHERE key = 'branding_settings'")
    token = login()
    status, payload = api('GET', '/api/settings/branding', token=token)
    assert status == 200, f"empty GET: {payload}"
    assert payload.get('settings') == {}, f"expected empty, got {payload}"

    status, payload = api('PUT', '/api/settings/branding', token=token,
                          body={'settings': {'clientName': 'Acme Co',
                                              'companyName': 'Acme Inc'}})
    assert status == 200 and payload.get('success') is True

    status, payload = api('GET', '/api/settings/branding', token=token)
    assert payload['settings'].get('clientName') == 'Acme Co', \
        f"clientName not saved: {payload}"


def scenario_event_stock_round_trip():
    db_query("DELETE FROM settings WHERE key = 'event_stock_levels'")
    token = login()
    status, payload = api('GET', '/api/event-stock', token=token)
    assert status == 200 and payload == {}, f"expected empty, got {payload}"

    body = {'milk': {'oat': {'quantity': 50, 'unit': 'L'}}}
    status, payload = api('PUT', '/api/event-stock', token=token, body=body)
    assert status == 200 and payload.get('success') is True

    status, payload = api('GET', '/api/event-stock', token=token)
    assert payload.get('milk', {}).get('oat', {}).get('quantity') == 50, \
        f"oat quantity not saved: {payload}"


def scenario_add_station_preserves_name():
    """Regression for the 'Add Station drops name/location' bug.
    Confirm a POST that includes name/location actually persists
    them (used to silently drop them)."""
    token = login()
    # Find the next available id so we don't collide
    db_query("DELETE FROM station_stats WHERE station_id > 100")
    body = {
        'station_id': 101,
        'name': 'Persistence Lobby',
        'location': 'Main Hall',
    }
    status, payload = api('POST', '/api/stations', token=token, body=body)
    assert status == 201, f"create failed: {status} {payload}"

    rows = db_query("SELECT notes, equipment_notes FROM station_stats WHERE station_id = 101")
    assert rows, "station not in DB"
    notes, equipment_notes = rows[0]
    assert notes == 'Persistence Lobby', f"name not saved: {notes!r}"
    assert equipment_notes == 'Main Hall', f"location not saved: {equipment_notes!r}"
    db_query("DELETE FROM station_stats WHERE station_id = 101")


def scenario_sms_templates_shape():
    token = login()
    status, payload = api('GET', '/api/sms/templates', token=token)
    assert status == 200, f"sms/templates HTTP {status}"
    assert payload.get('status') == 'success', f"unexpected payload: {payload}"
    assert isinstance(payload.get('templates'), dict), \
        f"templates should be dict: {payload}"


def scenario_pending_orders_data_shape():
    """Place one order, fetch /api/orders/pending, verify it has every
    camelCase alias the Barista UI relies on."""
    # Clean slate
    db_query("DELETE FROM orders")
    db_query("DELETE FROM conversation_states")
    db_query("DELETE FROM sms_messages")
    db_query("ALTER SEQUENCE order_number_seq RESTART WITH 1")

    phone = '+15558887700'
    for line in ['hi', 'ShapeTest', 'latte for station 1', 'full cream',
                 'medium', '1', 'YES']:
        sms(phone, line)

    token = login()
    status, payload = api('GET', '/api/orders/pending', token=token)
    assert status == 200, f"pending fetch HTTP {status}: {payload}"
    orders = payload.get('orders') or []
    assert orders, f"no pending order: {payload}"
    o = orders[0]
    required_camel = ['batchGroup', 'promisedTime', 'waitTime', 'milkType',
                      'stationId', 'customerName', 'coffeeType', 'vip']
    missing = [k for k in required_camel if k not in o]
    assert not missing, \
        f"pending order missing camelCase keys: {missing}\nfull order: {o}"
    print(f"    pending order has all camelCase aliases: {sorted(required_camel)}")
    assert o['batchGroup'] in (None, '') or isinstance(o['batchGroup'], str), \
        f"batchGroup wrong type: {o.get('batchGroup')!r}"
    # promisedTime is the floor we just added so the time-pressure bar
    # has a non-zero denominator.
    assert isinstance(o['promisedTime'], (int, float)) and o['promisedTime'] > 0, \
        f"promisedTime should be a positive number: {o['promisedTime']!r}"


def main():
    print(f"backend={BACKEND}")
    passed = failed = 0
    for label, fn in [
        ('barista-profiles round trip',     scenario_barista_profiles_round_trip),
        ('station-defaults round trip',     scenario_station_defaults_round_trip),
        ('branding settings round trip',    scenario_branding_settings_round_trip),
        ('event-stock round trip',          scenario_event_stock_round_trip),
        ('add station preserves name + location', scenario_add_station_preserves_name),
        ('sms/templates returns expected shape', scenario_sms_templates_shape),
        ('pending order has all camelCase aliases', scenario_pending_orders_data_shape),
    ]:
        if step(label, fn):
            passed += 1
        else:
            failed += 1
    print(f"\n{passed} passed, {failed} failed")
    return 0 if failed == 0 else 1


if __name__ == '__main__':
    sys.exit(main())
