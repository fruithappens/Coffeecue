# Rewriting the screens: a guide for whoever picks this up

You are converting CupQ's operator screens onto the design system. This
document exists so you can do it accurately without re-deriving what was
already worked out, and without breaking a live ordering business.

Read all of it before you touch a file. It is short.

---

## 1. What the job actually is

Steve, holding two screenshots side by side:

> "these 2 screenshots show a contrast of simple clean, branded UI vs
> cluttered complicated, non branded UI ... they often look similar to this
> needs a fair bit of thought and attention"

He was right, and the cause is smaller than it looks.

The screen that looked good — the Station Admin sheet — built its row pattern
**inline**, twenty good lines inside `AdminSheet.js` that nothing else could
reach. So every other settings screen went on building its own out of bare
`<select>` and `<input>`, each with a paragraph of grey helper text
underneath, and none of them look like the app.

**This is not a redesign.** The design already exists and works. The job is
applying it. If you find yourself inventing a new look, stop — you have
misread the task.

---

## 2. The vocabulary

Everything lives in `src/design/` and is exported from `src/design/index.js`.
Import from `'../../design'` (adjust depth), never from the individual files.

### Screens that are a list of SETTINGS — `design/Settings.js`

| Component | Use it for |
| --- | --- |
| `SettingGroup` | A card of rows. `title` is the small-caps label above it. |
| `SettingRow` | One setting: `Icon`, `label`, `hint`, one control as children. |
| `Toggle` | On / off. Reads as a word, not a switch to interpret. |
| `Segmented` | **Five options or fewer.** A dropdown hides its own contents; on a bench that costs a tap and a squint. |
| `SelectRow` | Six or more options, where `Segmented` would wrap. |
| `TextField` | Free text or a number. |
| `SettingNote` | The one place a longer explanation belongs — under the group, once. |

**The shape of a row is the whole idea**: an icon, a name, ONE line of hint,
and exactly one control on the right. If a setting needs a paragraph to
explain it, the setting is wrong or the paragraph belongs in Help.

### Screens that are a list of THINGS — `design/Panel.js`

| Component | Use it for |
| --- | --- |
| `Panel` | A titled card. The container for anything that is not a settings list. |
| `DataTable` | A table that scrolls sideways **inside its own box** rather than pushing the page wide. Every old screen got this wrong on a laptop. |
| `TableRow`, `Cell` | Rows and cells. `Cell` takes `strong`, `right`, `dim`. |
| `Status` | Three-state dot + label: `state="ok" \| "warn" \| "bad"`. |
| `Empty` | "Nothing here yet", said once in the right voice. |

### Colour

Use tokens, never raw Tailwind palette colours.

- Brand / accent: `cq-caramel`, `cq-caramel-deep`, `cq-caramel-wash`
- Ink: `cq-roast` (headings), `cq-ink-2` (body), `cq-ink-3` (hints)
- Surfaces: `cq-milk` (cards), `cq-cream` (page), `cq-wash`, `cq-line`
- **Semantic, and separate from the accent**: `cq-ready` (good),
  `cq-warn` (watch this), `cq-alert` (needs a person now)

`cq-warn` was added *because* of this work: the system had green and red but
nothing for the middle state, so every three-state screen had invented its own
yellow. If you find another gap like that, add a token — do not improvise a
colour in one file.

---

## 3. Rules

1. **Behaviour does not change.** Same settings, same handlers, same API
   calls. You are changing how it looks, not what it does. If a conversion
   tempts you into a behaviour change, do it as a separate commit and say so.
2. **Semantic colour survives.** Green/amber/red that means *state* maps to
   `cq-ready` / `cq-warn` / `cq-alert`. Do not convert a status colour to
   caramel — you would be deleting information.
3. **Kill the paragraph.** The single biggest visual improvement is removing
   the grey `text-xs` explanation under every field. Most of them say what the
   control already says. Keep the one or two that carry real information and
   move them to a `SettingNote` under the group.
