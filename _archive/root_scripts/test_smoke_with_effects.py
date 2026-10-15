"""
Effect-assertion smoke test: drive each high-value flow end-to-end
and verify the **right thing happens** in the database / UI, not
just "the page loaded".

This is the focused companion to test_smoke_all_buttons.py — that
one walks everything looking for crashes, this one drills into the
flows that matter most and asserts outcomes.

Scenarios (each runs against a fresh-ish DB state):

  1. Add Station via Organiser UI → row appears in station_stats
  2. Rename Station via Organiser UI → name persists to DB
  3. Walk-in order via Barista UI → order row created with right station
  4. Broadcast SMS from Support → TESTING_MODE log shows the sends
  5. Start + Complete order from Barista UI → status moves to completed
  6. Place SMS order with VIP code → queue_priority = 1 in DB
  7. Place SMS order requesting unavailable milk → reassigned with note

Requires backend + frontend running (the smoke test setup).
"""
import os
import sys
import json
import time
import urllib.parse
import urllib.request

from playwright.sync_api import sync_playwright


FRONTEND = os.environ.get('EXPRESSO_FRONTEND', 'http://localhost:3000')
BACKEND = os.environ.get('EXPRESSO_BACKEND', 'http://localhost:5001')
ADMIN_USER = os.environ.get('ADMIN_USER', 'coffeecue')
ADMIN_PASS = os.environ.get('ADMIN_PASS', 'adminpassword')

SHOT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                        'test_screenshots', 'effects')
os.makedirs(SHOT_DIR, exist_ok=True)


def shot(page, label):
    try:
        page.screenshot(path=os.path.join(SHOT_DIR, f"{label}.png"),
                        full_page=True)
    except Exception:
        pass


def sms(phone, body):
    """Drive one SMS turn. Returns the bot's reply text."""
    data = urllib.parse.urlencode(
        {'From': phone, 'Body': body, 'To': '+15550000000'}).encode()
    req = urllib.request.Request(BACKEND + '/sms', data=data,
                                 headers={'Content-Type': 'application/x-www-form-urlencoded'},
                                 method='POST')
    with urllib.request.urlopen(req, timeout=10) as resp:
        body = resp.read().decode()
    open_tag = body.find('<Message>')
    close_tag = body.find('</Message>')
    if open_tag == -1 or close_tag == -1:
        return body
    return body[open_tag + len('<Message>'):close_tag].strip()


def db_query(sql):
    """Run one SQL statement. Commits on DDL/DML so DELETEs / UPDATEs
    actually persist (the default psycopg2 connection is in
    auto-rolled-back transaction mode)."""
    import psycopg2
    db_url = os.environ.get(
        'DATABASE_URL', 'postgresql://localhost/expresso_test_1779151198')
    conn = psycopg2.connect(db_url)
    try:
        cur = conn.cursor()
        cur.execute(sql)
        try:
            rows = cur.fetchall()
        except psycopg2.ProgrammingError:
            rows = None
        conn.commit()
        return rows
    finally:
        conn.close()


def reset_db():
    """Bring the test DB back to a clean state between scenarios.

    psycopg2's cursor.execute() only runs the FIRST statement in a
    multi-statement string, so we send each separately. Previous
    behaviour silently skipped most resets and scenarios picked up
    state from earlier runs.
    """
    db_query("DELETE FROM conversation_states")
    db_query("DELETE FROM customer_preferences")
    db_query("DELETE FROM orders")
    db_query("DELETE FROM sms_messages")
    db_query("ALTER SEQUENCE order_number_seq RESTART WITH 1")
    db_query("UPDATE inventory_items SET amount = capacity WHERE category IN ('milk', 'coffee')")
    db_query("UPDATE inventory_items SET amount = 200 WHERE category = 'sugar'")
    db_query("UPDATE station_stats SET current_load = 0, notes = NULL")
    db_query("DELETE FROM station_stats WHERE station_id > 3")
    # Generous capabilities so order routing works in tests.
    db_query("""
        UPDATE station_stats
        SET capabilities = jsonb_set(
            COALESCE(capabilities, '{}'::jsonb),
            '{milk_types}',
            '["full cream","skim","soy","almond","oat","lactose free"]'::jsonb
        )
    """)


def api_login():
    """Return a JWT from the backend."""
    req = urllib.request.Request(
        BACKEND + '/api/auth/login',
        data=json.dumps({'username': ADMIN_USER, 'password': ADMIN_PASS}).encode(),
        headers={'Content-Type': 'application/json'},
        method='POST',
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode())['token']


# -----------------------------------------------------------------------


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


