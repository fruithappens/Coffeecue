# Coffee Cue — production hardening roadmap

End goal: a white-label, multi-event coffee platform you deploy to
the cloud, hand to a client, and walk away. Pay-per-hour billing.
Steve operates events, baristas run stations, customers SMS in.

Sized by effort: S = under 1h, M = half-day, L = full day, XL = multi-day.
Pick from the top — items higher up unblock items below them, and
"top" reflects what helps Steve demo + sign clients soonest, not what
the academic priority would say.

Updated 2026-06-12 by Claude (1M context) — reconciled against task
tracker, added end-goal-aligned items the prior roadmap didn't see.

---

## Just shipped (2026-06-12)

- **UserManagement edit-pencil crash** — `startEdit` now merges API
  user into a full default form shape; nested `skills` / `availability`
  no longer come back `undefined` and crash the whole Organiser.
- **Quick Setup: event identity + event accounts** — single-page
  flow now creates `{slug}admin` + `{slug}1..N` logins in one apply.
  Idempotent (re-runs safely skip existing usernames).
- **Frontend crash visibility** — `POST /api/client-errors` +
  `client_errors` table (migration 11) + ErrorBoundary →
  `navigator.sendBeacon`. Surfaced in **Support → Diagnose** as a
  colour-coded panel that auto-refreshes every 30s.
- **Cypress organiser-clickthrough smoke** — `npm run smoke` walks
  every sidebar tab, every Edit pencil, every Add button; fails loud
  if any Error Boundary fires. The exact bug class that hit Steve last
  week — won't ship again silently.
- **VIP tap-to-confirm** — single confirm before submit if the VIP
  box is on. Cheap insurance against touchscreen mis-taps that would
  otherwise comp the order.
- **CORS production smell-check** — startup warns if `*` is combined
  with credentials, or if a prod-looking env has no non-localhost
  origins.
- **Catalog POST + /client-errors GET smoke checks** added to
  `tests/smoke/api_contracts.json`.
- **Event Readiness tab** — new Organiser sidebar entry. 8 checks
  (SMS, stations, event name, capability coverage, inventory,
  migrations, Quick Setup recency, recent crashes) + embedded
  send-test-SMS form + place-test-order button. `/api/readiness` +
  `/api/sms/test`. The "before doors open" page that prevents demo
  surprises.
- **Event templates** — save current Quick Setup as a reusable
  template, load into next event with one click. Migration 12,
  `/api/event-templates` CRUD, per-event identity stripped on save
  so credentials don't bleed across events. New section at the top
  of Quick Setup.
- **Startup scripts consolidated** — 6 scripts → one `dev.sh` with
  flags (`--with-ngrok`, `--with-twilio`, `--background`, `--skip-db`,
  `--backend-only`). Originals moved to `_archive_startup_scripts/`
  for muscle-memory cases.
- **Printable event summary** — `GET /api/reports/today/print`
  returns a print-styled HTML page (no PDF lib needed; browser's
  Save-as-PDF handles it). "Print / save as PDF" link in Support →
  Dashboard next to Today's Report.
- **Quick Setup drift preview** — `POST /api/quick-setup/dry-run`
  returns a side-by-side diff (inventory added/removed/unchanged +
  capability overwrites + setting changes). The Apply button now
  opens a preview modal first — no more "did that just wipe my custom
  stock amounts?" surprise. Falls back to a window.confirm prompt if
  the dry-run endpoint is missing (older backend). Smoke check added.
- **Event_name in page title** — `document.title` syncs to the live
  `event_name` from `/api/display/config` on mount, on
  `branding_updated` event, and every 60s. Multi-tab operators can
  finally tell which event window is which.
- **Walk-in: pre-fill last customer name** — previous customer name
  shows as a placeholder + a "Same as last walk-in: X" chip. One tap
  re-fills; focus on the field clears the prefill.
- **Walk-in: keyboard shortcuts 1–9** — press 1–9 to jump straight
  to the first 9 available drinks. Visible kbd hints under the picker.
  Ignored while typing into a text field.
