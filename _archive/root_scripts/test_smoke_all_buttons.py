"""
Smoke test: visit every major page, click every safe button, capture
console errors and failed network requests.

This is a *breadth-first* sanity check — it doesn't assert "the right
thing happened", only "nothing exploded". A button that crashes the
React component, a tab that 404s, a dropdown whose options API
returns 500 — those all surface here.

It deliberately SKIPS visibly destructive buttons (Delete / Remove /
Cancel / Reset / Logout / Sign out) — running those without a fixture
could damage live data.

Outputs:
  * test_screenshots/smoke/<page>__<n>.png — screenshot after each click
  * stdout summary table — per page: buttons clicked, errors, failed reqs
  * test_screenshots/smoke/REPORT.md — markdown summary

Run after `python run_server.py` and `npm start` are both up.
"""
import os
import re
import sys
import json
import time
import urllib.parse
import urllib.request

from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout


FRONTEND = os.environ.get('EXPRESSO_FRONTEND', 'http://localhost:3000')
BACKEND = os.environ.get('EXPRESSO_BACKEND', 'http://localhost:5001')
ADMIN_USER = os.environ.get('ADMIN_USER', 'coffeecue')
ADMIN_PASS = os.environ.get('ADMIN_PASS', 'adminpassword')

SHOT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                        'test_screenshots', 'smoke')
os.makedirs(SHOT_DIR, exist_ok=True)


# ---------- destructive-button blocklist ----------------------------------
# Anything matching these (case-insensitive substring) is NOT clicked.
DESTRUCTIVE_PATTERNS = [
    'delete', 'remove', 'destroy', 'drop',
    'cancel order', 'cancel all',
    'reset', 'clear all', 'wipe',
    'logout', 'log out', 'sign out',
    'emergency stop', 'stop all',
    'force', 'restart', 'reboot',
    'send broadcast',  # already covered by broadcast UI test; sending is real
    'send sms',  # might fire real Twilio if not in testing mode
    'download',  # we don't want to litter Downloads/
    'export',
    'archive',
    'disable',  # toggling these would mutate config
    'release',  # release a station etc.
    'submit',  # generic — many forms submit safely but some don't, be conservative
    'save',  # may save partial form state
    'confirm',  # likely a destructive confirmation
    'process',
    'place order',  # we don't want to spawn dozens of test orders
    'add walk-in', 'add station',  # opens a modal — handled separately
]

# Pages to visit. Format: (label, path).
PAGES = [
    ('landing',   '/'),
    ('login',     '/login'),
    ('barista',   '/barista'),
    ('organiser', '/organiser'),
    ('support',   '/support'),
    ('display',   '/display'),
]

# Sub-tabs to click within Organiser (after main page loads). The
# sidebar entries in OrganiserInterface.js
ORGANISER_TABS = [
    'Live Ops', 'Stations', 'Queue AI', 'Event Phases', 'Orders',
    'Group Orders', 'Users', 'Schedule', 'Analytics', 'Comms Hub',
    'AI Predict', 'Messages', 'Settings',
]

# Sub-tabs in Support
SUPPORT_TABS = [
    'Dashboard', 'Operations', 'Health', 'Comms', 'SMS Test',
    'Users', 'Config', 'Diagnose',
]

# Sub-tabs in Barista (these are top tabs of the station view)
BARISTA_TABS = [
    'Orders', 'Stock', 'Inventory AI', 'Schedule', 'Completed',
    'Display', 'Queue AI', 'Balance', 'Capabilities', 'Staff', 'Settings',
]


# ---------- helpers ------------------------------------------------------


def shot(page, label):
    path = os.path.join(SHOT_DIR, f"{label}.png")
    try:
        page.screenshot(path=path, full_page=True)
    except Exception:
        pass
    return path


def is_destructive(text):
    t = (text or '').strip().lower()
    if not t:
        return False
    return any(p in t for p in DESTRUCTIVE_PATTERNS)


def login_via_ui(page):
    """Returns True on success."""
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
    try:
        page.wait_for_load_state('networkidle', timeout=15000)
    except PWTimeout:
        pass
    page.wait_for_timeout(2000)
    return '/login' not in page.url


