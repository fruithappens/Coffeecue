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

## Still on Steve

Not findings — decisions and config that only he can make.

| | |
| --- | --- |
| `beans_grams_per_shot` on production | still 22, so every single-shot drink records a double |
| Postgres password | appeared in logs during the outage; not in the repo |
| TSP143IV SK polling time | 30 s from the factory — the whole reason labels were slow |
| `CLOUDPRNT_SHARED_SECRET` | `/cloudprnt` is open until it is set |