4. **A disabled control reads as broken.** If an option only applies in some
   mode, hide the row rather than disabling it. (Example: "Seconds per page"
   now appears only when page-flip is chosen.)
5. **Do not touch `static/`.** Railway builds the frontend itself in the
   Dockerfile. The committed `static/` is vestigial and already several builds
   behind production. Source only.
6. **Work on the copy.** This is `~/cupq-next`, branch `next`, which never
   deploys. Production is a live coffee business.

---

## 4. The loop

```bash
cd ~/cupq-next
./build.sh                  # refuses to copy a failed compile
./stop.sh && ./next.sh      # restart on http://localhost:5001
```

Then, from `scratchpad/capture/` (first time in a fresh checkout: `npm install`
there — it needs `playwright-core`, and it drives the Chrome already on the
Mac, so there is nothing to download):

```bash
node ui_sweep.js            # walks all 30 screens, shoots + scores each
python3 ui_doc.py           # rebuilds docs/ui/README.md from that sweep
```

`ui_sweep.js` scores **from the live DOM**, not from the source: how many
elements still carry old Tailwind colours (`legacy`), how many are on the
design system (`cq`), how many bare `select`/`input` remain. No judgement
calls.

**Definition of done for a screen: `legacy: 0` and `selects: 0`.**

Sign in is `coffeecue` / `adminpassword`. Screens are addressable as
`http://localhost:5001/run#<section>/<tab>`.

### Before you commit

Run the harnesses, **from `scratchpad/capture/`** — `require('playwright-core')`
resolves from the script's own directory, so running them from the repo root
fails with MODULE_NOT_FOUND:

```
smoke_phase4.js      18 checks — the barista queue
stuck_collected.js    3 checks — the Collected button
smoke_notice.js      12 checks — notices on every surface
smoke_runner.js       8 checks — all runner destinations render
smoke_report.js      11 checks — the event report
```

All must stay green. They are how you find out you broke something.

---

## 5. The screens

30 destinations. **3 done, 27 to go.** Ordered worst first by `legacy` — the
count of elements still carrying old Tailwind colours in the live DOM.

Current shots of every one are in `docs/ui/`.

### Done — use these as the reference

| Screen | File |
| --- | --- |
| Messages · Tell everyone | `components/runner/NoticeComposer.js` |
| Screens | `components/display/DisplaySelector.js` |
| Report | `components/runner/ReportTab.js` |

### To do

| # | Screen | legacy | File | Lines | Shape |
| --- | --- | ---: | --- | ---: | --- |
| 1 | Orders · All | 319 | `components/barista/AllOrdersTab.js` | 399 | table |
| 2 | Branding · Sponsors | 213 | `components/organiser/SponsorsPanel.js` | 419 | settings + list |
| 3 | Menu · Event Stock | 130 | `components/organiser/EventStockManagement.js` | 660 | table |
| 4 | Branding · Logo & look | 97 | `components/organiser/BrandingSettings.js` | 1057 | settings |
| 5 | Menu · Event Inventory | 78 | `components/organiser/InventoryManagement.js` | 815 | table |
| 6 | Quick Setup | 72 | `components/organiser/QuickSetup.js` | 2274 | wizard |
| 7 | System · Diagnostics | 63 | `components/support-tabs/DiagnosticsTab.js` | 430 | list |
| 8 | Live · Readiness | 55 | `components/organiser/ReadinessTab.js` | 467 | list + Status |
| 9 | Branding · Milk colours | 54 | `components/organiser/MilkColorSettings.js` | 397 | settings |
| 10 | System · Health | 52 | `components/support-tabs/SystemHealthTab.js` | 493 | list + Status |
| 11 | Messages · Text blast | 48 | `components/support/EnhancedCommunicationHub.js` | 748 | settings + list |
| 12 | Live · Metrics | 42 | `components/support-tabs/DashboardTab.js` | 723 | numbers |
| 13 | Live · Board | 41 | `components/support/EnhancedLiveOperationsDashboard.js` | 767 | numbers |
| 14 | EventsAir | 35 | `components/support-tabs/EventsAirTab.js` | 533 | settings |
| 15 | Schedule | 32 | `components/organiser/EnhancedScheduleManagement.js` | 1331 | table |
| 16 | Messages · Test a text | 28 | `components/support/SMSTestSimulator.js` | 870 | settings |
| 17 | Printers | 26 | `components/support-tabs/PrintersTab.js` | 485 | table |
| 18 | Branding · Labels | 23 | `components/organiser/LabelsTab.js` | 142 | settings |
| 19 | Stations | 18 | `components/organiser/StationSettings.js` | 520 | list |
| 20 | Orders · Groups | 15 | `components/barista/GroupOrdersTab.js` | 479 | table |
| 21 | Settings | 15 | `components/organiser/EventDataManagement.js` | 245 | settings |
| 22 | People · Roles & access | 14 | `components/support-tabs/UsersAccessTab.js` | 507 | table |
| 23 | Emergency | 12 | `components/support-tabs/EmergencyTab.js` | 450 | settings |
| 24 | Menu · Station Inventory | 9 | `components/organiser/StationInventoryConfig.js` | 829 | table |
| 25 | Help | 9 | `components/organiser/SmsFlowReference.js` | 149 | prose |
| 26 | People | 7 | `components/organiser/UserManagementTab.js` | 815 | table |
| 27 | Messages · Blocked numbers | 5 | `components/support-tabs/SmsBlocklistTab.js` | 157 | table |

