# Support interface deep audit (2026-06-12)

Requested after live testing showed "lots of stuff not working" in Support
(pause all orders, system tests, config remnants). Three parallel code-sweep
agents traced **every interactive control** in the Support interface (147
controls across 10 files, ~4,000 lines) to its handler, endpoint, and backend
implementation, then cross-checked all 38 unique API endpoints the area calls.

## Headline result

**The single biggest cause was one bug, not many:** `support_api_routes.py`
did a top-level `import psutil`, but psutil was never in `requirements.txt`.
On Railway the import throws and the ENTIRE support blueprint silently fails
to register — every route in it 404s. That one blueprint contains:

- `/api/emergency/stop-all` / `resume` / `clear-queues` / `backup`
  → **"Pause All Orders", "Emergency Stop", "Clear All Queues"**
- `/api/diagnostics/database|sms|performance|logs|test`
  → **Health tiles, "Run Tests" (System Tests), logs viewer**
- `/api/stations/<id>/toggle|restart|clear-queue` + `clear-all-queues`
  → **Operations station controls**
- `/api/users` full CRUD + `reset-password` + `toggle-status`
  → **Users tab edit/save/delete/reset**
- `/api/messages/announcement` → **Send to All Stations**
- `/api/support/broadcast/preview|customers` → **SMS broadcast**

Fixed in PR #3: psutil added to requirements + import made lazy so one
missing dep can never de-register the whole blueprint again.
**32 of the 38 endpoints Support calls exist and come alive on deploy.**

## Genuinely missing endpoints (intentionally deferred)

Six emergency endpoints have handlers in the frontend but no backend:
`lock-system`, `unlock-system`, `reset-stations`, `restore`, `purge-data`,
`reset-database`. These are **already hidden** in the Emergency tab UI and
listed there as "deferred — endpoint missing". Implement only if/when needed
(reset-database deliberately requires typing "RESET DATABASE").

## Fixed in this pass (beyond the blueprint revival)

1. **System Health hardcoded numbers** (`SystemHealthTab.js`) — "98% health,
   1 incident, 42% load, 12ms latency" were literals; ResourceMeter (24% CPU /
   6.2GB / 45GB disk) was fiction; "Recent Health Events" was a fake feed
   (Redis alerts for a stack with no Redis). Now: health score computed from
   live tile statuses, failing-component count real, CPU/memory from
   `/api/diagnostics/performance`, latency measured per refresh, disk meter
   and fake events removed.
2. **Support → Config tab** (`ConfigurationTab.js`) — was a 556-line clone of
   Organiser config (branding/messages/menu/SMS) whose Save persisted nowhere;
   untouched since its initial commit (the "remnant" Steve spotted). Replaced
   with a signpost panel pointing to the canonical homes (Organiser Event
   Settings / Inventory / Stations; Railway Variables for SMS env).
3. **Operations tab duplicate menu editors** — embedded full `MenuManagement`
   + `StationMenuAssignment`, a second editing surface racing the Organiser's
   during live events. Removed; replaced with a pointer card.
4. **SMS Test Simulator** — 841-line walkthrough that never touches the
   backend (all 10 stages mock). Added a prominent "Simulation only" banner
   pointing to Readiness → Send test SMS for real end-to-end tests.

## Known-good after PR #3 (verified by endpoint cross-check)

Dashboard quick actions, broadcast (preview + send), Today's Report
(view/print/email), client-crash panel, diagnostics suite, users CRUD,
station controls, announcements, emergency stop/resume/clear/backup.

## Remaining follow-ups (logged, not blocking)

- **MenuManagement has no backend** — drinks menu lives in
  `localStorage:coffeeMenu` only; no cross-device sync. Wire to an
  `/api/events/menu` endpoint using the EventInventoryService pattern.
- `SystemSettings.js` is orphaned (no route reaches it) — archive candidate.
- `StationMenuAssignment.js` now unused by Support; verify Organiser usage or
  archive.
- `EventStockManagement` vs `StationInventoryConfig` redundancy — consolidate.
- CommunicationsTab hidden sections (Twilio config, templates, history) are
  hardcoded mockups — fine while hidden; wire before unhiding.
- Health tab per-component "Restart" button is an explicit alert-stub
  (intentional — restarts belong to the deploy host).
