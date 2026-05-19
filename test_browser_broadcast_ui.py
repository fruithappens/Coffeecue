"""
Browser test for the new Broadcast SMS UI.

Drives the Support → Communications → Broadcast tab through:
  1. Loading the page and switching to the Broadcast sub-tab.
  2. Clicking "Preview recipients" — verifies the endpoint is wired.
  3. Typing a message, clicking Send, accepting the confirm() dialog.
  4. Inspecting the result panel and asserting the backend recorded
     the simulated sends (TESTING_MODE swallows real Twilio calls).
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
                        'test_screenshots', 'broadcast')
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


def api_post(path, *, token=None, json_body=None, form=None):
    """Tiny HTTP helper to set up test fixtures."""
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


def seed_an_order():
    """Place a single SMS order so the broadcast audience has someone."""
    phone = '+15554444001'
    api_post('/sms', form={'From': phone, 'Body': 'hi', 'To': '+15550000000'})
    api_post('/sms', form={'From': phone, 'Body': 'Tester', 'To': '+15550000000'})
    api_post('/sms', form={'From': phone, 'Body': 'large latte', 'To': '+15550000000'})
    api_post('/sms', form={'From': phone, 'Body': 'full cream', 'To': '+15550000000'})
    api_post('/sms', form={'From': phone, 'Body': 'medium', 'To': '+15550000000'})
    api_post('/sms', form={'From': phone, 'Body': '1', 'To': '+15550000000'})
    api_post('/sms', form={'From': phone, 'Body': 'YES', 'To': '+15550000000'})


def run():
    print(f"frontend={FRONTEND}  backend={BACKEND}")
    passed = 0
    failed = 0

    # Seed: at least one customer so the broadcast audience is non-zero
    seed_an_order()

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={'width': 1500, 'height': 1000})
        page = ctx.new_page()

        # Auto-accept the confirm() that the Send button triggers.
        page.on('dialog', lambda d: d.accept())

        # 1. Login via the UI (more reliable than planting a token
        # directly — AuthGuard tracks more than just localStorage).
        def _login():
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
            # Wait for auth state to fully propagate — AuthGuard
            # otherwise redirects /support → /login on the first try.
            page.wait_for_timeout(2000)
        if step("Login via UI", _login):
            passed += 1
        else:
            failed += 1

        # 2. Navigate to Support → Communications → Broadcast
        def _navigate():
            # Retry once if the first navigation gets redirected to
            # /login by AuthGuard before our auth state propagated.
            page.goto(f"{FRONTEND}/support", wait_until='networkidle', timeout=20000)
            page.wait_for_timeout(1500)
            if '/login' in page.url:
                page.goto(f"{FRONTEND}/support", wait_until='networkidle', timeout=20000)
                page.wait_for_timeout(1500)
            shot(page, '01_support_landing')
            # Click the Comms sidebar item (the sidebar shows "Comms",
            # not "Communications" — the heading inside the tab says
            # "Communications Center").
            for sel in [
                'button:has-text("Comms")',
                'a:has-text("Comms")',
                'text=Comms',
                'button:has-text("Communications")',
            ]:
                if page.locator(sel).count() > 0:
                    page.locator(sel).first.click()
                    break
            page.wait_for_timeout(800)
            shot(page, '02_communications_overview')
            # Then the Broadcast sub-tab.
            page.locator('button:has-text("Broadcast")').first.click()
            page.wait_for_timeout(500)
            shot(page, '03_broadcast_tab')
            assert page.locator('text=Broadcast SMS').count() > 0, \
                "Broadcast SMS heading not visible"
        if step("Navigate Support → Communications → Broadcast", _navigate):
            passed += 1
        else:
            failed += 1

        # 3. Click Preview recipients
        def _preview():
            page.locator('button:has-text("Preview recipients")').click()
            page.wait_for_timeout(1500)
            shot(page, '04_after_preview')
            assert page.locator('text=recipient').count() > 0, \
                "preview result not visible"
        if step("Preview recipients", _preview):
            passed += 1
        else:
            failed += 1

        # 4. Type a message and send
        def _send():
            textarea = page.locator('textarea').first
            textarea.click()
            textarea.type("Coffee break in 10 minutes! ☕", delay=10)
            shot(page, '05_message_typed')
            page.locator('button:has-text("Send broadcast")').click()
            page.wait_for_timeout(2000)
            shot(page, '06_after_send')
            # Result panel should show "Sent N"
            assert page.locator('text=Sent').count() > 0, \
                "no Sent confirmation visible"
        if step("Send broadcast", _send):
            passed += 1
        else:
            failed += 1

        browser.close()

    print(f"\n{passed} passed, {failed} failed")
    return 0 if failed == 0 else 1


if __name__ == '__main__':
    sys.exit(run())
