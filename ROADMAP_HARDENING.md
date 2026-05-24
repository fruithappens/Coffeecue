# Hardening roadmap

Prioritised follow-up work from the 2026-05-22 brittleness audit
(see `CLAUDE_ONBOARDING.md` §8). Sized by effort: S = under 1h,
M = half-day, L = full day, XL = multi-day.

Pick from the top — items higher up unblock items below them.

---

## P0 — catalog migration

DONE this round (2026-05-25):
- ✅ WalkInOrderDialog uses useCatalog('milk') — canonical names in dropdown
- ✅ InventoryManagement Add form has catalog-backed datalist autocomplete
- ✅ StationCapabilitiesEditor uses catalog for checkbox lists + name canonicalisation
- ✅ StationDefaults + GroupOrdersTab use useCatalog('milk')
- ✅ coffee_system._STANDARD_DRINK_MENU now reads from catalog_items
- ✅ /api/orders/pending exposes orderNumber camelCase alias

STILL PENDING:

### [M] Wire MenuManagement to /api/catalog/drink (refactor)
MenuManagement has rich per-drink metadata (sizes, prices, recipes,
shots, milkRatio) that doesn't map cleanly to catalog. Proper fix:
catalog provides the master drink list (which drinks exist), menu
stores per-drink overrides (which sizes/prices for THIS event).
Refactor; not a one-line wireup. Touch:
`Barista Front End/src/components/MenuManagement.js`,
introduce `event_drink_config` table.

### [S] Delete DEFAULT_MILK_TYPES
Now only used by:
- `milkConfig.js` helpers (getMilkTypeById, getStandardMilks, etc.)
- `orderUtils.js` (one normalisation lookup)
- `AvailableMilkOptions.js` (utility component, internal use)
- `OrderDataService.js` (passes the list as part of a settings blob)
- WalkInOrderDialog + StationDefaults + GroupOrdersTab as offline
  fallback only

Refactor the helpers in milkConfig.js to call useCatalog internally,
or expose a sync `getCatalogMilks()` from the module-level cache.
Then delete the constant.

### [S] Delete `_STATIC_FALLBACK` synonym map
The capability check has a static fallback used only when
catalog_items query fails. Keep it for resilience; not blocking.

---

## P1 — structural cleanups that prevent whole bug classes

### [S] Add `orderNumber` to `/api/orders/pending` response
Smoke-test discovery: this endpoint sends `customerName` + `customer_name`
dual-cased for most fields but only `order_number` (snake) for the
order number — no `orderNumber` camelCase variant. Frontend currently
works because something is mapping it, but the inconsistency means the
contract test had to accept the snake-case version. Add the camelCase
alias for consistency with the rest of the payload. Touch:
`routes/consolidated_api_routes.py` lines ~660-700 (orders/pending).

### [M] Frontend `ORDER_STATUS` enum + backend constant
Status strings `'pending'`, `'in-progress'`, `'completed'`,
`'picked_up'` appear as string literals across 100+ sites. A
typo (`'in_progress'` underscore) silently breaks queries. Add:
- `Barista Front End/src/constants/orderStatus.js` exports the
  enum + helpers (`isPending(o)`, etc.)
- Python equivalent in `services/order_status.py`
- Search/replace literal strings (carefully — some are DB values
  that must stay literal).

### ~~[M] Drop notes-keyword VIP auto-detection~~ — DONE 2026-05-25
Removed from handleChange + handleSubmit. Group-lookup keeps a
tightened word-boundary regex version (operator-typed notes are
more trustworthy than free-text customer notes).

### [L] Backend hot-reload in dev mode
Add Flask dev mode toggle (`FLASK_ENV=development` + `app.run(debug=True)`)
behind an env flag. Avoid in production. This eliminates the
"need to restart for every backend change" friction. Watch out:
double-instantiates background services (Twilio reminder thread),
so guard those with `WERKZEUG_RUN_MAIN` check.

### [M] Consolidate startup scripts
Replace `start_expresso.sh`, `start_expresso_fast.sh`,
`start_expresso_complete.sh`, `start_expresso_with_twilio.sh`,
`start_expresso_enhanced.sh`, `quick_start.sh` with ONE script
that takes flags: `--with-ngrok`, `--with-twilio`, `--fast`,
`--background`. Delete the duplicates.

### [L] Type-safety pass on the frontend
Adopt JSDoc types or migrate to TypeScript incrementally. Start
with shared types: `Order`, `Station`, `CatalogItem`, `User`. The
catalog work would benefit immediately because passing a string
where an `id` is expected (or vice versa) is a class of bug we
keep hitting.

---

## P2 — code organisation

