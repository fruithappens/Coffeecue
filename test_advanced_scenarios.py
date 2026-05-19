"""
Advanced scenario tests — features the operator was unsure about.

  1. VIP code via SMS → order marked is_vip → routed to a VIP-capable
     station → queue_priority = 1
  2. Friend order with mixed milks (latte+oat for me, latte+soy for
     friend) → each routed to a station that actually has that milk.
     The audit said this works; we want a regression net.
  3. Completed orders endpoint actually filters by ?station_id=N
     (the operator's "Station 1 shows everyone else's completions"
     bug). Verify my fix in commit 47079b3.
  4. A station that DOESN'T have a milk type rejects the order with
     a helpful message + offers stations that do have it.

These all run against the real backend over HTTP — no mocks. Backend
must be on :5001, Postgres seeded with milk inventory.
"""
import os
import sys
import json
import urllib.parse
import urllib.request
import urllib.error

BACKEND = os.environ.get('EXPRESSO_BACKEND', 'http://localhost:5001')
ADMIN_USER = os.environ.get('ADMIN_USER', 'coffeecue')
ADMIN_PASS = os.environ.get('ADMIN_PASS', 'adminpassword')
VIP_CODE = os.environ.get('VIP_CODE', 'VFQ922')


def sms(phone, body):
    url = BACKEND + '/sms'
    data = urllib.parse.urlencode(
        {'From': phone, 'Body': body, 'To': '+15550000000'}).encode()
    req = urllib.request.Request(url, data=data, method='POST',
                                 headers={'Content-Type': 'application/x-www-form-urlencoded'})
    with urllib.request.urlopen(req, timeout=10) as resp:
        body = resp.read().decode()
    # Extract <Message> body from TwiML.
    open_tag = body.find('<Message>')
    close_tag = body.find('</Message>')
    if open_tag == -1 or close_tag == -1:
        return body
    return body[open_tag + len('<Message>'):close_tag].strip()