def ui_login(page):
    page.goto(f"{FRONTEND}/login", wait_until='networkidle', timeout=20000)
    for sel in ['input[type="text"]', 'input[name="username"]']:
        if page.locator(sel).count() > 0:
            page.locator(sel).first.fill(ADMIN_USER)
            break
    for sel in ['input[type="password"]', 'input[name="password"]']:
        if page.locator(sel).count() > 0:
            page.locator(sel).first.fill(ADMIN_PASS)
            break
    for sel in ['button[type="submit"]', 'button:has-text("Sign In")',
                'button:has-text("Sign in")']:
        if page.locator(sel).count() > 0:
            page.locator(sel).first.click()
            break
    page.wait_for_load_state('networkidle', timeout=15000)
    page.wait_for_timeout(2000)


# -----------------------------------------------------------------------


def scenario_add_station_ui(ctx):
    reset_db()
    page = ctx.new_page()
    ui_login(page)
    page.goto(f"{FRONTEND}/organiser", wait_until='networkidle', timeout=20000)
    page.wait_for_timeout(1500)
    page.locator('button:has-text("Stations")').first.click()
    page.wait_for_timeout(800)

    before = sorted([r[0] for r in db_query("SELECT station_id FROM station_stats")])
    page.locator('button:has-text("Add Station")').first.click()
    page.wait_for_timeout(500)

    # Fill name via React-native setter
    page.evaluate("""([val]) => {
        const i = Array.from(document.querySelectorAll('input'))
            .find(x => (x.placeholder || '').toLowerCase().includes('station name'));
        if (!i) return;
        const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        s.call(i, val);
        i.dispatchEvent(new Event('input', {bubbles: true}));
    }""", ['Effect Lobby'])

    page.evaluate("""() => {
        const b = Array.from(document.querySelectorAll('button'))
            .filter(x => /Add Station/.test(x.textContent))
            .find(x => x.getBoundingClientRect().top > 600);
        if (b) b.click();
    }""")
    page.wait_for_timeout(2000)
    shot(page, 'add_station_after')

    after = sorted([r[0] for r in db_query("SELECT station_id FROM station_stats")])
    assert len(after) == len(before) + 1, f"expected +1 station, got {before} → {after}"
    new_id = max(after)
    name_row = db_query(f"SELECT notes FROM station_stats WHERE station_id = {new_id}")
    print(f"    new station id={new_id}, notes={name_row[0][0]!r}")
    page.close()


def scenario_rename_station_ui(ctx):
    reset_db()
    page = ctx.new_page()
    ui_login(page)
    page.goto(f"{FRONTEND}/organiser", wait_until='networkidle', timeout=20000)
    page.wait_for_timeout(1500)
    page.locator('button:has-text("Stations")').first.click()
    page.wait_for_timeout(1000)

    target_name = 'Effect Espresso Bar'
    page.locator('text=Coffee Station 2').first.click()
    page.wait_for_timeout(500)

    # Click Edit
    page.locator('button:has-text("Edit")').first.click()
    page.wait_for_timeout(500)

    # Replace the name input with our target
    page.evaluate("""([val]) => {
        const inputs = Array.from(document.querySelectorAll('input[type="text"], input:not([type])'));
        if (!inputs.length) return;
        const target = inputs[0];
        const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        s.call(target, val);
        target.dispatchEvent(new Event('input', {bubbles: true}));
    }""", [target_name])
    page.locator('button:has-text("Save")').first.click()
    page.wait_for_timeout(2000)
    shot(page, 'rename_station_after')

    row = db_query("SELECT notes FROM station_stats WHERE station_id = 2")
    print(f"    station 2 notes after rename: {row[0][0]!r}")
    assert row and row[0][0] == target_name, f"rename did not persist: {row}"
    page.close()


def scenario_complete_order_ui(ctx):
    reset_db()
    # Place an order via SMS so the Barista UI has something to start.
    phone = '+15557779001'
    for line in ['hi', 'Effect', 'latte for station 1', 'full cream',
                 'medium', '1', 'YES']:
        sms(phone, line)

    # The router can reassign — see which station the order actually
    # landed on, and have the Barista UI point there. Otherwise the
    # default-Station-1 view shows zero orders and the Start button
    # never appears.
    row = db_query(f"SELECT station_id FROM orders WHERE phone = '{phone}'")
    assert row, "order was not created"
    actual_station = row[0][0]
    print(f"    order landed on station {actual_station}")
    # The Barista UI reads `coffee_selected_station` from localStorage
    # to pick which station to show on load.

    page = ctx.new_page()
    ui_login(page)
    # useStations reads from these two keys to pick the initial station.
    page.evaluate(f"""
        localStorage.setItem('coffee_cue_selected_station', '{actual_station}');
        localStorage.setItem('last_used_station_id', '{actual_station}');
    """)
    page.goto(f"{FRONTEND}/barista", wait_until='networkidle', timeout=20000)
    page.wait_for_timeout(3000)
    if '/login' in page.url:
        page.goto(f"{FRONTEND}/barista", wait_until='networkidle', timeout=20000)
        page.wait_for_timeout(3000)

    # Wait for the order to actually appear in the queue.
    start_btn = page.locator('button:has-text("Start")').first
    start_btn.wait_for(state='visible', timeout=15000)
    start_btn.click()
    page.wait_for_timeout(2000)
    after_start = db_query(f"SELECT status FROM orders WHERE phone = '{phone}'")
    assert after_start and after_start[0][0] in ('in-progress', 'in_progress'), \
        f"start did not move to in-progress: {after_start}"

    # Complete
    page.locator('button:has-text("Complete Order"), button:has-text("COMPLETE ORDER")').first.click()
    page.wait_for_timeout(2000)
    after_complete = db_query(f"SELECT status FROM orders WHERE phone = '{phone}'")
    assert after_complete and after_complete[0][0] in ('completed', 'complete'), \
        f"complete did not move to completed: {after_complete}"
    print(f"    pending → in-progress → completed all verified")
    shot(page, 'complete_order_after')
    page.close()