- **Catalog-first milk lookups** — `getCatalogMilks()` reads from a
  module-level cache that `useCatalog('milk')` populates after every
  fetch. `getMilkTypeById`, `getMilkTypeByName`, `getStandardMilks`,
  `getAlternativeMilks`, `getAvailableMilks`, `getSimilarMilkSuggestions`
  all now prefer the catalog over the legacy `DEFAULT_MILK_TYPES`
  constant. The constant stays as the offline / pre-fetch fallback;
  callers in `orderUtils`, `OrderDataService`, `AvailableMilkOptions`
  no longer import it directly.
- **Post-event summary view** — `/api/reports/today/print?view=post`
  adds peak hour + busiest station to the stat grid, renames the
  heading "Post-event summary", and inlines a "share with the client"
  CTA. New button in Support → Dashboard. Same data, repeat-business
  framing.
- **Structured logging** — `services/logging_utils.py` event(code,
  **fields) emits stable SCREAMING_SNAKE_CASE codes in logfmt
  format (greppable + Datadog/Loki-parseable). Frontend mirror at
  `services/logging.js` (sendBeacon → `/api/client-events`, fire-
  and-forget). Migration 13 adds `client_events` table. First call
  sites wired: Twilio webhook sig fails (`SMS_WEBHOOK_SIG_FAIL`),
  walk-in submit/shortcuts (`WALKIN_SUBMIT`, `WALKIN_SHORTCUT_USED`),
  Quick Setup preview/apply (`QUICK_SETUP_PREVIEW_OPEN`,
  `QUICK_SETUP_APPLIED`, `QUICK_SETUP_PREVIEW_FAIL`).
- **Load test harness** — `tests/load/run_load_test.py` simulates
  event-style burst traffic (reads + walk-in writes + opt-in inbound
  SMS) with weighted scenarios, per-iteration think-time stagger,
  and p50/p95/p99/max latency per endpoint. Pure stdlib + requests,
  no new deps. Synthetic walk-ins marked `notes='LOADTEST'` so cleanup
  is one DELETE.
- **Australian SMS provider research** — `SMS_PROVIDERS_AU.md`
  compares 7 AU SMS providers vs Twilio: pricing, feature parity,
  migration effort, recommendation. ClickSend best ergonomics
  (~14% saving + free inbound + AUD billing); Cellcast cheapest
  (~60% saving, less mature Python SDK).
- **SMS provider abstraction** — `services/sms/` package with a
  common `SMSProvider` interface, Twilio + ClickSend + Cellcast
  implementations, per-provider webhook URLs so all three can run
  simultaneously. `SMS_PROVIDER` env var picks outbound primary;
  inbound is routed by URL (`/sms` Twilio, `/sms/clicksend`,
  `/sms/cellcast` — no `/api` prefix; the blueprint mounts at root).
  Opt-in via `SMS_USE_PROVIDER_FACTORY=true` for now — legacy Twilio
  path stays default until shaken down in staging. Disaster-recovery
  story: flip env, redeploy, outbound swaps provider with no code
  change. Per-provider health checks in `/api/health/full` +
  `.env.example` documented + smokes added. See `services/sms/README.md`.

### Session 2 (2026-06-12 PM) — deep testing + load + remaining P1

- **Deep testing pass** — booted the backend, ran the 27-contract smoke
  suite, fixed real bugs it surfaced: SMS inbound webhook paths
  (`/sms/...` not `/api/sms/...`), the dead Twilio webhook-updater path,
  and the silently-401-ing print-report links (added `query_string`
  JWT location so `window.open(...?jwt=)` actually authenticates — the
  existing Print button had been broken in the browser).
- **Load testing** — ran the harness for the first time. It had two
  bugs (never been run): a reporting-phase RLock deadlock and a phantom
  ~15% error rate from generating orders for un-stocked milk. Both
  fixed. Real numbers in `tests/load/RESULTS.md`: single instance does
  112 req/s at 25 concurrent workers, 0 errors, p99 < 48ms.
