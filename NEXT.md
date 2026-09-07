# CupQ Next — the test copy

A full copy of CupQ on this Mac, loaded from a production export, used to build and judge
the re-imagining. **Production is never touched from here.** It cannot text or email anyone:
`TESTING_MODE=True` and no Twilio / EventsAir / SMTP credentials exist in its `.env`.

    ./next.sh      start (backend + built front end on http://localhost:5001; prints the Wi-Fi address)
    ./stop.sh      stop
    ./build.sh     rebuild the front end after changing "Barista Front End/src", then restart

Sign in: coffeecue / adminpassword. Data: `data/load_snapshot.py <export.json>` loads a fresh
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

## When this copy replaces production (phase 9) — one-off data steps

    -- station_stats twin columns: older rows were only ever written on one side.
    UPDATE station_stats
       SET name = COALESCE(NULLIF(notes,''), name),
           location = COALESCE(NULLIF(equipment_notes,''), location);

Tablets keep their chosen station (`coffee_cue_selected_station`); the retired per-device keys
(`coffee_station_name_*`, `coffee_barista_name_station_*`, `coffee_station_location_*`,
`coffee_station_barista_*`) are simply never read again.
