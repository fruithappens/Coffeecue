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

---

## P0 — demo readiness (do next)

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

### [M] Structured logging with event_codes
Today: `logger.error("Something broke: %s", e)` — ungreppable.
Better: every logger.error/warning gets a stable `event_code`
(SMS_PARSE_FAIL, STOCK_DECREMENT_FAIL, etc.). A future log
collector (Datadog/Logflare) can alert on rate-of-event_code.
Backend: introduce `services/logging_utils.py:event(code, **fields)`.
Frontend: `services/logging.js:event(code, payload)` that POSTs to
`/api/client-events` (sibling of `/api/client-errors`).

### [M] Consolidate startup scripts
6 shell scripts (`start_expresso.sh`, `_fast.sh`, `_complete.sh`,
`_with_twilio.sh`, `_enhanced.sh`, `quick_start.sh`) — operators
have no idea which to run. Replace with ONE `start.sh` with flags:
`--with-ngrok`, `--with-twilio`, `--fast`, `--background`. Delete
the rest. Update README.

### [S] Customer-facing PDF receipt / Apple Wallet pass
When the order's ready, the SMS can include a link to a PDF receipt
with the event branding (and, for VIPs / corporate events, a
reimbursable record). Apple Wallet pass = "Add to wallet" link,
QR for pickup. Cheap to build (already have PDFKit-equivalent
options), high client-perceived polish.

### [S] Per-event post-event summary email
At event close, generate a one-page PDF: total orders, peak hour,
top drinks, busiest station, avg wait. Email to the operator
(and optionally to the client). Sells the next event. Same template
engine as the receipt.

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

### [S] Delete DEFAULT_MILK_TYPES constant
Now only used by legacy helpers. Refactor `milkConfig.js` to call
`useCatalog` internally, expose a sync `getCatalogMilks()` from the
module-level cache, delete the constant. Touch: `milkConfig.js`,
`orderUtils.js`, `AvailableMilkOptions.js`, `OrderDataService.js`.

### [S] Move components into subdirs
80 top-level components in `Barista Front End/src/components/`.
Already partially organised (`barista-tabs/`, `organiser-tabs/`,
`support-tabs/`, `dialogs/`, `ui/`). Finish: move the rest into
`barista/`, `organiser/`, `display/`, `support/`, `shared/`, `auth/`.

### [S] Smoke-test write paths for orders + users
We've now got a smoke for catalog POST. Add: `POST /api/orders`
(walk-in create), `POST /api/users/` (account create). Both are
high-traffic write paths that have had recent regressions.

---

## P3 — UX polish

### [S] "Send test order" button for Quick Setup demo
After Quick Setup applies, a "Place a test walk-in order" button
that fires a sample order through the system end-to-end. Demos
in one click.

### [S] Show event_name in the page title
Currently the browser tab just says "Coffee Cue". `${event_name} —
Coffee Cue` makes it obvious which event window is which when an
operator has three tabs open.

### [S] Walk-in dialog: pre-fill last customer name when re-opening
Often the next walk-in is from the same group. Pre-fill the field
with the previous order's customer name, dimmed. Tap once to clear.

### [S] Drink picker: keyboard shortcut numbers
1–9 along the bottom of the walk-in dialog map to the first 9 drinks.
Speeds up high-volume events significantly.

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