- **Customer receipt** — `GET /api/orders/<n>/receipt`, branded HTML +
  QR, linked from the ready SMS when `PUBLIC_BASE_URL` set.
- **Post-event email** — `POST /api/reports/post-event/email` +
  `services/email_utils.py`, "Email to client" button, EMAIL_ENABLED
  gate.
- **Thermal labels** — `render_label_png()` + label.png (AirPrint) +
  print-label (raw socket, hardware-pending) + printer-config CRUD +
  fixed the lying reprint button.

---

## P0 — demo readiness

### ✅ Pre-event readiness check page — DONE 2026-06-12
### ✅ Event template save / apply — DONE 2026-06-12
### ✅ Send-test-SMS button — DONE 2026-06-12 (in Readiness tab)
### ✅ Send-test-order button — DONE 2026-06-12 (in Readiness tab)
### ✅ Quick Setup drift preview — DONE 2026-06-12 (POST /api/quick-setup/dry-run + preview modal)

<details><summary>Earlier description of the now-done items, for context</summary>

### [M] Pre-event "readiness check" page
The single most demo-killing thing is showing up to an event and
discovering at customer #3 that SMS isn't wired, or no station
capabilities allow oat milk. A `/organiser/readiness` page that
runs 8–12 checks and shows green/amber/red dots:
- SMS: Twilio creds set, webhook URL reachable, TESTING_MODE off
- Stations: at least one active, capabilities cover every catalog drink
- Inventory: stock levels positive (or unlimited mode on)
- Quick Setup: was applied within the last 24h
- Branding: event_name set, logo loaded
- Pricing: matches the event's revenue model
- Backup: last successful pg_dump within last 24h
- Migrations: all applied
- Recent crashes: zero in last hour (use `/api/client-errors`)

Add a "Send test SMS to my number" button right at the top. Operator
sees green-all-round before doors open. Touch: new file
`Barista Front End/src/components/organiser-tabs/ReadinessTab.js` +
backend aggregator `GET /api/readiness` that calls the same
sub-checks `/api/health/full` already does, plus new ones.

### [M] Event template — "Save current as template" / "Apply template"
Steve says "every new event is 30 clicks." Quick Setup already brings
that to 5 clicks, but a saved template brings it to 1. Schema:
`event_templates(id, name, payload_json, saved_by, saved_at)`.
Backend: `POST /api/event-templates/save?from=current`,
`POST /api/event-templates/<id>/apply`. UI: a dropdown in Quick
Setup → "Load template" + a button at the bottom → "Save current
state as template." Templates store: milks, sizes, drinks, teas,
pricing mode, walkin defaults, SMS policy. NOT: stations
(per-venue), accounts (per-event), inventory levels (per-event).

### [M] Surface event_inventory drift in Organiser
After Quick Setup applies, operators tweak stock by hand. If they
re-run Quick Setup later (e.g. to add a new milk), the new round
should call out *what would change* before it changes anything —
a diff view. Currently the apply is "trust the new preset." A
preview prevents the "wait, did that just wipe my oat milk stock?"
moment in a demo.

### [S] "Send test SMS" button in Branding settings
One field, one button. Sends the welcome SMS to the supplied
number using the current template. Catches misconfigured Twilio
in seconds instead of when the first customer doesn't get a reply.

</details>

---

## P1 — operational confidence

### ✅ Structured logging with event_codes — DONE 2026-06-12
`services/logging_utils.event(code, **fields)` emits logfmt-style
`event=CODE k=v` lines for cheap grep + Datadog/Loki parsing.
Frontend `services/logging.js` mirrors it via sendBeacon →
`/api/client-events` (migration 13). First call sites wired:
`SMS_WEBHOOK_SIG_FAIL`, `WALKIN_SUBMIT`, `WALKIN_SHORTCUT_USED`,
`QUICK_SETUP_PREVIEW_OPEN`, `QUICK_SETUP_APPLIED`,
`QUICK_SETUP_PREVIEW_FAIL`. Future call sites add by importing the
helper — no further infra needed.

