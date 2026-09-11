# Things found along the way

Not the work that was asked for — the things that turned up while doing it.
Each one is written so it can be picked up cold: what it is, how it was found,
what it costs, and what "fixed" would look like.

Ordered by what it costs you, not by how interesting it is.

---

## 1. Elapsed time is computed on the server, and it costs you the outage

**Status:** BUILT 12 Sep — PR #625, awaiting merge. The list no longer
carries `waitTime`; `utils/orderTime.js` stamps it on arrival from
`createdAt`, on the server's clock (every response's `Date` header), and
`useOrders` re-stamps once a minute. With the ticking gone the `/orders`
ETag is back and fires: on the copy, 23 of a tablet's 24 polls came back
304 — 300 KB → 0 bytes each. Honest limit unchanged: the query still runs;
only the bytes are saved.

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

**Status:** DONE (9 Sep). 72 -> 0, and the pricing layout bug with it --
it was structural: an inline-flex label with an inline-block button after
it and nothing between them when pricing was off.

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

**Status:** DONE (9 Sep). Every group below converted; see finding 15 for
what the audit turned up on the way.

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

## 15. A class can contain `cq-` and still be nothing

**Status:** DONE (9 Sep) — but the lesson outlives the fix.

Validating every design-system utility in the source against the **built
stylesheet** found seven that Tailwind never emitted. Earlier conversion
passes had done substring replacement:

| Written | Meant | What rendered |
| --- | --- | --- |
| `bg-cq-alert-wash0` | `bg-red-500` | a solid button with no background |
| `bg-cq-ready-wash0` | `bg-green-500` | same |
| `bg-cq-warn-wash0` | `bg-yellow-500` | same |
| `bg-cq-milk-cq-md` / `-l` / `-md` | `bg-cq-milk` | 17 inputs, no background |
| `shadow-cq-card-lg` / `-xl` | a shadow | cards with none |

Every one **scored as converted**, because the scorer counts any class
containing `cq-`. The same blind spot as finding 11, one level down.

**The check that finds them** (worth re-running after any bulk edit):
extract every `*-cq-*` class from the source, and assert each appears as a
selector in `build/static/css/*.css`. Watch for false positives from
variants — `hover:bg-cq-tan` is emitted as `.hover\:bg-cq-tan:hover`.

**Related trap, same session:** a regex adding a class to every checkbox
matched the first `>` in the tag, which inside `onChange={(e) => ...}` is
the arrow — 31 broken arrow functions across 11 files. `build.sh` refused
to copy, so nothing reached the server. Two rules came out of it: never
append to a JSX tag by regex, only rewrite an existing `className="..."`;
and when the change is "one property on every instance of a control",
write one CSS rule instead of touching 35 tags.

---

## 16. The manager tools behind the barista PIN duplicated the runner

**Status:** DONE (10 Sep), two left deliberately.

The lock sheet said it itself: *"Manager tools on this tablet — moving to
the runner app; here until then."* The runner exists. Five of the seven had
a runner home already (Orders · All, Menu · Inventory, Schedule, Stations,
People), so a barista's tablet carried a second copy of each, each on its
own styling. Removed from the sheet. **Queue rules** and **Balance** stay
because nothing in the runner does what they do — and both were rewritten
into plain English (they read like a different product: "Execute All
Transfers", "Workload Variance", a `_assign_station` code mention on a
barista screen, and a summary row that could say "Well balanced" under two
stations marked overloaded).

**Left for the cleanup pass:** the render branches for the five removed
tabs are still in `BaristaInterface.js` (`activeTab === 'inventory'` etc.)
and nothing can set them any more. Delete in a commit of their own, per
the guide's rule about not refactoring and converting together.

---

## 17. The production database volume: what is actually in the 196 MB

**Status:** open — a monitoring gap, and one 17 MB row.

Railway reports the Postgres volume at 196 MB of 500 MB. Measured on the live
DB (read-only, 11 Sep): the database itself is **50 MB**; WAL is 64 MB (4
segments, `max_wal_size` 1 GB — Postgres recycles these, they do not grow
unbounded); the rest is Postgres' own overhead. Orders are ~1.2 KB each:
970 of them are 1.2 MB. At that rate 500 MB of orders is ~300,000 orders.

**37 of the 50 MB is one table — `settings` — and 17 MB of that is one row:
`display_bg_video`**, the display board's background video stored base64 in
the settings KV. Every save of a branding blob rewrites the whole value
(`_kv_put`), leaving dead TOAST rows (1,892 waiting for VACUUM). This is the
only thing in the schema that can move the number quickly.

**Fixed looks like:**
- a `Database` row in System · Health beside the memory row: size, WAL,
  % of volume, from `pg_database_size` + `pg_ls_waldir` — WARN at 60 %,
  ALERT at 80 % — so this is a meter, not a surprise;
- the background video on the Railway volume (or a URL), not in a KV row;
- `VACUUM (FULL) settings` once, at a quiet moment, to reclaim the dead TOAST.