def api_get(path, token):
    req = urllib.request.Request(
        BACKEND + path,
        headers={'Authorization': f'Bearer {token}', 'Accept': 'application/json'},
        method='GET',
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode()


def api_post_orders_action(order_number, action, token):
    """POST /api/orders/<order_number>/<action> (start, complete, etc.)."""
    url = BACKEND + f'/api/orders/{urllib.parse.quote(order_number)}/{action}'
    req = urllib.request.Request(
        url,
        data=b'{}',
        method='POST',
        headers={
            'Authorization': f'Bearer {token}',
            'Content-Type': 'application/json',
        },
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        return resp.status, json.loads(resp.read().decode())


def login():
    url = BACKEND + '/api/auth/login'
    req = urllib.request.Request(
        url,
        data=json.dumps({'username': ADMIN_USER, 'password': ADMIN_PASS}).encode(),
        headers={'Content-Type': 'application/json'},
        method='POST',
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode())['token']


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


# ---- Scenario 1: VIP code via SMS ---------------------------------------


def scenario_vip():
    """Customer texts the VIP code, then orders.

    Expectation:
      - The bot recognises the VIP code and acknowledges
      - Subsequent order is committed with queue_priority = 1
      - If a VIP-capable station exists, the order routes there
    """
    phone = '+15554441001'
    reply = sms(phone, VIP_CODE)
    print(f"    bot reply to VIP code: {reply[:140]!r}")
    assert 'vip' in reply.lower() and 'activate' in reply.lower(), \
        f"VIP code not acknowledged: {reply!r}"

    # VIP flow skips the name step and goes straight to coffee type.
    sms(phone, 'large latte for station 1')
    sms(phone, 'full cream')
    sms(phone, 'medium')
    sms(phone, '1')
    final = sms(phone, 'YES')
    print(f"    confirm: {final[:160]!r}")

    rows = db_query(
        f"SELECT order_number, queue_priority, station_id, "
        f"       order_details->>'vip' AS vip_flag "
        f"FROM orders WHERE phone='{phone}'")
    assert rows, "VIP order not created"
    order_number, priority, station_id, vip_flag = rows[0]
    print(f"    DB: order={order_number} priority={priority} station={station_id} vip_flag={vip_flag}")
    assert priority == 1, f"expected queue_priority=1 for VIP, got {priority}"


# ---- Scenario 2: Friend order with mixed milks --------------------------


def scenario_friend_mixed_milks():
    """Customer orders oat latte; friend wants soy latte.

    Make station 3 the only station with both oat AND soy by setting
    capabilities at test setup. Verify each coffee routes to a station
    that actually has the requested milk.
    """
    # Setup: each station gets a different milk specialty so we can
    # see whether routing respects per-coffee milk.
    db_query("""
        UPDATE station_stats
        SET capabilities = jsonb_set(
            COALESCE(capabilities, '{}'::jsonb),
            '{milk_types}',
            CASE
                WHEN station_id = 1 THEN '["full cream","skim"]'::jsonb
                WHEN station_id = 2 THEN '["full cream","skim","oat"]'::jsonb
                WHEN station_id = 3 THEN '["full cream","skim","soy","almond","oat","lactose free"]'::jsonb
            END
        )
    """)

    phone = '+15554442002'
    sms(phone, 'hi')
    sms(phone, 'Pair')
    sms(phone, 'large oat latte')
    sms(phone, 'medium')
    sms(phone, '1')
    primary_confirm = sms(phone, 'YES')
    print(f"    primary confirm: {primary_confirm[:140]!r}")

    # Now invoke friend flow
    sms(phone, 'FRIEND')
    sms(phone, 'Frienda')
    sms(phone, 'large soy latte')
    sms(phone, 'medium')
    sms(phone, '1')
    friend_confirm = sms(phone, 'YES')
    print(f"    friend confirm: {friend_confirm[:140]!r}")

    rows = db_query(
        f"SELECT order_number, station_id, order_details->>'milk' AS milk, "
        f"       order_details->>'name' AS name "
        f"FROM orders WHERE phone='{phone}' ORDER BY id")
    print(f"    rows: {rows}")
    assert len(rows) >= 2, f"expected 2+ orders, got {len(rows)}: {rows}"

    # Primary order: oat — station 2 or 3 should be valid (both have oat)
    primary = rows[0]
    primary_station = primary[1]
    primary_milk = primary[2]
    assert primary_milk == 'oat', f"primary milk wrong: {primary}"
    assert primary_station in (2, 3), \
        f"primary (oat) routed to station {primary_station} but only 2,3 have oat"

    # Friend order: soy — must be station 3 (only one with soy)
    friend = rows[1]
    friend_station = friend[1]
    friend_milk = friend[2]
    assert friend_milk == 'soy', f"friend milk wrong: {friend}"
    assert friend_station == 3, \
        f"friend (soy) routed to station {friend_station} but only station 3 has soy"


# ---- Scenario 3: Completed orders filter by station ---------------------


def scenario_completed_filter():
    """Place two orders, complete one at S1 and one at S2, then verify
    that /api/orders/completed?station_id=1 returns only S1's, etc."""
    token = login()

    # Reset capabilities so every station has the basics — scenarios
    # leave the DB in a custom state, so make sure full cream works
    # everywhere before we pin orders to specific stations.
    db_query("""
        UPDATE station_stats
        SET capabilities = jsonb_set(
            COALESCE(capabilities, '{}'::jsonb),
            '{milk_types}',
            '["full cream","skim","soy","almond","oat","lactose free"]'::jsonb
        )
    """)

    # Order #1 → Station 1
    phone1 = '+15554443003'
    sms(phone1, 'hi'); sms(phone1, 'Ones'); sms(phone1, 'latte for station 1')
    sms(phone1, 'full cream'); sms(phone1, 'medium'); sms(phone1, '1')
    sms(phone1, 'YES')

    # Order #2 → Station 2
    phone2 = '+15554443004'
    sms(phone2, 'hi'); sms(phone2, 'Twos'); sms(phone2, 'latte for station 2')
    sms(phone2, 'full cream'); sms(phone2, 'medium'); sms(phone2, '1')
    sms(phone2, 'YES')

    rows = db_query(
        f"SELECT order_number, station_id FROM orders "
        f"WHERE phone IN ('{phone1}','{phone2}') ORDER BY phone")
    print(f"    placed: {rows}")
    assert len(rows) == 2, f"expected 2 orders, got {rows}"
    o1, o2 = rows
    on1, _ = o1
    on2, _ = o2

    # Start + complete both
    for on in (on1, on2):
        api_post_orders_action(on, 'start', token)
        api_post_orders_action(on, 'complete', token)

    # The two orders may not actually land on stations 1 and 2 (the
    # router can reassign based on load / capabilities). What we care
    # about is that the FILTER returns only what's at the requested
    # station. So: fetch each station and verify every row's station
    # matches the filter param.
    seen_total = 0
    for station_id in (1, 2, 3):
        status, payload = api_get(
            f'/api/orders/completed?station_id={station_id}', token)
        assert status == 200, f"completed fetch HTTP {status}: {payload}"
        orders = payload.get('orders') or []
        order_stations = [o.get('station_id') or o.get('stationId') for o in orders]
        print(f"    station {station_id}: {len(orders)} completed, "
              f"stations={order_stations}")
        for s in order_stations:
            assert s == station_id, (
                f"station_id={station_id} filter returned an order with "
                f"station_id={s}"
            )
        seen_total += len(orders)

    # Unfiltered should return all of them.
    status, payload = api_get('/api/orders/completed', token)
    orders = payload.get('orders') or []
    print(f"    no filter: {len(orders)} orders total")
    assert len(orders) >= seen_total, \
        f"unfiltered ({len(orders)}) should be >= sum of per-station ({seen_total})"


# ---- Scenario 4: Station that doesn't have a milk gives a helpful reply --


def scenario_milk_unavailable_at_station():
    """Customer pins an order to a station that doesn't carry the milk
    they want — what does the bot do?"""
    # From scenario_friend_mixed_milks we left station 1 with only
    # ["full cream","skim"]. So asking station 1 for soy should fail.
    phone = '+15554444005'
    sms(phone, 'hi')
    sms(phone, 'Soyseeker2')
    # The conversation handler accepts free-form text. Pin to station 1
    # explicitly so we know which station gets evaluated.
    sms(phone, 'soy latte for station 1')
    # Milk type was included in coffee message → handler will validate
    # against station_1 capabilities. But milk validation uses the
    # event-wide _get_available_milk_types() which checks inventory,
    # not station capability. So this test verifies whether station
    # routing logic catches it during _confirm_order, not earlier.
    sms(phone, 'medium')
    sms(phone, '1')
    final = sms(phone, 'YES')
    print(f"    final: {final[:200]!r}")

    rows = db_query(
        f"SELECT order_number, station_id, order_details->>'requested_station_id' "
        f"FROM orders WHERE phone='{phone}'")
    print(f"    DB: {rows}")
    # Expectation: either the order was reassigned to station 3 (the
    # only one with soy) with a note, OR the bot blocked it with a
    # helpful error. EITHER is acceptable — we just want it to not
    # silently route soy to station 1.
    if rows:
        order_num, station_id, requested = rows[0]
        assert station_id != 1, (
            f"Order pinned to station 1 for soy was NOT reassigned away "
            f"from station 1; it went to {station_id}. Station 1 has no soy."
        )
        print(f"    ✓ rerouted from requested station 1 to actual station {station_id}")


# ---- run all ------------------------------------------------------------


def main():
    print(f"backend={BACKEND}")
    passed = failed = 0
    for label, fn in [
        ("VIP code via SMS → priority 1 + VIP routing",      scenario_vip),
        ("Friend order with mixed milks → per-coffee routing", scenario_friend_mixed_milks),
        ("Completed orders endpoint filters by station_id",  scenario_completed_filter),
        ("Order for milk not at requested station — reroute", scenario_milk_unavailable_at_station),
    ]:
        if step(label, fn):
            passed += 1
        else:
            failed += 1
    print(f"\n{passed} passed, {failed} failed")
    return 0 if failed == 0 else 1


if __name__ == '__main__':
    sys.exit(main())