### ✅ Per-event post-event summary — DONE 2026-06-12
Same `/api/reports/today/print` endpoint, `?view=post` adds peak
hour + busiest station + "share with the client" CTA. New
"Post-event summary" button in Support → Dashboard. Cmd+P → Save
as PDF → email to client. Email auto-send deferred until SMTP infra
is configured (EMAIL_ENABLED is False by default).

### ✅ Customer-facing branded receipt — DONE 2026-06-12
`GET /api/orders/<n>/receipt` — public, print-styled HTML with event
branding, order details, total (when pricing on), and a pickup QR.
The "order ready" SMS appends the link when `PUBLIC_BASE_URL` is set.
Apple Wallet pass not done (lower value than the PDF receipt; revisit
if a corporate client asks).

### ✅ Post-event summary email auto-send — DONE 2026-06-12
`POST /api/reports/post-event/email` renders the post-event HTML and
emails it (`services/email_utils.py`, gated behind `EMAIL_ENABLED`).
"Email to client" button in Support → Dashboard; graceful "Save as
PDF instead" when SMTP is off. Also fixed the print-link auth (the
`?jwt=` window.open links were 401-ing — added `query_string` JWT
location).

### ✅ Thermal label printing (network printer path) — DONE 2026-06-12 (raw-socket transport hardware-pending)
`render_label_png()` builds a 62mm label (order #, name, drink,
options, station, branding, QR) via Pillow. `GET /api/orders/<n>/label.png`
→ open + AirPrint (Brother QL-820NWB supports AirPrint) — the supported
path, works with no raster code. `POST /api/orders/<n>/print-label`
sends to the station's configured printer (raw socket 9100) and fails
soft to the AirPrint fallback. `GET/PUT /api/stations/<id>/printer-config`
stores ip/port/enabled/auto_print in the settings KV. Reprint button on
the In-Progress card now actually works (it called an undefined prop
before). **Remaining (needs hardware):** validate/convert the raw-socket
raster for the specific printer; build the Station Settings UI for
entering the printer IP (config endpoints are ready). "Auto-print on
Start" toggle is stored but not yet triggered on Start.

### [S] Apple Wallet pass (deferred)
"Add to wallet" link with pickup QR. Lower value than the receipt
that's now shipped — revisit only if a corporate client asks.

---

## P2 — structural cleanups

### [M] Multi-tenant support
Right now: one event per deployment. Multi-tenant lets one Railway
deployment serve N events. Adds `tenant_id` everywhere. Required
before pay-per-hour billing means anything — until then every client
needs their own Railway project.

Plan:
1. Migration adds `tenant_id` to orders, stations, settings,
   inventory, customer_questions, client_errors. NULL = legacy
   default tenant.
2. JWT carries tenant_id; every query gets a `WHERE tenant_id = %s`
   filter via a session-level Postgres setting or middleware.
3. Tenant management UI: super-admin role can create/edit tenants,
   assign Twilio numbers, etc.

Big project. Worth doing once Steve has 2 paying clients, not before.

### ✅ Catalog-first milk lookups (DEFAULT_MILK_TYPES demotion) — DONE 2026-06-12
`milkConfig.js` now exposes a sync `getCatalogMilks()` reading from a
module-level cache populated by `useCatalog('milk')`. All helpers
(`getMilkTypeById`, `getMilkTypeByName`, `getStandardMilks`,
`getAlternativeMilks`, `getAvailableMilks`, `getSimilarMilkSuggestions`)
prefer catalog. Hot call sites (`orderUtils`, `OrderDataService`,
`AvailableMilkOptions`) no longer import `DEFAULT_MILK_TYPES` directly.
The constant remains as the offline / pre-fetch fallback; mark
`@deprecated` and remove in a follow-up once we're confident the
catalog is universally reachable.

