# Organiser + Support audit — every panel, every setting

A deep look at the two surfaces that have flown under the radar: the
Event Organiser sidebar and the Support Staff interface. For each
panel: what it claims to do, where its data actually comes from, and
whether it persists.

Legend:
- ✅ **Live** — wired to a real backend endpoint, returns/saves real data
- 🟡 **Partial** — some of the panel works, some is mock/cosmetic
- ❌ **Mock** — purely hardcoded UI; buttons may `console.log` but do nothing
- 🪦 **Stub** — explicitly labelled "coming soon" or rendered disabled

---

# Part 1 — Event Organiser sidebar (14 sections)

## ⚡ Quick Setup — ✅ Live
**`QuickSetup.js` + `/api/quick-setup`.** The setup wizard that builds the
event in one shot: name, stations, milks/drinks/teas, demo orders. Real
backend (`routes/consolidated_api_routes.py`), persists to Postgres,
wipes stale localStorage on commit. This one's solid.

## 🚀 Live Ops — 🟡 Partial
**`EnhancedLiveOperationsDashboard.js`** (749 lines). Pulls real orders +
stations via hooks. Broadcast button and individual SMS calls do hit
real endpoints (`/api/support/broadcast/customers`, `/api/sms/send`).
**But:** several "live metrics" tiles on top are computed from `orders`
in JS — accurate insofar as the orders list is fresh, but it's the same
data the Barista UI already shows. There's no separate ops-feed.

## ☕ Stations (6 sub-tabs)

| Sub-tab | Status | Notes |
|---|---|---|
| Station Settings | ✅ Live | Add/edit/delete persist via `/stations` PATCH/POST/DELETE. Recently fixed (commit 4f34d4e). |
| Event Inventory (`InventoryManagement`) | ✅ Live | Backed by `event_inventory` Postgres KV. |
| Event Stock (`EventStockManagement`) | ✅ Live | Persists per task #33. |
| Station Inventory (`StationInventoryConfig`) | ❌ **localStorage only** | Reads/writes `station_inventory_configs` + `station_inventory_quantities` in localStorage. **No API call**. Operator assigns oat to Station 2, closes browser, gone. See Tier 2 #8 of last audit. |
| Menu Items (`MenuManagement`) | needs verification | |
| Station Defaults (`StationDefaults`) | ❌ Mock | No API integration visible. |

