# UI self-test findings (2026-06-12)

Driven through the running app (frontend :3000 + backend :5001) via the
Claude Chrome extension — real clicks, screenshots, console + network
capture, and page-context fetches. Goal: find hardcoded/placeholder
data, stub-vs-real functions, dead buttons, and mislabelled errors.

Legend: 🔴 real bug (fix) · 🟠 demo-quality / polish · 🟢 verified working

---

## 🔴 1. Branding endpoint is shadowed by a broken duplicate route

**Symptom:** the Landing page shows literal placeholders ("Landing Page
Title", "Footer Text") and the Organiser header shows "Admin Panel
Title" — even when logged in.

**Root cause:** `GET /api/settings/branding` is defined TWICE:
- `consolidated_api_routes.py:6566` — `@jwt_required_with_demo()`, reads
  the correct `branding_settings` KV. This is the canonical one that
  `BrandingSettings.js` PUTs to.
- `settings_api_routes.py:124` — `@jwt_required()` (strict), reads a
  DIFFERENT key `event_branding`.

The strict duplicate wins and rejects the very token that works for
`/api/orders` and `/api/stations`:
```
GET /api/settings/branding → 401 {"msg":"Invalid crypto padding"}
```
So branding NEVER loads in the browser, and every screen falls back to
placeholder defaults. The duplicate is worse on both axes (wrong auth +
wrong data key).

**Fix:** remove/neutralize the `settings_api_routes.py` branding GET so
the working consolidated route serves. (Done — see commit.)

---

## 🔴 2. Expired token is mislabelled as "Could not connect to backend"

**Symptom:** landing on the app with a stale token from a previous
session shows a big red banner: **"Authentication Error — Could not
connect to backend service. Using sample data instead."** The backend
is actually up (returns 200); it's the *token* that's expired.

**Evidence:** `coffee_connection_status` was cached as `"offline"`,
`/api/health` via the proxy returned 200, but `/api/settings/branding`
returned 401. The 401 was interpreted as a connectivity failure.

**Why it matters:** for a demo, an expired token from yesterday makes
the whole app look broken/disconnected at the door. An auth failure
(401) and a connectivity failure are different and should be surfaced
differently (re-login prompt vs "backend down"). Logging in clears it.

---

## 🔴 3. Live Operations dashboard shows hardcoded/fabricated metrics

`EnhancedLiveOperationsDashboard.js` renders several numbers that look
authoritative but are NOT computed from real data:
- `customerSatisfaction: 94, // This would be calculated from real feedback`
  (line 87) — hardcoded. There's no satisfaction-collection mechanism.
  It also drives the "Customer satisfaction at risk" critical alert.
- `+12%` trend on Active Orders (line 392) — hardcoded literal.
- "Peak Time 6:00" (line 464) — hardcoded.
- **"Avg Wait 5568m"** — 92 hours. Either a real-but-broken calc over
  stale/old orders, or sample data. Needs a real bounded calc (the
  Readiness + Today's Report paths compute avg wait correctly — this
  dashboard doesn't reuse them).

The network trace confirms it: the dashboard calls `/api/orders` and
`/api/stations` but **no analytics/statistics endpoint** — so
satisfaction / peak / trend cannot be real.

**Recommendation:** either wire these to real computations (avg wait
already exists in `/api/reports/today`) or clearly mark them as
estimates / remove them. Showing "94% Satisfaction" to a client is a
credibility risk if it's invented.

---

## 🟠 4. Dashboard writes settings on every render

The network trace shows `PUT /api/settings/wait-time` firing **3×** just
from loading the Live Ops dashboard. A read-only dashboard shouldn't be
writing settings on mount. Wasteful and risks clobbering a real
wait-time value. Worth tracing the effect that does this.

---

## 🟠 5. Literal placeholder strings as default copy

Independent of the branding-load bug (#1), the default values for these
fields are literal placeholders, so if branding is ever blank the UI
shows developer placeholder text to clients:
- "Landing Page Title", "Footer Text" (LandingPage)
- "Admin Panel Title" (Organiser header)

Defaults should fall back to the event name / a sensible blank, never
"Landing Page Title". (Partial fix applied — see commit.)

---

## 🟠 6. Minor: pluralisation

Station cards read "1 orders" (should be "1 order"). Cosmetic.

---

## 🟢 Verified working (real data, not stubs)

- **Readiness tab** (this session's P0 work): every check is real and
  computed — "2 of 4 stations active", "22 drinks not on any active
  station", "13 migrations applied, none pending", "No frontend crashes
  in the last hour" (uses the `client_errors` table), Quick Setup
  recency "17 days ago". Excellent contrast with the Live Ops dashboard.
- **Event name in page title** (this session): the browser tab reads
  "ANZCA ASM 2025 Cairns — Coffee Cue System v3" — the feature works.
- **Login** → correct branded header ("Coffee Cue System v3 / ANZCA ASM
  2025 Cairns"), auth succeeds, error banner clears.
- **Station Status Grid**: real per-station queue/in-progress counts.

---

## Method note

All findings captured live via the Chrome extension: screenshots for
layout, `read_console_messages` / `read_network_requests` for runtime
behaviour, and page-context `fetch()` to reproduce the 401s. Backend
route causes confirmed by grep against the source. The two 🔴 bugs with
"(Done)" / "(Partial fix applied)" were fixed in the same session;
the rest are logged for follow-up (some — like real satisfaction data —
are feature work, not quick fixes).
