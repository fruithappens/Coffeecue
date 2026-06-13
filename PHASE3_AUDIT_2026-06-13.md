# Phase 3 audit — Organiser, Barista, Landing/Display/QR (2026-06-13)

Three parallel code-trace agents swept every interactive control in the
remaining interfaces (the Support interface got the same treatment in
SUPPORT_AUDIT_2026-06-12.md). Combined coverage: ~600 controls across
Organiser (382), Barista (~90 + dialogs), and the public surfaces.
Classification: REAL (wired, endpoint exists) / STUB (handler does nothing
real) / DEAD (endpoint missing → 404) / LOCAL-ONLY (localStorage, no backend
twin) / DECORATIVE.

## Fixed immediately (this commit)

1. 🔴 **Login form pre-filled `admin` / `coffee123`** (LoginPage.jsx:9-10) —
   working admin credentials shown to anyone who opened the login page.
   Now empty.
2. 🔴 **Display screen advertised "Number coming soon"** to customers when
   no SMS number configured — the SMS panel now only renders when a number
   exists.
3. 🟠 **Help dialog listed fake phone numbers** (123-456-7890) a barista
   might actually dial — replaced with organiser/station-chat guidance.
4. 🟠 **Random SMS tip per message** (qrCodeUtils) — identical orders got
   different copy, including an invented "peak hours 8-10am" claim. Now one
   deterministic tip, operator-overridable.

## Corrections to agent findings (verified false alarms)

- **"Barista stock is local-only, no backend sync"** — STALE. The
  `PUT/GET /api/stations/<id>/stock` sync shipped earlier (task #35) and the
  Phase-2 browser wipe test PROVED it: full localStorage wipe → reload →
  `coffee_stock_station_1` re-hydrates from the backend.
- **Walk-in catalogue** — verified live in the browser: exactly the 6
  organiser-enabled coffees and 5 milks, surviving a localStorage wipe.
  Consistent with the (now fixed) SMS behaviour.

## Verdict per area

- **Barista**: core order flow (claim → complete → pickup → message →
  reassign → batch) is 100% REAL. No catastrophic failure. A long tail of
  stub buttons (below).
- **Organiser**: Quick Setup / Readiness / Stations / Inventory / Branding /
  Users / Schedule sessions are REAL. The "advanced" tabs (Queue AI, AI
  Predict, Analytics, Event Phases) are preview-grade: real-ish reads,
  fabricated numbers, dead action buttons — most already carry "Preview"
  disclaimers from earlier sessions.
- **Public surfaces**: clean after today's fixes. All display/landing data
  is live; endpoints verified.

## Fix-list resolution (second commit, same day)

1. ~~Live Ops Pause/Resume → `/events/pause`~~ — **agent hallucination**:
   no such calls exist anywhere in src (verified by global grep). No action.
2. ~~Comms Hub "Send to Baristas" → `/api/support/broadcast/baristas`~~ —
   **agent hallucination**: no such call exists. No action.
3. ✅ **Barista stub buttons fixed (honesty over theater)**: Delay Order no
   longer claims "delayed by 5 minutes" while doing nothing — it now says
   delaying isn't supported and points at Move/message; Edit Order no
   longer prompt()s for notes it silently drops — it says editing isn't
   supported and suggests cancel + re-create. (View Details alert was
   already honest.)
4. ✅ **Analytics Dashboard now carries the same "Preview: sample data"
   banner** as Queue AI / AI Predict, pointing at Live Ops + Today's Report
   for real numbers. (Wiring real stats remains task #45.)
5. ✅ **Forgot Password** fake link replaced with plain guidance ("ask your
   event organiser to reset it" — organisers have reset in the Users tab).
6. **Sweetener drift** (open, task #45): organiser store has "White Sugar"
   enabled but the walk-in dialog offers only "None" (different models —
   products vs quantity rows). Needs the same intersection treatment as
   coffees got.
7. **MenuManagement still localStorage-only** (open — existing chip/task):
   backend KV endpoint per the StockService pattern.
8. **Inventory AI consumption rates are invented** (open, task #45): 0.5L/hr
   etc. — feed from real order history or label as estimate.
9. **Routing-rule toggles (Queue AI) don't affect backend routing** (open,
   task #45): `_assign_station()` ignores them; honour or disclaim.
10. ✅ **CLAUDE.md doc drift fixed**: token localStorage key documented as
    `coffee_system_token` / `coffee_system_user` (was `coffee_auth_token`,
    a key nothing reads — it cost this session a failed login-injection).

## Phase 2 browser-half results (closing out task #38)

- Walk-in dialog tracks organiser-enabled coffees + milks ✓ (post-wipe too)
- Station stock survives full localStorage wipe via backend hydration ✓
- Orders/stations/settings re-hydrate on reload ✓
- Organiser config blobs hydrate lazily per-tab (acceptable; documented)
- Sweetener drift logged as item 6 above
