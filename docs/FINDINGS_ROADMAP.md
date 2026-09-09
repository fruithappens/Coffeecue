# Things found along the way

Not the work that was asked for — the things that turned up while doing it.
Each one is written so it can be picked up cold: what it is, how it was found,
what it costs, and what "fixed" would look like.

Ordered by what it costs you, not by how interesting it is.

---

## 1. Elapsed time is computed on the server, and it costs you the outage

**Status:** open. The cause of the 8 September outage is patched; the load
that triggered it is not.

`/api/orders` returns ~200 KB and every barista screen re-polls it several
times a second. That is the load that drained the connection pool and took
cupq.app down for two hours.

Revalidation is the obvious fix and it **does not work**, which is worth
knowing before someone tries it again: `waitTime` / `wait_time` are
minutes-since-created, recomputed server-side for every open order on every
request. They tick, so the payload changes, so an ETag never matches — for as
long as anything is in the queue, which is exactly when it matters. This was
shipped as #608 and reverted as #609 the same night.

**Fixed looks like:** the server sends `createdAt` and the *screen* counts.
Then the payload is stable between real changes and revalidation works.
`RushMixStrip` (promotes on `waitTime >= 10`) and `AllOrdersTab` ("Waiting N
min") both read the server's value today, so this is a UI change with real
consequences, not a one-line swap.

**Cost if ignored:** the next busy event has the same load profile that caused
the last outage.

---

## 2. Strict equality against ids that arrive as strings

**Status:** two instances fixed, no audit done.

`/api/orders` returns ids as **strings** (`'435'`). Any `===` against a number
is a control that silently does nothing.

This has already caused:

- **The dead Collected button** at Treenet. Steve: *"sometimes it seemed like
  it was stuck and could not select collected despite picked up."* Shipped as
  #606.
- Two test harnesses that passed only while a default happened to match.

**Fixed looks like:** a sweep for `=== ` / `!== ` against `.id`, `station_id`,
`orderNumber` and friends across the frontend, comparing as strings.

**Cost if ignored:** more dead buttons that look like flaky hardware. This is
the single most expensive bug class in the codebase's history.

---

## 3. Anything grouping by `created_at::date` is in the wrong timezone

**Status:** fixed **inside the report only**.

The server runs `TZ=UTC` to match Railway. Adelaide is UTC+9:30, so a 7am
start is 21:30 UTC the previous day. On Treenet that filed 144 of the first
morning's orders under the 2nd, reported the event as 463 orders instead of
577, and gave a coffee cart a "busiest hour" of 1am.

The report now converts through an `event_timezone` setting. **Nothing else
does.** Every other query that groups or filters by a bare date has the same
bug.

**Fixed looks like:** grep for `::date`, `CURRENT_DATE` and `DATE(` across
`routes/` and `services/`, and route each through the same window helper.

---

## 4. Demand you turned away is invisible

**Status:** partly addressed.

The report now shows `UNAVAILABLE_TAP` — someone tapping a drink or milk that
is switched off on the ordering screen. That was already being logged and
nobody had ever looked at it.

**Still invisible:** an SMS order refused for stock ("we've run out of
medium") is a `logger.info` line and never a row. Demand lost through that
door is not counted anywhere.

**Fixed looks like:** a small `refused_orders` table — what was asked for, why
it was refused, when. It is the number a caterer actually wants.

---

## 5. Dead paths from the four-interface model

**Status:** two found and fixed while converting screens. No audit.

Organiser and Support became the one runner app. Redirects still work, but
several screens *tell you to go somewhere that no longer exists*:

- Labels → *"Support → Integrations → Printers"* (fixed)
- Emergency → *"Organiser → Settings → Event Data → Import"* (fixed)

Both were found by reading a screen, not by any test.

**Fixed looks like:** grep the frontend for `Organiser →`, `Support →`,
`/support` and `/organiser` in **user-facing strings**, and correct the words
as well as the links.

---

## 6. Three component systems, now two

**Status:** largely resolved, worth finishing.

The app was built three times over:

1. Raw Tailwind, screen by screen
2. `components/ui/*` — a shadcn-style set used by four support screens
3. `src/design/*` — the CupQ design system

`ui/` has been restyled onto the palette, which fixed four screens at once.
The remaining question is whether `ui/` should exist at all or be folded into
`design/`. Two sets with overlapping jobs will drift again.

---

## 7. The committed `static/` folder is a lie

**Status:** open, low risk, high confusion.

Railway builds the frontend itself in the Dockerfile. The `static/` committed
to the repo is **several builds behind** what production serves — its
`index.html` points at a bundle production has not used for a long time.

It cost half an hour during a frontend fix, working out whether a rebuilt
bundle needed committing. It does not.

**Fixed looks like:** delete it, or add a README saying it is vestigial.

---

## 8. `alert()` and `window.confirm()` in a touchscreen app

**Status:** open.

Several screens still use browser dialogs — `SmsBlocklistTab` confirms an
unblock with `window.confirm`. On a tablet mid-service that is a modal you
cannot style, cannot theme, and which stops everything.

The app already has a Toast system and a `ConfirmDialog` component.

**Fixed looks like:** replace them. Left alone deliberately during the UI
rewrite because it is a behaviour change, not a look change.

---

## 9. A feature advertised but not built

**Status:** open, tiny.

Emergency lists *"Still to build: Reset All Stations — a bulk version of
taking stations offline one at a time."* It has been sitting on the screen
telling the operator about something that does not exist.

**Fixed looks like:** build it, or take the line off the screen.

---

## 10. Test harnesses that pass by luck

**Status:** three instances fixed.

Three separate harnesses passed only while a default happened to line up:

- The barista drill clicked the **first** Collected button, so it only passed
  on a freshly wiped database.
- `stuck_collected` never pinned the tablet to the station its order landed
  on, so it depended on routing.
- The UI scorer counted `SelectRow` and `TextField` — design-system components
  that render a real `<select>`/`<input>` — as unconverted, so a finished
  screen could never reach zero.

Each was found by a failure that looked like an app bug and was not.

**Worth remembering:** a green test that depends on an accident is worse than
no test, because it is trusted.

---

## 11. `legacy: 0` is not the same as "looks like the app"

**Status:** found by looking at screenshots, not by any score. Two screens
fixed; no audit.

The sweep counts old Tailwind colour classes. A screen can reach **zero and
still not belong**, because the score cannot see:

- **Table headers** in plain grey rather than the small-caps caramel the report
  and blocked-numbers tables use
- **Title Case** where the rest of the app is sentence case
- **Raw numbers where words belong.** Printers showed `61142s ago` for a
  printer that last spoke seventeen hours earlier. The operator should not have
  to divide.
- **A column running off the right edge** of a table that does not scroll in
  its own box
- **Dead paths in the words**, not the links — see finding 5, which has now
  turned up three times

Printers was the example: `legacy: 0`, and every one of the above.

**Fixed looks like:** the score stays the gate, but a screen is not finished
until somebody has *looked* at it beside `docs/ui/report.png`. That instruction
is in the prompt; this is the evidence for why.

---

## 12. Quick Setup is the last screen and the least like the others

**Status:** open. Deliberately left until last.

2,274 lines, and the screen an operator uses when they are already stressed.
Looking at it beside the converted screens:

- Bare checkbox grids instead of setting rows — no icons, no consistent spacing
- Every section carries two or three lines of grey explanation, which is
  exactly what the conversion strips everywhere else
- **"Save pricing" overlaps the "Enable pricing" checkbox** — a real layout bug
- Buttons in three different styles on one page
- The event name field shows `coffeecue`, which is the *system* name leaking
  into the event's

**Fixed looks like:** its own session, with the layout bug fixed first because
that one is not cosmetic.

---

## 13. The system holds exactly one event at a time

**Status:** open — a decision for Steve, not a bug.

Steve asked whether two events running at once could be separated by the door
and the event code, or whether they need separate instances. Checked the
schema rather than guessed:

- **The event code is a lock, not a router.** One value in one settings row.
  It answers "are you at this event" — yes or no. There is no second code to
  compare against and it has no connection to stations.
- **No table has an event column.** All 35 of them. `orders` is scoped by
  `station_id` only; `settings` has `key` as its whole primary key, so
  branding, menu, event name, SMS wording and the access code each exist
  exactly once. (`event_id` in the code is EventsAir's ID for pulling
  attendee data — unrelated.)
- **One Twilio number per instance.** `TWILIO_PHONE_NUMBER` is a single env
  var and the inbound webhook never reads which number was texted.

Two events on one instance today would share menu, stock, branding, station
list, order numbers and the report. Making one instance multi-event means an
event column on ~10 tables, a composite key on `settings`, and a scoping
clause on **358 queries across 29 files** — where a single miss puts one
event's order on the other event's screen.

**Fixed looks like:** a second Railway service + Postgres + Twilio number +
subdomain. Config, not code, and the isolation is total. Revisit only if
concurrent events become routine rather than occasional.

---

## 14. The sweep scored 30 screens; the app has far more than 30 surfaces

**Status:** open — the real remaining work, and bigger than "2 screens to go".

Steve asked whether everything is consistent or something escaped. Audited
it properly instead of trusting the scoreboard. 29 of the 30 scored screens
are genuinely clean. The scoreboard was blind to everything you cannot
reach by clicking a nav item on an already-loaded page.

**42 of 121 component files still lean legacy** (raw grey Tailwind classes
outnumbering `cq-` ones); **32 carry five or more**. By group:

- **Dialogs — 5 untouched, zero design-system classes between them.**
  EditOrder (19), Message (14), MoveOrder (10), Broadcast (8), WaitTime (6).
  A barista opens these more often than most nav screens. ConfirmDialog is
  the one that was done.
- **Barista panels, confirmed reachable** (they render inside
  BaristaInterface.js): QueueIntelligence (23), StationLoadBalancer (20),
  EnhancedStationCapabilities (28), DynamicStaffAllocation (29),
  MultiLevelInventory (14), StationChat. Plus ToolsTab (31/2),
  StationPrinterPanel (17), StationCapabilitiesEditor (18), StationChooser
  (9), EightySixBoard (7).
- **Customer surfaces wear the brand but not the vocabulary.** Phase 6 gave
  them the event's colours; it did not put them on the shared components.
  KioskOrder (76/1), KioskAdminPanel (14/0), HowToOrderPage (11/3),
  MobileOrderPage (10/0).
- **Login and Unauthorized** — the first screen anyone sees. Never touched.
- **A dead branch still in the bundle.** `Organiser.js` imports the old
  16-tab `OrganiserInterface` in App.js but never renders it (`/organiser`
  redirects to the runner). Not user-reachable, but it ships in every
  download and is exactly what comes back to life by accident. Delete it.

**The scorer lied by omission.** It counts raw classes in a loaded DOM, so
a modal that is not open scores nothing, and finding 11 already showed a
screen can score 0 and still read as legacy. Green means "nothing obvious
on the page as loaded", not "done".

**Fixed looks like:** four batches — dialogs (5 files, biggest visible win
per hour), barista panels (11), customer surfaces (4), Quick Setup alone —
plus deleting the dead Organiser branch, plus teaching the sweep to open
modals or it will keep reporting green.

---

## Still on Steve

Not findings — decisions and config that only he can make.

| | |
| --- | --- |
| `beans_grams_per_shot` on production | still 22, so every single-shot drink records a double |
| Postgres password | appeared in logs during the outage; not in the repo |
| TSP143IV SK polling time | 30 s from the factory — the whole reason labels were slow |
| `CLOUDPRNT_SHARED_SECRET` | `/cloudprnt` is open until it is set |