Also converted, not in the runner sweep: the **barista Screens tab**, whose
Display Configuration card lives inside `components/barista/BaristaInterface.js`
(~line 3496). That file is **4,113 lines** — the reason that screen never got
the treatment. Convert in place; do not attempt to extract it.

---

## 6. Suggested order

Not strictly worst-first. Two considerations beat raw score:

**Start with #18, #21, #23, #27.** Small files, settings-shaped, quick wins
that build confidence in the vocabulary before you meet a 2,000-line wizard.

**Then #8 and #10** (Readiness, Health). Both are `Status` lists and will
prove the `cq-warn` token in anger.

**Then the tables** — #17, #20, #22, #27 — which prove `DataTable`.

**Leave #6 Quick Setup until last.** 2,274 lines, a multi-step wizard, and the
screen an operator uses when they are already stressed. It deserves a run of
its own.

**#1 Orders · All** has the worst score but is a data table with a filter bar;
it is more mechanical than it looks. Good second-day work.

---

## 7. Traps

- **Ids are strings.** `/api/orders` returns `id: '435'`. Comparing with
  `===` against a number is a silently dead control. This has caused two real
  production bugs already. Compare as strings.
- **Monster files.** Several screens live inside 800–2,300 line components.
  Convert in place with exact anchors. Do not refactor and convert in the same
  commit — if it breaks you will not know which half did it.
- **`legacy.css`.** `src/design/legacy.css` re-points old Tailwind colour
  classes at the palette inside `.cq-legacy`. It makes old screens *less* ugly;
  it does not make them converted. Do not count on it.
- **Inline hex hides from the sweep.** The score counts Tailwind colour
  classes in the DOM. A control built with `style={{ background: '#1f2937' }}`
  scores clean and still looks foreign — `AdminViewSwitcher` was exactly this.
  Grep for `#[0-9a-fA-F]{6}` in any file you touch and convert those too.
- **Test your assumption, not your code.** A change that looks right on the
  copy can do nothing in production. (An ETag on `/api/orders` was shipped and
  reverted the same night: `waitTime` ticks every minute, so the payload never
  matched. Two polls seconds apart passed; three polls a minute apart would
  have caught it.)

---

## 8. What "good" looks like

Open `docs/ui/screens.png`, `docs/ui/report.png` and
`docs/ui/messages-notice.png`. Those two screens are the
target. Every row the same height, every control in the same place, one line
of hint, tokens throughout, no grey paragraphs.

If your converted screen sits next to those and looks like it belongs, you are
finished. If it does not, the score will tell you why.
