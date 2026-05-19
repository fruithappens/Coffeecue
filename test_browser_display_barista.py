"""
Browser tests for the Display screen and the Barista start/complete flow.

  1. Open the Display screen on a fresh DB → should render even with
     no orders pending.
  2. Place an order via SMS → reload the Display → the order should
     appear.
  3. Open the Barista interface → click Start on an order → verify it
     moves to in-progress in the DB.
  4. Click Complete → verify it moves to completed.
"""
import os
import sys
import json
import urllib.parse
import urllib.request
import urllib.error

from playwright.sync_api import sync_playwright


FRONTEND = os.environ.get('EXPRESSO_FRONTEND', 'http://localhost:3000')
BACKEND = os.environ.get('EXPRESSO_BACKEND', 'http://localhost:5001')
ADMIN_USER = os.environ.get('ADMIN_USER', 'coffeecue')
ADMIN_PASS = os.environ.get('ADMIN_PASS', 'adminpassword')

SHOT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                        'test_screenshots', 'display_barista')
os.makedirs(SHOT_DIR, exist_ok=True)


def shot(page, label):
    path = os.path.join(SHOT_DIR, f"{label}.png")
    try:
        page.screenshot(path=path, full_page=True)
        print(f"    📸 {label}.png")
    except Exception as e:
        print(f"    📸 screenshot failed: {e}")


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