## 🧠 Queue AI (`QueuePsychologyIntelligence`) — 🟡 Partial
522 lines. **Real:** the algorithms that find batch opportunities
(group by milk type, by coffee type, propose time saved) run on real
order data. **Mock:** the "alternative orders" suggestions ("Why not
try our quicker Americano?"), the gamified-vs-precise-vs-friendly
"communication mode" toggle, and the customer-psychology insights are
all UI-only — no setting persists, no message gets sent based on the
mode. 0 service calls, 0 save handlers.

## ⚡ Event Phases (`EventLifecycleManagement`) — ❌ Mock
621 lines, **zero** API calls and **zero** service calls. The "current
phase" (Morning Peak, Mid-day, etc.), the auto-transition toggle, the
phase config overrides — all useState only. Click "Transition to
Lunch Rush" and the UI updates but the backend has no idea. Nothing
about how the bot or barista UI behaves changes.

## 🕐 Orders (`AllOrdersTab`) — ✅ Live
Real orders, refreshes from useOrders hook.

## 👥 Group Orders (`GroupOrdersTab`) — ✅ Live
Real, calls OrderDataService.submitGroupOrder.

## 👤 Users (`UserManagementTab`) — ❌ **localStorage only**
The frontend reads/writes `coffee_system_users` localStorage. **But the
backend CRUD does exist** (`routes/support_api_routes.py:420-621`,
covering GET/POST/PUT/DELETE/toggle-status/reset-password). This is a
pure wiring gap — flip the component over to `/api/users` and it works.

## 📅 Schedule (`EnhancedScheduleManagement`) — ❌ **localStorage only**
Same story: many backend endpoints exist (full shift/break/rush-period
CRUD across `schedule_api_routes.py` + `consolidated_api_routes.py:4445-5094`)
but the frontend uses localStorage. Organiser builds a 3-day shift
plan, refreshes the page → gone.

## 📊 Analytics (`AnalyticsDashboard`) — 🟡 Partial
**Real data:**
- Orders/hour, avg wait time, completion rate (computed from real order timestamps)
- Popular items (counted from real order types)
- Peak times (real hourly distribution)
- Station performance (real per-station completion stats)

**Mock data:**
- "Customer satisfaction: 4.8/5" — hardcoded constant (`AnalyticsDashboard.js:136`)
- "Revenue" — uses a constant `avgOrderValue` × completed-count rather than real pricing
  (`AnalyticsDashboard.js:128-130`). With granular pricing now live, this could be
  rewired to real prices.

So the dashboard is more honest than it looks at first glance — the
graphs are real. The two summary tiles up top are the lies.

## 📡 Comms Hub (`EnhancedCommunicationHub`) — ✅ Live
651 lines, 6 service calls. Sends SMS via `MessageService.sendMessage`
(real backend). Templates and history are pulled from real services.

## 🛡 AI Predict (`PredictiveIntelligence`) — 🟡 Partial
609 lines. **Real:** the algorithms run on real order/station/stock
data — demand forecast, bottleneck detection, stock-depletion
prediction, staffing-needs prediction. **Mock:** the "resilience mode"
state, "automated protocols" list, "health score" — all useState,
nothing persisted and nothing acted on. The "auto-adjust" toggle does
nothing.

## 💬 Messages — 🪦 Stub
The component renders literal text "Message center functionality coming
soon." (`OrganiserInterface.js:558-560`). Not a feature.

## ⚙️ Settings (`EventSettings`) — 🟡 Partial
Three sub-tabs:

| Sub-tab | Status | Notes |
|---|---|---|
| Branding | ✅ Live | Saves event name, colour scheme, sponsor info to `branding_settings`. The live `event_name` property in `coffee_system.py` reads from here, so SMS flow respects it. |
| Coffee Type Colors | 🪦 Stub | Section rendered with `opacity-50`, no save path. |
| Advanced | 🪦 Stub | "Additional configuration options will be available here." |

---

# Part 2 — Support Interface (9 tabs)

## 📊 Dashboard (`DashboardTab`) — ✅ Live
Polls `/api/reports/today` every 30s. Real totals (orders today, by
status, avg wait, revenue if pricing is on, per-station breakdown,
top drinks). This is the **single best piece of real reporting** in
the system right now.

## ⚙️ Operations (`OperationsTab`) — ✅ Live (mostly)
10 endpoint calls — `/api/orders/pending`, `/api/stations/<id>/restart`,
`/api/stations/<id>/toggle`, `/api/stations/<id>/clear-queue`,
`/api/messages/announcement`, `/api/stations/clear-all-queues`. All real
endpoints. One caveat: the announcement endpoint hasn't been verified
to actually push to baristas; worth checking when you're back in here.

## ❤️ Health (`SystemHealthTab`) — ❌ **Entirely fake**
**This is the single biggest "looks real but isn't" panel.** The whole
component is hardcoded:

```js
const [components, setComponents] = useState([
  { id: 'api', status: 'healthy', metrics: {
    'Response Time': '45ms',
    'Error Rate': '0.01%',
    'Uptime': '72h 15m',
    'Requests/min': '342'
  }},
  { id: 'twilio', metrics: { 'Balance': '$123.45', ... } },
  ...
]);
```

The `checkSystemHealth()` function literally contains the comment "In
real implementation, this would call the API" and just `console.log`s.
The "Restart" button on each component also just `console.log`s. A
support person looking at this in production is reading fiction.

There ARE real diagnostic endpoints that *could* feed this:
`/api/diagnostics/database`, `/api/diagnostics/sms`,
`/api/diagnostics/performance` (which calls `psutil` for real CPU/mem
but mocks API/DB latency at lines 89-91 of support_api_routes.py).
**~2-3 hours** to wire these in.

## 📞 Comms (`CommunicationsTab`) — 🟡 Partial
Five sub-tabs:

| Sub-tab | Status | Notes |
|---|---|---|
| Overview | mostly mock | Recent SMS list hardcoded |
| Twilio Config | ❌ Mock | Balance, SIDs, monthly count all hardcoded constants. "Update" button is `console.log`. |
| Templates | ❌ Mock | Templates array is hardcoded in state; no save endpoint. |
| **Broadcast** | ✅ Live | Real `/support/broadcast/preview` and `/support/broadcast/customers`. The good part. |
| History | ❌ Mock | Recent SMS history is the same hardcoded array as Overview. |

## 📱 SMS Test (`SMSTestSimulator`) — should work
840 lines. Lets you simulate inbound SMS to the system without going
through Twilio. 1 API call (sends through the real flow). This is
genuinely useful for testing the bot during setup. Verify against the
recent SMS audit fixes — strength/decaf/EDIT all need to flow through
here too.

## 👥 Users (`UsersAccessTab`) — ✅ Live
Real CRUD against `/api/users` (the same backend the Organiser-side
UserManagementTab *should* be calling but isn't). Add, edit, delete,
toggle active, reset password — all wired.

## ⚙️ Config (`ConfigurationTab`) — ✅ Live
Uses `SettingsService.getSettings()` + `updateSettings()` against a real
backend. Configures branding, messages, system limits (auto-logout,
max orders per customer, order timeout), menu, SMS prefix, etc.
**Functional.** This is also where the audit doc's "support panel
mock metrics" concern landed before — verified those are limited to
the Health tab, not Config.

## 🩺 Diagnose (`DiagnosticsTab`) — ✅ Live
12 endpoint calls, all real. Database health, SMS gateway health,
performance metrics (CPU/mem real via psutil, API/DB latency are mock),
logs (`/api/diagnostics/logs` — backend returns mock log entries, see
note below), and a "run test" button against `/api/diagnostics/test`
which returns a fixed pass/fail script (all tests always "pass").

**Caveat:** the backend `/diagnostics/logs` endpoint at
`support_api_routes.py:112-122` has a comment "In production, this would
read from actual log files" and returns 10 fake log entries. Fix
scope ~30 min — read recent lines from a real log file or tail an
in-memory ring buffer.

## 🚨 Emergency (`EmergencyTab`) — 🟡 **Half the buttons 404**
13 endpoints called, **only 4 actually exist on the backend**:

| Button | Endpoint | Status |
|---|---|---|
| Emergency Stop | `/api/emergency/stop-all` | ✅ Live (writes `emergency_mode=true` to settings, pauses orders) |
| Resume Operations | `/api/emergency/resume` | ✅ Live |
| Clear All Queues | `/api/emergency/clear-queues` | ✅ Live |
| Backup Now | `/api/emergency/backup` | ✅ Live |
| Reset Stations | `/api/emergency/reset-stations` | ❌ **404** |
| Lock System | `/api/emergency/lock-system` | ❌ **404** |
| Unlock System | `/api/emergency/unlock-system` | ❌ **404** |
| Restore from Backup | `/api/emergency/restore` | ❌ **404** |
| Purge Old Data | `/api/emergency/purge-data` | ❌ **404** |
| Reset Database | `/api/emergency/reset-database` | ❌ **404** |

Worse: there's no error toast wired, so the support person clicking
"Lock System" gets nothing back and assumes it worked. In an actual
emergency this is the worst time to discover that.

---

# Where the real value lives (TL;DR)

If you're running a multi-day event and you want to know "what is
this system actually doing for me right now", here's the honest list:

**For organisers:**
- ⚡ Quick Setup — bulletproof setup wizard
- ☕ Stations Settings + Event Inventory + Event Stock — real persistence
- 🕐 Orders — real
- 📊 Analytics dashboard — real graphs (ignore the CSAT + Revenue tiles)
- 📡 Comms Hub — real SMS sending + templates
- ⚙️ Settings → Branding — real
- 🧠 Queue AI batch opportunities — real algorithm (suggestions to act on)

**For support:**
- 📊 Dashboard tab — live `/api/reports/today` (the single best report panel)
- ⚙️ Operations — real station controls
- 👥 Users — real CRUD
- ⚙️ Config — real settings persistence
- 🩺 Diagnose database/SMS/CPU/mem — real
- 🚨 Emergency: only Stop, Resume, Clear Queues, Backup — those 4 work

**For an event of 1000+ orders, the actually useful "stats back" answer is:**
`/api/reports/today` returns total orders, status breakdown, avg wait
time, revenue (if pricing on), per-station breakdown, top 5 drinks.
That's it. Everything else either runs in the browser on live data
(Analytics, AI Predict) or is decorative (Health, Lifecycle, Queue AI
psychology mode, customer satisfaction).

---

# Priority list for closing the gap

Ordered by impact for actually running a large event:

| # | Fix | Effort | Why |
|---|-----|--------|-----|
| 1 | Wire UserManagementTab + EnhancedScheduleManagement + StationInventoryConfig to their existing backends | ~6h | Organiser thinks they're set up, they aren't. Highest-confusion bug. |
| 2 | Replace EmergencyTab's 7 dead buttons (either implement the endpoints or hide the buttons) | 2h to hide / 4h to implement reset-stations + lock/unlock | In an actual emergency these need to do something. |
| 3 | Wire SystemHealthTab to real data via existing diagnostics endpoints | 2-3h | Stops support reading fiction during outages. |
| 4 | CommunicationsTab Twilio Config + Templates + History — either wire or hide | 2h to hide / 4h to wire | Support tab claims you can manage SMS templates but the UI is fake. |
| 5 | AnalyticsDashboard Revenue tile — use real prices (granular pricing is now live) | 1h | Easy win — pricing data is there. |
| 6 | AnalyticsDashboard CSAT tile — remove or implement a feedback flow (post-pickup SMS asking 1-5) | 30min to remove / day to implement properly | Currently lies in the dashboard. |
| 7 | EventLifecycleManagement + Queue AI psychology mode — wire to real behavior or label as preview | varies | These look like real features but are 100% UI. |
| 8 | `/api/diagnostics/logs` and `/api/diagnostics/test` — return real data | 1h each | Quick win for the Diagnose tab. |

Items 1-4 close the misleading-UI gaps that a real organiser/support
person would trip over within their first session. Items 5-8 polish.
