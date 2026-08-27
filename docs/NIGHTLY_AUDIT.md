# Nightly Audit Plan

Steve, 2026-08-26: "here we are 400 versions on and there are 5kg of
latte in the event stock under coffee. and fields that dont save and qr
codes that go to different places."

This is the standing plan for evening audit sessions. Any Claude session
can run it: read this file, run the next sweep in the rotation, open PRs.

## Why sweeps, not "read all the code"

~175,000 lines across 458 first-party files. Reading it linearly is slow
and finds little, because the bugs here are not localised typos — they
are RELATIONSHIP bugs between distant pieces. Every serious bug found on
2026-08-26 belongs to one of five diseases:

1. **Placebo success** — UI reports success it did not achieve.
   (Station location "saved successfully" while sending nothing; alert
   fired unconditionally.)
2. **Two stores for one fact** — writers and readers disagree on where
   truth lives. (Three menu stores; vip flag vs queue_priority;
   extra_hot vs temp; location vs equipment_notes; two order
   serializers.)
3. **Hardcoded copies of config** — a list that duplicates what config
   should drive. (Six hardcoded menus found; bean tiles.)
4. **Field drops across layers** — saved server-side, absent from a
   serializer, or sent and never rendered. (notes/shots/bean_type
   missing from the pending card.)
5. **Fail-open silence** — a guard that, when it cannot decide, quietly
   allows everything. (Milk fallback discarding the station filter;
   printer 2xx statuses all treated as healthy.)

A sweep targets one disease across the WHOLE codebase, which is how one
evening finds the fifth copy instead of fixing the fourth.

## The rotation (one per evening)

- **Sweep 1 — Placebo hunt.** Every success toast / alert / "saved"
  message in the frontend. Trace each to an awaited server result.
  Unawaited or unconditional = finding.
- **Sweep 2 — Write/read pairing.** Every key written into
  order_details, settings KV, and localStorage. Find its readers. Written
  but never read, or read under a different name = finding. (AST/grep.)
- **Sweep 3 — Hardcoded census.** Literal lists of drinks, milks, sizes,
  prices, station names, phone numbers, URLs in JS + PY. Diff against
  the accessors (`_get_available_*`, `/api/display/menu`, catalog).
- **Sweep 4 — Dead controls.** Buttons whose handlers reach no API call
  or state change; form fields not included in their submit payload;
  components never imported (e.g. the orphan `SettingsTab.js`).
- **Sweep 5 — Journey diff on the local bench.** Place orders on every
  channel (SMS sim, kiosk endpoint, walk-in payload), then diff the
  stored row field-by-field against what was requested, INCLUDING after
  an edit. Never against production data.
- **Sweep 6 — Stock ledger.** On a scratch DB: place orders of known
  composition, complete them, verify each ingredient moved by the right
  amount and NOTHING ELSE moved. (This is what would have caught decaf
  burning house blend.)
- **Sweep 7 — Fail-open review.** Every `except: pass`, every `or
  default`, every fallback branch: does failure stay visible (log +
  health endpoint), or silently widen behaviour?

## Rules

- Findings become PRs; nothing merges without green CI, and nothing
  auto-merges at night while Steve may be testing.
- Production data is read-only during sweeps. Journeys run on the local
  bench (see testbench/ docs). Bench phone numbers only (+6140000…).
- Every confirmed finding class graduates into a PERMANENT CI check in
  `scripts/ci_consistency_checks.sh` — the checks are the compounding
  asset (7 today; two of them found sibling bugs the day they were
  written).
- Each sweep ends with a written result even when clean: "swept X,
  found nothing" is a result; silence is not.
- No silent caps: if a sweep samples rather than covers, say what was
  skipped.

## State

Record each run at the bottom of this file: date, sweep number,
findings, PRs.

- 2026-08-26: pre-rotation session sweep (claims audit) — 33 checks,
  1 real finding (pending card dropped notes/shots/bean, PR #410),
  2 open items (station 3 unnamed+active; "QR to wrong place" needs a
  concrete example from Steve).
- 2026-08-26/27 overnight (rebuild night 1): recipe layer built (R1,
  #421) and hammered by a 25-scenario live matrix, three rounds. Found
  and fixed: NULL-name recipe rows duplicating per boot (#423);
  threshold-as-floor gate semantics (#423); "double shot decaf latte"
  losing the decaf at parse AND strength never reaching the bean math
  (#425, #426); event-menu bridge REPLACING the stock filter (#424);
  espresso base list unable to ADD menu drinks (#424); gate ignoring
  unlimited_stock_mode while the menu honoured it (#428) plus the
  mode's forever-cache (now 10s TTL); duplicate ingredient rows
  blinding the gate (#429). Probes added: /api/recipes/check (incl.
  ?order=NN stored-shape mode) and /api/recipes/milks-debug. Final
  matrix: 24/25, last fail a poisoned-txn 400 (fixed after). Railway
  missed one deploy (re-push nudge worked, as memory predicted).
- 2026-08-27: Sweep 1 (placebo hunt) — 29 success-message candidates
  scanned, triaged to 2 live placebos + 5 orphan components. Fixed:
  the barista "Custom Message" field claimed a Display-footer update
  that never left the device (setSettings is localStorage; the Display
  reads the backend) — now syncs the server and claims success only on
  its yes; notification-settings toast fired success even when the
  backend sync failed — now honest both ways. Deleted orphans (each
  carrying placebo alerts waiting to be rewired): ModernBaristaInterface
  + its HelpDialog ("In a real application, this would call an API" —
  told baristas help "has been sent" while console.logging),
  SystemModeToggle, EventSetupPanel, StockManagementSection. Also this
  run: Railway volume verified live (on_volume: true, 2 auto-backups
  already on it), Demo/Cafe preset shipped (#443). Carried forward:
  GET /api/inventory ignores ?station_id= filter; DisplayTab's
  "automatically saved!" alert unverified.