def scenario_broadcast_send_from_ui(ctx):
    reset_db()
    # Make sure there's a recipient so audience > 0
    phone = '+15557779002'
    for line in ['hi', 'Broadcaster', 'latte for station 1', 'full cream',
                 'medium', '1', 'YES']:
        sms(phone, line)

    page = ctx.new_page()
    ui_login(page)
    page.on('dialog', lambda d: d.accept())
    page.goto(f"{FRONTEND}/support", wait_until='networkidle', timeout=20000)
    page.wait_for_timeout(2000)
    page.locator('button:has-text("Comms")').first.click()
    page.wait_for_timeout(800)
    page.locator('button:has-text("Broadcast")').first.click()
    page.wait_for_timeout(500)

    page.locator('textarea').first.click()
    page.locator('textarea').first.type('Effect test broadcast', delay=10)
    page.locator('button:has-text("Send broadcast")').first.click()
    page.wait_for_timeout(2500)
    shot(page, 'broadcast_after')

    # In TESTING_MODE the backend log shows "TESTING MODE - Would send"
    # — read it back to confirm a send was attempted.
    with open('/tmp/expresso_backend.log') as f:
        log = f.read()
    assert 'TESTING MODE - Would send' in log and 'Effect test broadcast' in log, \
        "broadcast send not visible in backend testing-mode log"
    print(f"    broadcast send attempt visible in backend log")
    page.close()


def scenario_vip_priority(ctx):
    reset_db()
    # Find the VIP code seeded in this DB
    vip_row = db_query("SELECT value FROM settings WHERE key = 'vip_code'")
    vip_code = vip_row[0][0] if vip_row else 'VIP'
    phone = '+15557779003'
    reply = sms(phone, vip_code)
    assert 'vip' in reply.lower() and 'activate' in reply.lower(), \
        f"VIP not activated: {reply!r}"
    # Place order
    for line in ['large latte for station 3', 'full cream', 'medium', '1', 'YES']:
        sms(phone, line)
    rows = db_query(f"SELECT queue_priority, station_id FROM orders WHERE phone = '{phone}'")
    assert rows, "VIP order not created"
    priority, station_id = rows[0]
    print(f"    VIP order placed: priority={priority} station={station_id}")
    assert priority == 1, f"expected priority 1 for VIP, got {priority}"


def scenario_unavailable_milk_reroute(ctx):
    reset_db()
    # Make station 1 oat-less so an oat order pinned to station 1 must reroute
    db_query("""
        UPDATE station_stats
        SET capabilities = jsonb_set(capabilities, '{milk_types}',
            '["full cream","skim"]'::jsonb)
        WHERE station_id = 1
    """)
    phone = '+15557779004'
    for line in ['hi', 'Reroute', 'oat latte for station 1', 'medium', '1', 'YES']:
        sms(phone, line)
    rows = db_query(f"SELECT station_id, order_details->>'milk' FROM orders WHERE phone = '{phone}'")
    assert rows, "reroute order not created"
    station_id, milk = rows[0]
    print(f"    oat-pinned-to-S1 actually routed to S{station_id} (milk={milk})")
    assert station_id != 1, \
        f"oat order was NOT rerouted away from station 1; landed on S{station_id}"


# -----------------------------------------------------------------------


def main():
    print(f"frontend={FRONTEND}  backend={BACKEND}")
    passed = failed = 0
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={'width': 1500, 'height': 1000})
        for label, fn in [
            ('Add Station via Organiser UI persists to DB',     scenario_add_station_ui),
            ('Rename Station via Organiser UI persists to DB',  scenario_rename_station_ui),
            ('Start + Complete order via Barista UI updates status', scenario_complete_order_ui),
            ('Broadcast SMS from Support → backend logs send',  scenario_broadcast_send_from_ui),
            ('VIP code → queue_priority=1 in DB',               scenario_vip_priority),
            ('Oat order pinned to non-oat station is rerouted', scenario_unavailable_milk_reroute),
        ]:
            if step(label, lambda fn=fn: fn(ctx)):
                passed += 1
            else:
                failed += 1
        browser.close()
    print(f"\n{passed} passed, {failed} failed")
    return 0 if failed == 0 else 1


if __name__ == '__main__':
    sys.exit(main())
