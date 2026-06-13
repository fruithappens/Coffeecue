# Session log — 2026-06-13 (Coffee Cue / Expresso)

Handoff for a fresh context. Everything done after PR #2 (the big hardening
branch) was already live. Branch: `claude/login-case-insensitive-barista-cap`.
Prod: **https://web-production-4cc9c.up.railway.app** (Railway, auto-deploys
from `main`). Admin login: `coffeecue` / `adminpassword`.

---

## DEPLOY STATE (read this first)

| PR | Status | Contents |
|----|--------|----------|
| #3 | ✅ merged + live | case-insensitive login, barista cap→30, Support psutil fix, 4 SMS-bot fixes, americano leak, Phase-3 audit fixes |
| #4 | ✅ merged + live | Event Data Lifecycle feature, one-size sugar fix, walk-in autocomplete off, load/chaos harnesses |
| #5 | ✅ merged + live | per-size flat pricing, **display config fix**, wipe→default-admin |
| #6 | ⏳ **OPEN — needs merge** | schedule-fabrication fix, smoke empty-queue fix, **wipe "reset branding/pricing"** |

**Action outstanding:** merge **PR #6**, then a Wipe (both boxes) clears the
last test residue. After that the app is verifiably clean for a new event.

---

## WHAT CHANGED THIS SESSION (by theme)

### Auth / security
- **Case-insensitive username login** — `LOWER(username)` in all 3 login paths;
  passwords stay case-sensitive; create-time dup-check also case-insensitive.
  (Was: `Treenet1` ≠ `treenet1`.) Barista-account cap raised 10→30.
- **Login form no longer pre-fills `admin`/`coffee123`** (was broadcasting a
  working admin login to anyone opening the page).

### Support interface (was largely dead on prod)
- **Root cause: `psutil` missing from requirements.txt** → the whole
  `support_api` blueprint failed to import on Railway → every
  `/api/diagnostics/*`, `/api/emergency/*`, station controls, user CRUD, and
  the broadcast route 404'd. Fixed: pinned `psutil`, made the import lazy.
- Killed fabricated health metrics (98%/Redis events), replaced the 556-line
  dead Config tab + duplicate Operations menu editors with signposts, labelled
  the SMS Test simulator "simulation only", added is_active to `/api/users`.

### SMS bot conversation fixes (found by the new scenario harness + live e2e)
- **"small flat white" silently confirmed full-cream + 1 sugar** — the word
  "white" inside the drink name leaked into the milk + sugar extractors. Fixed
  by stripping the matched drink name before extracting other fields.
- **"large latte" dropped the size**; the explicit size answer was dropped on
  one-size events; "no sugar" phrasing rejected; **MessageSid not idempotent**
  (Twilio retries corrupted conversations) — all fixed.
- **Organiser-disabled coffees still sold via SMS** ("americano leak") — the
  espresso menu ignored the event-inventory enabled flags. Now intersected.
