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

## Remaining ranked fix-list (tracked as task #45)

1. **Live Ops "Pause/Resume Ordering" + Event Phases transitions call
   `/events/pause|resume|start|end` — none exist.** Cheapest real fix: wire
   pause/resume to the existing `/api/emergency/stop-all` + `/resume`
   (they do exactly this); hide the rest behind the existing preview labels.
2. **Comms Hub "Send to Baristas" → `/api/support/broadcast/baristas`
   missing** (customer broadcast works). Implement (station-chat fanout
   exists as `/api/messages/announcement`) or point the button at that.
3. **Barista stub buttons that LOOK real**: Edit Order (prompt, never
   saves), Delay Order (alert, no-op), previous-order View Details (alert).
   Wire or remove — a rushing barista can't tell theater from function.
4. **Analytics Dashboard is 100% fabricated charts** — wire to
   `/api/reports/today` + order stats, or stamp the same "Preview" banner
   the other AI tabs carry.
5. **Forgot Password is an alert stub** — either a real reset flow or
   relabel to "Contact your organiser to reset".
6. **Sweetener drift**: organiser store has "White Sugar" enabled but the
   walk-in dialog offers only "None" (different models — products vs
   quantity rows). Needs the same intersection treatment as coffees.
7. **MenuManagement still localStorage-only** (existing chip/task) — drinks
   menu doesn't survive device changes; backend KV endpoint per the
   StockService pattern.
8. **Inventory AI consumption rates are invented** (0.5L/hr etc.) — feed
   from real order history or label as estimate.
9. **Routing-rule toggles (Queue AI) don't affect backend routing** —
   `_assign_station()` ignores them; either honour or disclaim.
10. **CLAUDE.md doc drift**: token localStorage key is
    `coffee_system_token` (docs say `coffee_auth_token`); update docs.

## Phase 2 browser-half results (closing out task #38)

- Walk-in dialog tracks organiser-enabled coffees + milks ✓ (post-wipe too)
- Station stock survives full localStorage wipe via backend hydration ✓
- Orders/stations/settings re-hydrate on reload ✓
- Organiser config blobs hydrate lazily per-tab (acceptable; documented)
- Sweetener drift logged as item 6 above