### [S] Move components into subdirs
80 top-level components in `Barista Front End/src/components/`.
Already partially organised (`barista-tabs/`, `organiser-tabs/`,
`support-tabs/`, `dialogs/`, `ui/`). Finish: move the rest into
`barista/`, `organiser/`, `display/`, `support/`, `shared/`, `auth/`.

### ✅ Smoke-test write paths for orders + users — DONE 2026-06-12
`POST /api/users/` smoke added (idempotent: 201 first run, 400 on
re-run). The runner now accepts a list of allowed statuses. Smoke
suite is up to 27 contracts: also covers quick-setup dry-run,
client-events, both SMS inbound webhooks, the customer receipt route,
the thermal label render, and printer-config.

---

## Known issues (found during deep testing 2026-06-12)

- **Frontend jest suite is broken at the harness level.** `react-scripts
  test` fails every test in `InProgressOrder.test.js` with
  `Cannot read properties of undefined (reading 'Provider')` — a
  test-setup/mock problem (a context Provider isn't mocked), present on
  the base branch, NOT caused by recent work. Raw `jest` fails even
  earlier (JSX not enabled). Until this is fixed, frontend changes are
  verified by babel-parse + the Cypress organiser smoke + manual run,
  not unit tests. Worth a dedicated fix: restore the test render
  wrapper / context mocks so the unit suite runs again.
- **Twilio webhook path was wrong in two scripts (fixed).**
  `update-twilio-webhook.py` / `check-twilio-webhook.py` pointed Twilio
  at `/api/sms/webhook` (405). Corrected to `/sms`. If inbound SMS ever
  "stops working" after running those scripts, this was why.

---

## P3 — UX polish

### ✅ "Send test order" button — DONE 2026-06-12 (in Readiness tab)
### ✅ event_name in page title — DONE 2026-06-12
### ✅ Walk-in: pre-fill last customer name — DONE 2026-06-12
### ✅ Drink picker: keyboard shortcut numbers — DONE 2026-06-12

---

## P4 — done so far (for orientation)

- 2026-06-12: Frontend crash visibility (`/api/client-errors`,
  ClientCrashesPanel, Cypress smoke, sendBeacon wiring), VIP
  tap-to-confirm, CORS smell-check, UserManagement edit crash fix,
  Quick Setup event identity + event accounts.
- 2026-06-10: BARISTA SMS escape hatch.
- 2026-06-09 batch: per-station queue filter, stock decrement
  commit fix, capabilities PATCH no-op fix, inactive station check,
  walk-in phone field tolerance, `/api/sms/send` rate limit + audit,
  pickup current_load decrement, ProxyFix middleware, ScheduleTab
  banner removal, Display screen size in order card.
- 2026-05-25 onwards: Catalog wireup (WalkInOrderDialog,
  InventoryManagement, StationCapabilitiesEditor, StationDefaults,
  GroupOrdersTab) + coffee_system catalog read. orderNumber
  camelCase aliases. ORDER_STATUS enum (frontend + backend).
  WalkInOrderDialog split. localStorage flipped to cache.
  console.log strip in prod. /api/health/full. Daily pg_dump.
  Backend hot-reload. JSDoc types. MenuManagement catalog sync.
- 2026-05-22 onwards: Catalog architecture + endpoints.
  Quick Setup wired. VIP-free pricing. Order reassign endpoint.
  Walk-in dialog reshape (category-then-drink, group lookup,
  walkin_defaults). Drink-name filter for Bean dropdown.
- 2026-05-21: Smoke test framework (`tests/smoke/`).
- Twilio webhook signature validation: ALREADY DONE (sms_routes.py
  line 71+). Earlier roadmap and CLAUDE.md flagged this as critical
  but it's been in place — kept here for the record so the next
  session doesn't re-investigate.

---

When picking a task, look for the [size] tag, scan the section it's
in, and start. Commit per logical change with the `Co-Authored-By`
trailer for Steve as committer.