# ---------- the smoke run ------------------------------------------------


class PageReport:
    def __init__(self, label, url):
        self.label = label
        self.url = url
        self.loaded = False
        self.console_errors = []
        self.failed_requests = []  # (status, url)
        self.buttons_total = 0
        self.buttons_clicked = 0
        self.buttons_skipped_destructive = 0
        self.buttons_skipped_other = 0
        self.click_failures = []
        self.notes = []


def make_listeners(page, report):
    """Attach console + network listeners to a page that funnel into the report."""
    def on_console(msg):
        if msg.type == 'error':
            txt = (msg.text or '')[:300]
            # Filter the auth-race noise that's documented as a known issue.
            noise = [
                'sourcemap', 'devtools', 'manifest',
                'no token found', 'authorization required',
                'missing jwt', 'missing authorization header',
                '/settings/branding',
                'failed to load resource: the server responded with a status of 401',
                'failed to load resource: the server responded with a status of 404',
                'api auth check failed', 'failed to fetch',
                'sw.js', 'service worker',
            ]
            if not any(n in txt.lower() for n in noise):
                report.console_errors.append(txt)

    def on_response(resp):
        try:
            status = resp.status
            url = resp.url
        except Exception:
            return
        if status >= 400 and '/api/' in url:
            # Same auth-race filter for the network side.
            if status == 401 and 'settings/branding' in url:
                return
            short = url.split('localhost:3000')[-1].split('localhost:5001')[-1][:90]
            report.failed_requests.append((status, short))

    page.on('console', on_console)
    page.on('response', on_response)


def visit_page(browser_ctx, label, path, *, is_logged_in):
    page = browser_ctx.new_page()
    report = PageReport(label, path)
    make_listeners(page, report)

    try:
        page.goto(f"{FRONTEND}{path}", wait_until='networkidle', timeout=20000)
        page.wait_for_timeout(1500)
        # AuthGuard may bounce protected pages to /login if our auth
        # state didn't propagate yet. Retry once.
        if '/login' in page.url and path not in ('/login', '/'):
            page.goto(f"{FRONTEND}{path}", wait_until='networkidle', timeout=20000)
            page.wait_for_timeout(1500)
        report.loaded = '/login' not in page.url or path in ('/login', '/')
        shot(page, f"{label}__00_landed")
    except Exception as e:
        report.notes.append(f"navigation: {type(e).__name__}: {e}")
        page.close()
        return report

    # Click every visible, enabled button on the page (one pass).
    # We re-query after each click because the DOM mutates.
    seen_texts = set()
    max_clicks = 25  # per page, to keep the run bounded
    for i in range(max_clicks):
        try:
            buttons = page.locator('button:visible:not([disabled])')
            count = buttons.count()
        except Exception:
            break
        report.buttons_total = max(report.buttons_total, count)

        clicked_any = False
        for j in range(count):
            try:
                btn = buttons.nth(j)
                text = btn.text_content(timeout=1000) or ''
                text_norm = ' '.join(text.split()).lower()[:80]
                if not text_norm or text_norm in seen_texts:
                    continue
                seen_texts.add(text_norm)

                if is_destructive(text_norm):
                    report.buttons_skipped_destructive += 1
                    continue

                # Some buttons close the page or navigate — record state
                pre_url = page.url
                try:
                    btn.click(timeout=2000, no_wait_after=True)
                except Exception as e:
                    report.click_failures.append(f"{text_norm!r}: {type(e).__name__}")
                    continue
                report.buttons_clicked += 1
                clicked_any = True

                page.wait_for_timeout(400)
                # Dismiss any modal that opened, by clicking Cancel or
                # pressing Escape, so the next click isn't blocked.
                try:
                    cancel = page.locator('button:has-text("Cancel"):visible').first
                    if cancel.count() > 0:
                        cancel.click(timeout=1500, no_wait_after=True)
                        page.wait_for_timeout(200)
                    else:
                        page.keyboard.press('Escape')
                except Exception:
                    pass

                # If the click navigated away, go back.
                if page.url != pre_url and path not in page.url:
                    try:
                        page.goto(f"{FRONTEND}{path}", wait_until='networkidle',
                                  timeout=10000)
                        page.wait_for_timeout(800)
                    except Exception:
                        pass

                shot(page, f"{label}__{i+1:02d}__{re.sub(r'[^a-z0-9]+', '_', text_norm)[:40]}")
                break  # re-query DOM after each click
            except Exception as e:
                report.click_failures.append(f"index {j}: {type(e).__name__}")
                continue

        if not clicked_any:
            break

    page.close()
    return report


