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
  inbound is routed by URL (`/api/sms` Twilio, `/api/sms/clicksend`,
  `/api/sms/cellcast`). Opt-in via `SMS_USE_PROVIDER_FACTORY=true`
  for now — legacy Twilio path stays default until shaken down in
  staging. Disaster-recovery story: flip env, redeploy, outbound
  swaps provider with no code change. Per-provider health checks
  in `/api/health/full` + `.env.example` documented + smokes added
  for the new inbound routes. See `services/sms/README.md`.

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

### [M] Thermal sticker printer integration (network printer path)
Brother QL-820NWB or equivalent. Per-station label printing on
"Start" so baristas track cups by order number + customer name +
drink details + event branding. Reprint button on the order card.
Spec:
- Backend `POST /api/orders/<id>/print-label` accepts station_id,
  builds a 62mm raster image, POSTs to the printer's IP (per-station
  configured in Station Settings).
- Frontend toggle in Station Settings: "Auto-print on Start"
- Reprint button on Pending and In-Progress order cards.
- Logo + event_name come from branding_settings.
- Failure mode: printer offline → toast, don't block the order.

Cheap Bluetooth printers (Phomemo M120 etc) won't work — iOS
Safari has no Web Bluetooth. Network printers are ~$300, do AirPrint
+ raw socket, same family every café POS uses.

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

### [M] Thermal sticker printer integration (network printer path)
Brother QL-820NWB or equivalent. Per-station label printing on
"Start" so baristas track cups by order number + customer name +
drink details + event branding. Reprint button on the order card.
Spec:
- Backend `POST /api/orders/<id>/print-label` accepts station_id,
  builds a 62mm raster image, POSTs to the printer's IP (per-station
  configured in Station Settings).
- Frontend toggle in Station Settings: "Auto-print on Start"
- Reprint button on Pending and In-Progress order cards.
- Logo + event_name come from branding_settings.
- Failure mode: printer offline → toast, don't block the order.

Cheap Bluetooth printers (Phomemo M120 etc) won't work — iOS
Safari has no Web Bluetooth. Network printers are ~$300, do AirPrint
+ raw socket, same family every café POS uses.

### [S] Customer-facing PDF receipt / Apple Wallet pass
When the order's ready, the SMS can include a link to a PDF receipt
with the event branding (and, for VIPs / corporate events, a
reimbursable record). Apple Wallet pass = "Add to wallet" link,
QR for pickup. Cheap to build (already have PDFKit-equivalent
options), high client-perceived polish.

### [S] Post-event summary email auto-send (follow-up)
Requires SMTP config (`EMAIL_ENABLED=true`, `SMTP_*` env vars).
Backend: render the same `/api/reports/today/print?view=post` HTML
into an SMTP MIME message and POST to a `/api/reports/post-event/email`
endpoint with the recipient. Bell rings when post-event is generated,
operator clicks "Email this to the client" → one round-trip.

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

### [S] Smoke-test write paths for orders + users
We've now got smokes for catalog POST, walk-in POST, and quick-setup
dry-run. Still needed: `POST /api/users/` (account create) — recent
regressions in this path that the catalog/order smokes wouldn't catch.

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