- **One-size events dropped sugar from a combined order** (found in the real
  Twilio e2e on Steve's phone). Fixed.
- **Inventory category whitelist** dropped `drinks`/`sugar` rows to `other`
  (hid API-created drinks from the bot). Fixed.

### Features built
- **Event Data Lifecycle** (Organiser → Event Data): Export (download event as
  JSON), Wipe, Re-import (returning customers' usuals). Admin-only.
  - Wipe clears customer/order/message/schedule data; keeps inventory config.
  - Options: **"remove staff logins"** (keeps `coffeecue`/`admin`) and
    **"reset branding, logo & pricing to default"** (clears the identity KV so
    the next client doesn't see the old one's). Both opt-in, type-WIPE guard.
- **Flat-fee pricing** — first-class toggle, incl. **per cup size** (small $2 /
  medium $2.50), alt-milks free. Quick Setup → Pricing.

### Customer display (public screen) — was showing defaults
- It used `ApiService.get`, which falls to a **mock/offline path when there's
  no auth token** (the display is token-less) → served default "Coffee Event",
  no logo, no SMS footer. Now fetches `/api/display/config` with a plain fetch.
  **Verified live: shows "Hills Baptist Lobethal" + "Order by SMS +61489263333".**

### Schedule
- `/api/schedule/today` was **inserting fake "Barista 1A 08:00-12:00" shifts**
  when none existed → showed on every barista screen forever. Disabled the
  fabrication; empty schedule → honest empty state; wipe now clears schedule.

### Misc
- Walk-in customer-name field: `autoComplete="off"` (no saved-name dropdown).
- Smoke contract: an empty order queue is valid (don't false-fail on 0 orders).

---

## DEEP-TEST PROGRAM (see DEEP_TEST_PLAN.md)

Reusable harnesses committed — run any time, esp. on deploy:
- `tests/smoke/smoke_test_api.py` — 31-point API contract smoke (FE/BE field
  shapes). **31/31 against local AND live prod.**
- `tests/sms_scenarios/run_sms_scenarios.py` — multi-turn SMS conversation
  correctness (drives `/sms`, asserts reply + DB state). **16/16.** FINDINGS.md.
- `tests/persistence/run_persistence_matrix.py` — config→behaviour loop. **5/5.**
- `tests/load/run_load_test.py` — incl. `--only conversation` (N concurrent
  SMS convos). Local knee ~50–100 concurrent on one process (RESULTS.md).
- `tests/chaos/run_chaos.py` — race/edge invariants. **4/4.** FINDINGS.md.

Phase status: 1✅ 2✅ 3✅ 4✅ (real SMS loop proven on Steve's phone) 6✅.
Phase 5 = local ramp done; **Railway SMS-load is BLOCKED** — prod correctly
rejects unsigned `/sms` (Twilio signature validation) even in TESTING_MODE,
so synthetic SMS can't be injected to prod. (A security win, not a bug.)

Audit docs at repo root: SUPPORT_AUDIT_2026-06-12.md, PHASE3_AUDIT_2026-06-13.md.

---

## OPEN / TRACKED (none event-blocking)

- **#45** Phase-3 quality leftovers: sweetener drift (walk-in vs organiser
  store), MenuManagement has no backend (localStorage only), Inventory-AI
  consumption rates are invented, Queue-AI routing toggles don't affect backend,
  per-station-milk gap (order assigned to Station 1 if no open station carries
  the milk — leave per Steve).
- **#49** Ghost orders / user-list flicker: UI shows stale localStorage when the
  DB is empty/wiped (server is authoritative; workaround = hard-refresh /
  clear site data). Real fix = trust empty server responses, don't merge cache.
- **#47** DYMO LabelWriter 450 label render (89×36mm) + laptop print workflow.
- **#48** ESC/POS raster network printing — unlocks cheap 2nd-hand networked
  liner-free printers (Epson TM-L90LF/L90II LFC, Star TSP654IISK, Bixolon
  SRP-S300). The existing "thermal network path" is a stub. iPad needs a
  NETWORK printer (DYMO is USB-only → laptop-only; no AirPrint linerless).

---

## KEY FACTS / GOTCHAS FOR A FRESH SESSION

- **TESTING_MODE on prod = False** (real SMS). Don't flip without reason; it
  opens a demo-auth bypass and the SMS-load test can't use it anyway.
- **SMS budget rule:** ≤10 real SMS without asking; real test SMS ONLY to
  Steve's phone **+61 412693279**. (Memory: feedback-sms-test-budget.)
- **Two-stores gotcha:** branding lives in `branding_settings` (display) AND
  top-level keys like `event_name`/`sponsor_*` (SMS). Inventory: backend
  `inventory_items` (bot reads) vs `event_inventory` settings KV (Organiser UI)
  vs `localStorage`. Several bugs trace to these.
- **Local dev:** `./dev.sh --backend-only` (port 5001), TESTING_MODE=True in
  local `.env`. Frontend: `cd "Barista Front End" && BROWSER=none npm start`.
- **Cleanup of synthetic test data:** `DELETE FROM orders WHERE
  order_details::text LIKE '%LOADTEST%'`; load-test phones use `+61000…`
  (never a real AU mobile).
- Steve is a non-coder running real coffee events; bar for "working" = a
  stranger texts "latte" and a barista pours it. Report concisely.

---

## HB LOBETHAL TEST SETUP RECIPE (after merging PR #6)

1. Event Data → **Wipe**, tick **both** ("remove staff logins" + "reset
   branding/pricing"), type WIPE → app back to default.
2. Hard-refresh tabs.
3. **Quick Setup** the event: small + medium cups, **$2 small / $2.50 medium**
   flat pricing, event name "Hills Baptist Lobethal", re-upload logo + **Save**
   (watch for "saved successfully", not "saved locally").
4. Display shows the event name + "Order by SMS +61489263333"; barista screen
   is enough for tickets (no printer needed for the test).