### [M] Split WalkInOrderDialog.js (~1600 lines → ~400 + 3 hooks)
- Extract `useStationInventory(stationId)` — currently inline in dialog
- Extract `useWalkinDefaults()` — currently inline
- Extract `useGroupLookup()` — group code lookup state
- Render component becomes pure / declarative

### [M] Replace localStorage primary-store for stock
`coffee_stock_station_<id>` is read FIRST, API is fallback. Should
be the other way around. Use stale-while-revalidate: render
localStorage immediately for instant paint, refetch in background,
overwrite localStorage with API response. Touch:
`WalkInOrderDialog.loadStationInventory`, `useStock.js`,
`StockService.js`.

### [S] Move 80 top-level components into subdirs
`barista/`, `organiser/`, `display/`, `support/`, `shared/`,
`auth/`. Already partially done — finish it.

### [M] Strip `console.log`s from prod build
Babel plugin `babel-plugin-transform-remove-console` configured to
strip in production builds, leave in dev. Currently the prod bundle
ships hundreds of console statements.

---

## P3 — observability

### [M] Replace ad-hoc try/catch console.error with structured logging
Both backend (`logger.error` patterns) and frontend (`console.error`)
should produce structured events that something could ship to a log
collector (Datadog, etc.). Minimum bar: every error has a stable
`event_code` so we can grep production logs.

### [M] Add health-check endpoint richer than /api/health
Current `/api/health` returns `{status: 'ok'}`. Add a `/api/health/full`
that checks: DB reachable, Twilio configured, pending migrations,
recent error rate, queue depth. Surface in the Support → System
Health tab.

### [S] Smoke-test the catalog endpoint contract
Already done (added 2026-05-22). Should also add a smoke for
POST /api/catalog (creating a custom item) — currently no test
exercises the write path.

---

## P4 — UX polish

### [S] Make VIP checkbox visually loud when ticked
Red border + red bg when on, so accidental ticks are obvious before
submit. Cheap.

### [S] Tap-to-confirm for VIP submissions
Modal: "Submit this as a VIP order? Yes / No / Cancel".

### [M] Drink-category picker → catalog-driven
The walk-in dialog already has a category-then-drink picker but the
categories are hardcoded (`'tea'`, `'hot_chocolate'`, etc.). Should
derive from `catalog_items.subcategory` so new subcategories appear
automatically.

### [S] Cleanup stale `.md` docs
20+ docs in root. Most are snapshots of prior fix sessions. Delete
or fold into CLAUDE_ONBOARDING.md. Keep: CLAUDE.md, ARCHITECTURE.md,
API-REFERENCE.md, this file, CLAUDE_ONBOARDING.md.

---

## P5 — operational

### [M] Daily backup script + restore-tested
The DB has months of order data. There's no scheduled backup
visible in cron. Add a `pg_dump` cron + S3 upload, plus a
documented restore procedure.

### [L] Multi-tenant support
Right now the app is single-event-per-deployment. Multi-tenant
would let one deployment serve N events without database swaps.
Requires: tenant_id on all rows, settings scoped to tenant,
station_id namespaced. Big project.

### [S] Production-mode CORS config
`CORS_ALLOWED_ORIGINS` is a comma list in `.env`. Document the
production values. Add a startup warning if the production deploy
is using `*` as origin.

---

## Done so far (for orientation)

- 2026-05-25 overnight: Catalog wireup completed for WalkInOrderDialog,
  InventoryManagement, StationCapabilitiesEditor, StationDefaults,
  GroupOrdersTab. Backend coffee_system._STANDARD_DRINK_MENU now
  reads from catalog_items. Notes-keyword VIP auto-detection
  removed. orderNumber camelCase alias added to /api/orders/pending.
- 2026-05-22: Catalog architecture (backend + Quick Setup wired)
- 2026-05-22: Synonym table in capability check (interim, will be
  replaced by full catalog wireup)
- 2026-05-22: `OrderDataService.createWalkInOrder` no longer forces
  `priority: true`
- 2026-05-22: Walk-in dialog reshape — wider, sticky footer,
  group lookup at bottom
- 2026-05-22: Walk-in dialog category-then-drink picker
- 2026-05-22: Drink-name filter for Bean Type dropdown
- 2026-05-22: Walk-in placeholder dedup fix (2-min auto-expiry)
- 2026-05-22: Walkin defaults setting (per-event configurable)
- 2026-05-22: VIP-free pricing toggle
- 2026-05-21: Order reassign endpoint + Move dialog
- 2026-05-21: Smoke test framework (`tests/smoke/`)
- 2026-05-20: Self-test + repair proposal (`SELF_TEST_REPAIR_PROPOSAL.md`)

---

When picking a task, look for the [size] tag, scan the section it's
in, and start. Commit per logical change with the `Co-Authored-By`
trailer for Steve as committer.