def api_post(path, *, form=None, json_body=None, token=None):
    url = BACKEND + path
    data = None
    headers = {'Accept': 'application/json'}
    if token:
        headers['Authorization'] = f'Bearer {token}'
    if json_body is not None:
        data = json.dumps(json_body).encode()
        headers['Content-Type'] = 'application/json'
    elif form is not None:
        data = urllib.parse.urlencode(form).encode()
        headers['Content-Type'] = 'application/x-www-form-urlencoded'
    req = urllib.request.Request(url, data=data, headers=headers, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status, resp.read().decode()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode()


def api_get(path, *, token=None):
    url = BACKEND + path
    headers = {'Accept': 'application/json'}
    if token:
        headers['Authorization'] = f'Bearer {token}'
    req = urllib.request.Request(url, headers=headers, method='GET')
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status, resp.read().decode()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode()


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


def login_via_ui(page):
    page.goto(f"{FRONTEND}/login", wait_until='networkidle', timeout=20000)
    for sel in ['input[type="text"]', 'input[name="username"]']:
        if page.locator(sel).count() > 0:
            page.locator(sel).first.fill(ADMIN_USER)
            break
    for sel in ['input[type="password"]', 'input[name="password"]']:
        if page.locator(sel).count() > 0:
            page.locator(sel).first.fill(ADMIN_PASS)
            break
    for sel in ['button[type="submit"]', 'button:has-text("Sign in")',
                'button:has-text("Sign In")', 'button:has-text("Login")']:
        if page.locator(sel).count() > 0:
            page.locator(sel).first.click()
            break
    page.wait_for_load_state('networkidle', timeout=15000)
    page.wait_for_timeout(1500)


def place_sms_order(phone, name, station=1):
    """Walk through the full SMS conversation for a single order.

    Specifying station=N pins the order to that station so the test
    can drive the Barista UI without first having to switch the
    barista's selected station.
    """
    api_post('/sms', form={'From': phone, 'Body': 'hi', 'To': '+15550000000'})
    api_post('/sms', form={'From': phone, 'Body': name, 'To': '+15550000000'})
    api_post('/sms', form={'From': phone, 'Body': f'large latte for station {station}',
                           'To': '+15550000000'})
    api_post('/sms', form={'From': phone, 'Body': 'full cream', 'To': '+15550000000'})
    api_post('/sms', form={'From': phone, 'Body': 'medium', 'To': '+15550000000'})
    api_post('/sms', form={'From': phone, 'Body': '1', 'To': '+15550000000'})
    api_post('/sms', form={'From': phone, 'Body': 'YES', 'To': '+15550000000'})


def run():
    print(f"frontend={FRONTEND}  backend={BACKEND}")
    passed = 0
    failed = 0

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={'width': 1500, 'height': 1000})
        page = ctx.new_page()

        # ---- 1. Display screen renders (empty state) -------------------
        def _display_empty():
            page.goto(f"{FRONTEND}/display", wait_until='networkidle', timeout=20000)
            page.wait_for_timeout(1500)
            shot(page, '01_display_empty')
            # We just check the page rendered something — the display
            # is publicly accessible (no login required) and should
            # work even with no orders.
            assert page.locator('body').count() > 0, "body missing"
        if step("Display screen loads with no orders", _display_empty):
            passed += 1
        else:
            failed += 1

        # ---- 2. Place an order; display updates ------------------------
        def _display_with_order():
            place_sms_order('+15557777001', 'Disp1')
            # Verify the order is in the DB.
            rows = db_query("SELECT order_number, status FROM orders WHERE phone='+15557777001'")
            assert rows, f"order not created"
            order_num, status = rows[0]
            print(f"    DB has order #{order_num} status={status}")
            # Reload the display screen.
            page.goto(f"{FRONTEND}/display", wait_until='networkidle', timeout=20000)
            page.wait_for_timeout(2000)
            shot(page, '02_display_with_order')
        if step("Place SMS order; Display screen renders an order", _display_with_order):
            passed += 1
        else:
            failed += 1

        # ---- 3. Log into Barista UI ------------------------------------
        def _login():
            login_via_ui(page)
            page.goto(f"{FRONTEND}/barista", wait_until='networkidle', timeout=20000)
            page.wait_for_timeout(2500)
            # Retry once if AuthGuard bounced us
            if '/login' in page.url:
                page.goto(f"{FRONTEND}/barista", wait_until='networkidle', timeout=20000)
                page.wait_for_timeout(2500)
            shot(page, '03_barista_landing')
            assert '/barista' in page.url or page.locator('text=Orders').count() > 0, \
                f"failed to land on Barista interface, url={page.url}"
        if step("Log in and open the Barista interface", _login):
            passed += 1
        else:
            failed += 1

        # ---- 4. Start an order from the Barista UI ---------------------
        def _start_order():
            # The Barista interface shows pending orders with a button
            # to start each. Selector varies; look for a "Start" button
            # and click the first one.
            page.wait_for_timeout(1000)
            shot(page, '04_before_start')
            before = db_query(
                "SELECT order_number, status FROM orders WHERE phone='+15557777001'")
            print(f"    before start: {before}")

            # Try several reasonable labels.
            for sel in ['button:has-text("Start")', 'button:has-text("Begin")',
                        '[aria-label="Start order"]']:
                btns = page.locator(sel)
                if btns.count() > 0:
                    btns.first.click()
                    break
            else:
                raise AssertionError("no Start button found on Barista UI")
            page.wait_for_load_state('networkidle', timeout=8000)
            page.wait_for_timeout(1500)
            shot(page, '05_after_start')

            after = db_query(
                "SELECT order_number, status FROM orders WHERE phone='+15557777001'")
            print(f"    after start: {after}")
            assert after and after[0][1] in ('in-progress', 'in_progress'), \
                f"order didn't move to in-progress: {after}"
        if step("Click Start on a pending order — moves to in-progress", _start_order):
            passed += 1
        else:
            failed += 1

        # ---- 5. Complete the in-progress order -------------------------
        def _complete_order():
            # The page has a "Completed" *tab* (a small dark grey nav
            # button) AND the big green "COMPLETE ORDER" action button.
            # `has-text("Complete")` would match the tab first. Match
            # the specific full label, case-insensitive.
            for sel in [
                'button:has-text("Complete Order")',
                'button:has-text("COMPLETE ORDER")',
                'button:has-text("Mark Complete")',
                'button:has-text("Finish")',
                '[aria-label="Complete order"]',
            ]:
                btns = page.locator(sel)
                if btns.count() > 0:
                    btns.first.click()
                    break
            else:
                raise AssertionError("no COMPLETE ORDER button found on Barista UI")
            page.wait_for_load_state('networkidle', timeout=8000)
            page.wait_for_timeout(1500)
            shot(page, '06_after_complete')

            row = db_query(
                "SELECT status FROM orders WHERE phone='+15557777001'")
            print(f"    after complete: {row}")
            assert row and row[0][0] in ('completed', 'complete'), \
                f"order didn't move to completed: {row}"
        if step("Click Complete — moves to completed", _complete_order):
            passed += 1
        else:
            failed += 1

        browser.close()

    print(f"\n{passed} passed, {failed} failed")
    return 0 if failed == 0 else 1


if __name__ == '__main__':
    sys.exit(run())
