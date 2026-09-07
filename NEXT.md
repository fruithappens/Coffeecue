# CupQ Next — the test copy

A full copy of CupQ on this Mac, loaded from a production export, used to build and judge
the re-imagining. **Production is never touched from here.** It cannot text or email anyone:
`TESTING_MODE=True` and no Twilio / EventsAir / SMTP credentials exist in its `.env`.

    ./next.sh      start (backend + built front end on http://localhost:5001; prints the Wi-Fi address)
    ./stop.sh      stop
    ./build.sh     rebuild the front end after changing "Barista Front End/src", then restart

The backend runs with `TZ=UTC` (as on Railway) -- server timestamps are UTC, so the screens'
UTC parsing matches. Sign in: coffeecue / adminpassword. Data: `data/load_snapshot.py <export.json>` loads a fresh
production export (Organiser → Settings → Event Data) — all tables, orders included.
Branch: `next` (never auto-deploys; Railway only deploys `main`). Every screen shows a red
"TEST COPY" stripe (from `GET /api/env`; production shows nothing).

## Phase log

- **Phase 0** — the copy itself (021f47e, 3878b3e).
- **Phase 1** — clear the ground: 35 dead front-end files, the server-rendered admin, do-nothing screens and doors (157129b).
- **Phase 2** — the server is the truth. A tablet is asked which station it is at (no more silent "station 1");
  station name, location and barista live only on the station record (`PATCH /api/stations/<id>`), never in
  per-device localStorage; the barista settings re-sync whenever the record changes (30 s poll), so a name
  saved on one tablet reaches the other; one customer status vocabulary (`constants/customerStatus.js`) on the
  phone beacon and the "my coffee" page; the public display board takes its station list from the public
  `/api/display/config` (it could never read the authenticated `/api/stations`, so it showed a hardcoded
  "Coffee Station 1 / 2 / 3"); `station_stats` twin columns (`name`/`notes`, `location`/`equipment_notes`) are
  now written together so the display config, support views and labels can never disagree with the API.
  Checkpoint (headless, 29 checks): two tablets sign into different stations, the organiser renames one on
  the server, the tablets are swapped, one saves a barista name and the other sees it — nothing stale on
  either device.

- **Phase 3** — the design system, built as code first (f846f3d, 7826073). `src/design/tokens.css` (the caramel
  family, warm neutrals, one green, one red, 4-pt space, radii, shadows) + `tailwind` `cq-*` utilities; Manrope
  (OFL) self-hosted at `/fonts/`; nine primitives in `src/design/` (AreaMark, Button, Pill/StatusPill,
  StationChip, OrderCard, BigNumber, TabBar, SidebarNav, PinPanel); the component sheet at `/design`.
  Scoped to `.cq` — no live screen changes until Steve approves the sheet. `testbench/design/snapshot.js`
  turns the sheet into standalone HTML (`design-system/`, untracked) for sharing and for Claude Design
  (push needs a one-off `/design-login` in an interactive Claude Code session).

- **Phase 4** — the barista queue screen on the design system (5756f01 +). `components/barista/queue/`:
  QueueHeader (area mark, this station, the watched carts — capped at 3, chosen in StationPicker — one
  status line that is red only when something is broken, the lock), QueueColumn (ONE column: Making →
  Up next → Ready to hand over; one primary action per card, the rest behind "…"; the station-level
  tools behind the Up next "…"), AdminSheet (PIN-gated: rush/team mode, station, sound, zoom, refresh,
  station settings, screens, session, organiser tools, iPad escape hatch, reload + version, sign out).
  PIN = the event's kiosk PIN (`settings.kiosk_pin`, 4–6 digits; default 1234 until set). Three tabs:
  Queue · Stock · Tools. Removed from BaristaInterface: the old header, both tab bars, the three-column
  board, the bottom action bar, the old card renderers and the four pending-column files (-1,200 lines).
  Layout (Steve's call after seeing 8 making / 20 waiting / 5 ready): LANES on a landscape tablet or laptop
  (`useLanesLayout`: min-width 1024 landscape, or ≥1280) — Making | Up next | Ready side by side, each
  scrolling inside the screen with pinned headings, no page scroll (root `h-screen` while the Queue tab is
  open); COLUMN on phones/portrait with a pinned jump bar and a Ready strip fixed to the bottom. Making
  auto-compacts above 4; the Steam line filters the bench by milk; the rush-mix strip rides inside Up next.
  Walk-up orders (Steve: no 'add another', long black defaulted to milk): the Walk-up button opens the
  CUSTOMER form (`display/KioskOrder`, `channel='walkin'`, `stationId` = this station) — same drink questions,
  sizes, "Add another coffee" (group `/api/display/order-group`), "Collect here / Fastest". Stamped
  channel+surface `barista`, `order_type` walk-in (route tweak). `dialogs/WalkInOrderDialog.js` deleted.
  Sort (Steve: newest was on top, old ones at risk): Oldest (default, fair queue, priority on top) · Newest · Milk ·
  VIP only; age = server waitTime; per-device (`coffee_cue_queue_sort`); the bench follows the same sort.
  Unlock window: a correct PIN unlocks the tablet for 10 min (sessionStorage `coffee_cue_unlocked_until`;
  header lock shows UNLOCKED; "Lock now" in the sheet; sign out relocks). Every non-queue page shows the tab
  bar (even in rush mode) and a "Back to the queue" button.
  The sweep: `src/design/legacy.css` re-points the old Tailwind colour classes at the palette inside
  `.cq-legacy` (grey→warm ink/cream, amber→caramel/roast, blue→caramel, green/red stay attention). Applied
  to the barista's non-queue tabs, `/organiser` and `/support`. Each page is still rebuilt properly in its
  own phase; this makes them one family meanwhile. build.sh runs eslint `no-undef` + `react/jsx-no-undef`
  on the barista screen + design system before building (a cleanup once cut `SoundChoiceRows`, which
  compiled fine and crashed the settings tab into the error boundary).
  Checkpoint: the rush drill — 30 orders in 90 s worked through the UI (`scratchpad capture/rush_drill.js`
  headless; Steve on the iPad for real).

- **Phase 5** — the runner app at `/run` (72b279c +). One app for the person running the event, replacing
  the Organiser and the Support interface, which overlapped on Operations, Users and Messages.
  `components/runner/`: `runnerNav.js` (NAV / TABS / TITLES / ALIASES / readHash) and `RunnerInterface.js`.
  Map: **Set up** Quick Setup · Menu · Stations · Branding · Schedule · People — **Run the day** Live
  (Readiness / Board / Metrics) · Orders · Messages (Broadcast / Test / Blocked) · Printers — **Review &
  system** Report · System (Health / Diagnostics) · EventsAir · Settings · Emergency · Help. Nothing
  dropped; the duplicate Crashes tab went (Diagnostics lists them). Shell on the design system, panels
  inside `.cq-legacy` until each is rebuilt. `/organiser` and `/support` redirect to `/run` carrying the
  hash; old section names aliased; `roleLanding` sends staff/organiser/admin/support to `/run`.
  Headless: 28/28 destinations render, both old doors land right, phone drawer works.
  Checkpoint: set up a made-up event from nothing with only the checklist, timed — under 15 minutes.

## When this copy replaces production (phase 9) — one-off data steps

    -- station_stats twin columns: older rows were only ever written on one side.
    UPDATE station_stats
       SET name = COALESCE(NULLIF(notes,''), name),
           location = COALESCE(NULLIF(equipment_notes,''), location);

Tablets keep their chosen station (`coffee_cue_selected_station`); the retired per-device keys
(`coffee_station_name_*`, `coffee_barista_name_station_*`, `coffee_station_location_*`,
`coffee_station_barista_*`) are simply never read again.