Backups are copy-on-write snapshots off the volume: they cannot fill it.

---

## 18. One startup rollback after migration 22 ran on production

**Status:** open, low. The guard did its job; the cause is worth a look.

The deploy that applied migration 22 logged once:
`Startup left the database connection IDLE IN TRANSACTION (status=2). Some
init path read without committing. Rolling back`. The next deploy (20, 21)
did not. `apply_pending_migrations` commits after each migration, so the
open transaction is a read somewhere after it -- probably the runner's
final `_applied_versions` re-read or an init path that follows. Harmless
because app.py's startup guard rolls it back, but a guard that fires is a
bug being tolerated. Find the read, commit or rollback after it.

---

# Roadmap: after the cutover

Three things Steve asked for on 11 Sep, written up so they can be built one
at a time. Each says what already exists (with the file it lives in), what
the design is, the steps, what it costs, and what it needs from Steve. They
are ordered so the shared wiring is built once.

---

## 19. EventsAir: VIPs and speakers go where the organiser says

**Status:** BUILT 11 Sep — PR #622. Waiting on EA credentials in Railway and
a sync before it can recognise anyone on production. Two bugs fixed on the
way: the kiosk path never passed the VIP flag to _assign_station; the SMS
bot's allow-list dropped `vip` from the stored details.

**Why.** Speakers from overseas, sponsors' guests, a VIP category — the
organiser wants them through the coffee line faster, or sent to a specific
station (a sponsor's booth cart that only serves VIPs and has no queue).
Today the only way to be a VIP is to type the VIP code.

**What exists.**
- `services/eventsair/client.py` already pulls `registration { category }`
  for every attendee and computes `is_vip` from a configurable list
  (`vip_categories`). It has never run against a live event: EA credentials
  are not in Railway.
- `ea_attendees` (the mirror) stores name, mobile, email, coffee_pref and
  `custom_fields` — but **not** the category or the VIP flag.
- Every order path already carries a priority: `queue_priority` (1 = VIP)
  and the `vip` flag on the order, set today only by the VIP code
  (`consolidated_api_routes.py` ~749-830 for the API; the SMS bot's
  equivalent in `coffee_system.py`).
- Station routing lives in `coffee_system._assign_station` (~7345) and
  already honours per-station capabilities; there is no "this station is
  only for VIPs" rule.

**Design.**
1. **Store it.** Migration 23 adds `registration_category text` and
   `tags text[]` to `ea_attendees`; the sync writes both (EA exposes tags
   and custom fields alongside the category — the client reads `custom
   fields` already, tags need one more field in the GraphQL query).
2. **One rule, set by the organiser** — Runner › EventsAir › *VIP rule*:
   - *Who counts*: registration categories and/or tags (a list; case-
     insensitive; e.g. `Speaker`, `VIP`, `Sponsor guest`).
   - *What happens*: **jump the queue** (priority 1, the VIP pill), and/or
     **send to station N** (a station picker), and/or **only VIPs at
     station N** (a per-station flag in Stations; routing skips it for
     everyone else).
3. **Apply it at order time**, in one shared function, so every door
   behaves the same: when an order arrives with a phone number or an EA
   contact id (`ea_contact_id` at ~5567), look the attendee up in the
   mirror; if the category or a tag matches the rule, set priority and/or
   the target station before `_assign_station` runs. SMS, `/my`, the kiosk,
   the barista's walk-up and the badge scan (item 21) all pass through it.
4. **Show it.** The VIP pill already exists on the barista card; add "VIP
   (Speaker)" so staff can see *why*. The report's channels block gains a
   VIP count.

**Steps.** migration 23 → sync writes category/tags → `vip_rule` setting +
the Runner screen → the shared apply-at-order function → per-station
"VIP only" flag → tests (a mirror row with category Speaker: SMS order gets
priority 1; kiosk order with `?cid=` for that row lands at the chosen
station; a non-VIP never routes to a VIP-only station).

**Cost.** ~2 days. **Needs from Steve:** EA client id / secret / event id in
Railway (this also unblocks the survey ordering channel built in July), and
the category or tag names EA actually uses for the people who should count.

---

## 20. Badge scan: the phone reads the name off the EA badge

**Status:** BUILT 11 Sep — PR #623, live. Inert until attendee lookup is on.
Still needed: Steve scans a real badge and reports what the QR holds. One
thing the security headers had to give: Permissions-Policy camera=(self).

**Why.** Typing a name on a phone is the slowest step and the most
mis-spelled. The badge is already round their neck with a QR on it.

**What exists.** The kiosk and `/my` already accept `?cid=<EA contact id>`
(`KioskOrder.js` ~293 `eaIdentity`): the server resolves it to a first name
from the mirror — **the phone number never leaves the server** — and the
name and phone steps are skipped. The EA app links this way today. A badge
scan is just another way to obtain the same id.

**Design.**
1. On the *who's it for?* step, a **Scan your badge** button (only shown
   when the event has an EA sync and the device has a camera).