# ---------- main ---------------------------------------------------------


def main():
    print(f"frontend={FRONTEND}  backend={BACKEND}")
    print(f"Screenshots: {SHOT_DIR}")
    print()

    reports = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={'width': 1500, 'height': 1000})

        # Login once; reuse the context for all subsequent visits so
        # the auth state persists.
        login_page = ctx.new_page()
        ok = login_via_ui(login_page)
        login_page.close()
        print(f"login: {'ok' if ok else 'FAILED — protected pages will redirect'}")
        print()

        # Visit top-level pages
        for label, path in PAGES:
            print(f"→ visiting {label} ({path})")
            r = visit_page(ctx, label, path, is_logged_in=ok)
            reports.append(r)
            print(f"   loaded={r.loaded}  buttons_clicked={r.buttons_clicked}/{r.buttons_total}"
                  f"  console_errors={len(r.console_errors)}"
                  f"  failed_api={len(r.failed_requests)}")

        # Organiser sub-tabs — visit each via sidebar click within /organiser
        print()
        print("→ walking Organiser sub-tabs")
        org_page = ctx.new_page()
        make_listeners(org_page, PageReport('organiser_all', '/organiser'))
        try:
            org_page.goto(f"{FRONTEND}/organiser", wait_until='networkidle', timeout=20000)
            org_page.wait_for_timeout(1500)
            for tab in ORGANISER_TABS:
                tab_report = PageReport(f"organiser__{tab.lower().replace(' ', '_')}", f"/organiser:{tab}")
                make_listeners(org_page, tab_report)
                try:
                    btn = org_page.locator(f'button:has-text("{tab}")').first
                    if btn.count() == 0:
                        tab_report.notes.append('tab button not found')
                    else:
                        btn.click(timeout=3000, no_wait_after=True)
                        org_page.wait_for_timeout(1500)
                        tab_report.loaded = True
                        shot(org_page, f"organiser__{tab.lower().replace(' ', '_')}")
                except Exception as e:
                    tab_report.notes.append(f"click: {type(e).__name__}: {e}")
                reports.append(tab_report)
                print(f"   organiser → {tab}: loaded={tab_report.loaded}"
                      f" console_errors={len(tab_report.console_errors)}"
                      f" failed_api={len(tab_report.failed_requests)}")
        finally:
            org_page.close()

        # Support sub-tabs
        print()
        print("→ walking Support sub-tabs")
        sup_page = ctx.new_page()
        try:
            sup_page.goto(f"{FRONTEND}/support", wait_until='networkidle', timeout=20000)
            sup_page.wait_for_timeout(1500)
            for tab in SUPPORT_TABS:
                tab_report = PageReport(f"support__{tab.lower().replace(' ', '_')}", f"/support:{tab}")
                make_listeners(sup_page, tab_report)
                try:
                    btn = sup_page.locator(f'button:has-text("{tab}")').first
                    if btn.count() == 0:
                        tab_report.notes.append('tab button not found')
                    else:
                        btn.click(timeout=3000, no_wait_after=True)
                        sup_page.wait_for_timeout(1500)
                        tab_report.loaded = True
                        shot(sup_page, f"support__{tab.lower().replace(' ', '_')}")
                except Exception as e:
                    tab_report.notes.append(f"click: {type(e).__name__}: {e}")
                reports.append(tab_report)
                print(f"   support → {tab}: loaded={tab_report.loaded}"
                      f" console_errors={len(tab_report.console_errors)}"
                      f" failed_api={len(tab_report.failed_requests)}")
        finally:
            sup_page.close()

        # Barista sub-tabs (top tabs, not sidebar)
        print()
        print("→ walking Barista top-tabs")
        bar_page = ctx.new_page()
        try:
            bar_page.goto(f"{FRONTEND}/barista", wait_until='networkidle', timeout=20000)
            bar_page.wait_for_timeout(1500)
            for tab in BARISTA_TABS:
                tab_report = PageReport(f"barista__{tab.lower().replace(' ', '_')}", f"/barista:{tab}")
                make_listeners(bar_page, tab_report)
                try:
                    btn = bar_page.locator(f'button:has-text("{tab}")').first
                    if btn.count() == 0:
                        tab_report.notes.append('tab button not found')
                    else:
                        btn.click(timeout=3000, no_wait_after=True)
                        bar_page.wait_for_timeout(1500)
                        tab_report.loaded = True
                        shot(bar_page, f"barista__{tab.lower().replace(' ', '_')}")
                except Exception as e:
                    tab_report.notes.append(f"click: {type(e).__name__}: {e}")
                reports.append(tab_report)
                print(f"   barista → {tab}: loaded={tab_report.loaded}"
                      f" console_errors={len(tab_report.console_errors)}"
                      f" failed_api={len(tab_report.failed_requests)}")
        finally:
            bar_page.close()

        browser.close()

    # Summarise
    print()
    print("=" * 70)
    print("SMOKE TEST SUMMARY")
    print("=" * 70)
    total_pages = len(reports)
    loaded = sum(1 for r in reports if r.loaded)
    total_errors = sum(len(r.console_errors) for r in reports)
    total_failed_reqs = sum(len(r.failed_requests) for r in reports)
    total_buttons = sum(r.buttons_clicked for r in reports)
    total_skipped = sum(r.buttons_skipped_destructive for r in reports)
    print(f"Pages visited:                 {total_pages}")
    print(f"Pages that loaded:             {loaded}/{total_pages}")
    print(f"Buttons clicked (safe):        {total_buttons}")
    print(f"Buttons skipped (destructive): {total_skipped}")
    print(f"Console errors (filtered):     {total_errors}")
    print(f"Failed API requests (4xx/5xx): {total_failed_reqs}")
    print()

    # Per-page report
    print("Per-page detail (showing only pages with errors or 4xx/5xx):")
    any_issues = False
    for r in reports:
        if r.console_errors or r.failed_requests or not r.loaded:
            any_issues = True
            print()
            print(f"  ⚠ {r.label}  ({r.url})")
            if not r.loaded:
                print(f"     ✗ failed to load")
            for note in r.notes:
                print(f"     · {note}")
            for status, url in r.failed_requests[:10]:
                print(f"     ✗ HTTP {status}  {url}")
            for err in r.console_errors[:5]:
                print(f"     ✗ console.error: {err[:160]}")
    if not any_issues:
        print("  (none — all pages loaded cleanly with no console errors)")

    # Write markdown report
    md_path = os.path.join(SHOT_DIR, 'REPORT.md')
    with open(md_path, 'w') as f:
        f.write(f"# Smoke test report\n\n")
        f.write(f"Pages visited: {total_pages} · loaded: {loaded}/{total_pages} · "
                f"buttons clicked: {total_buttons} · errors: {total_errors} · "
                f"failed API: {total_failed_reqs}\n\n")
        f.write("| Page | Loaded | Buttons clicked | Console errors | Failed API |\n")
        f.write("|------|--------|-----------------|----------------|-----------|\n")
        for r in reports:
            f.write(f"| `{r.label}` | {'✓' if r.loaded else '✗'} | "
                    f"{r.buttons_clicked}/{r.buttons_total} | "
                    f"{len(r.console_errors)} | {len(r.failed_requests)} |\n")
        f.write("\n## Details (pages with issues)\n\n")
        for r in reports:
            if r.console_errors or r.failed_requests:
                f.write(f"### `{r.label}` ({r.url})\n\n")
                for status, url in r.failed_requests[:20]:
                    f.write(f"- HTTP {status}: `{url}`\n")
                for err in r.console_errors[:10]:
                    f.write(f"- console.error: `{err[:240]}`\n")
                f.write("\n")
    print()
    print(f"Markdown report: {md_path}")

    # Return non-zero if anything looked broken
    return 0 if total_errors == 0 and total_failed_reqs == 0 and loaded == total_pages else 1


if __name__ == '__main__':
    sys.exit(main())