2. Camera in the browser: `getUserMedia` (needs HTTPS — cupq.app has it;
   the first tap asks permission). Android Chrome decodes QR natively
   (`BarcodeDetector`); iPhone Safari does not, so ship `jsQR` (~10 kB) as
   the fallback. No app to install.
3. Decode → extract the contact id → the existing `?cid=` path: name
   filled, phone step skipped, and item 19's rule applied. An unknown or
   unreadable badge falls back to typing, with one line saying so.
4. A **kiosk** variant later: the same button on the counter tablet, using
   its front camera — one scan and the walk-up has a name.

**The unknown that decides the effort.** What EA prints in the badge QR is
set in EA's badge designer — the contact id, a URL carrying it, or an
arbitrary string. **Steve scans a badge with his phone camera and reports
what it shows.** Contact id or URL → straightforward. Arbitrary string → the
sync must also mirror that string so it can be matched.

**Cost.** 1–2 days once the QR content is known. Build after 19 so a
scanned speaker lands in the VIP lane by itself.

---

## 21. Square: pay on your phone, or at the counter, without holding the coffee

**Status:** levels 1 and 2 BUILT 11 Sep — PR #624, live and inert (pricing
off, Square unconfigured). Level 3's Terminal call is written, no hardware.
To switch on: a Square developer app -> SQUARE_APPLICATION_ID / SECRET /
WEBHOOK_SIGNATURE_KEY in Railway, webhook URL from the Settings card into
Square's dashboard, then the cart connects from Settings. Bug caught on the
copy: the barista list's id IS the order number; everything resolves by it.

**Why.** Most of Steve's events are free-to-delegate. Coffee-cart operators
who already run Square are asking for the ordering system, and the
question is how it talks to *their* Square. And the less handling of cash
and cards at the counter, the faster the counter.

**What exists.** Honour pricing is built: prices per drink and size, or a
flat fee, in Quick Setup › Pricing (`/api/pricing`, ~14281); every order
carries `price`, shown as a pill on the barista card (`orderMeta.priceOf`).
`orders.payment_status` (default `pending`) and `orders.payment_link` exist
and nothing writes them; a `payment_transactions` table exists unused. The
Stripe keys were removed in the cutover (never wired).

**Principle.** The operator chooses, in one setting (Quick Setup › Pricing):
- **Honour** (default, today's behaviour): the order goes through, pay
  whenever.
- **Pay to collect**: the order goes through and is made; the card shows
  UNPAID until paid; the barista's Ready text/beacon says "pay at the
  counter to collect".
- **Pay to order**: the order is not placed until the phone payment
  succeeds (only makes sense with level 2 switched on; the kiosk/walk-up
  path still allows counter payment).
Nothing in levels 1-3 ever *blocks the making* of a coffee unless the
operator chose Pay-to-order.

**Level 1 — mark it paid (a day, no Square).** A *Paid* action on the
barista card (behind "…"), a PAID / UNPAID pill in the price's place, an
unpaid count and list on the report, `payment_status` finally written. This
is what a cart with its own Square POS on a separate tablet needs and
nothing more.

**Level 2 — pay on the phone at the beacon (2–3 days).** The *operator's*
Square account, connected once with Square OAuth from Runner › Settings
(so each event links its own Square — never Steve's), plus a location
picker. When an order is placed, the server creates a Square **Payment
Link** (Checkout API; Square hosts the card page; we never see a card) and
stores it in `payment_link`. The beacon shows **Pay $4.50**; the ready text
carries the link (short, plain ASCII — texts cost by segment). Square's
`payment.completed` webhook (signature-verified, fail-closed like the
Twilio one) sets `payment_status = paid` and the pill turns green on the
card within the second over the socket. AU online rate is about 2.2%.

**Level 3 — the counter's own reader (2 days + hardware).** A Square
Terminal paired to the event. The barista's *Paid* tap (level 1) becomes
*Charge* when a Terminal is paired: Terminal Checkout API pushes the amount
with the order number as the reference; the customer taps; the same webhook
marks it paid. In-person rate about 1.6%. If the Terminal is offline the
tap falls back to level 1's manual *Paid*.

**Order of work.** 1 → 2 → 3. Level 1 first because every later level needs
the pill, the report and the status write, and it is useful on its own.
Levels 2 and 3 share the webhook and the Square connection.

**Needs from Steve.** A Square developer account (free) to register the
app for OAuth; a test cart operator willing to connect their Square in
sandbox first; the wording for the three pricing modes as a customer reads
them.

---

## Still on Steve

Not findings — decisions and config that only he can make.

| | |
| --- | --- |
| `beans_grams_per_shot` on production | DONE 11 Sep — migration 22 set it to 11 and fixed the medium rows |
| Postgres password | appeared in logs during the outage; not in the repo |
| TSP143IV SK polling time | 30 s from the factory — the whole reason labels were slow |
| `CLOUDPRNT_SHARED_SECRET` | `/cloudprnt` is open until it is set |
