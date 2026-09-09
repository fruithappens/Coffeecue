# The tidy-up: every screen, before and after

> Steve, holding two screenshots side by side: *"simple clean, branded UI vs
> cluttered complicated, non branded UI ... they often look similar to this."*

He was right, and the cause was small. The screen that looked good — the
Station Admin sheet — built its row pattern **inline**, twenty good lines that
nothing else could reach. Every other settings screen went on building its own
out of bare `<select>` and `<input>`, each with a paragraph of grey text
underneath.

`src/design/Settings.js` promotes that pattern so the rest can use it:
`SettingGroup`, `SettingRow`, `Toggle`, `Segmented`, `SelectRow`, `TextField`,
`SettingNote`. **The shape of a row is the whole idea**: an icon, a name, one
line of hint, and exactly one control. If a setting needs a paragraph, the
setting is wrong or the paragraph belongs in Help.

## How a screen is scored

`legacy` counts elements still carrying old Tailwind colours
(`bg-blue-500`, `text-gray-500` …). `cq` counts elements on the design system.
A converted screen reads **legacy 0**. Nothing here is a judgement call — the
numbers come from the live DOM, swept by `scratchpad/capture/ui_sweep.js`.

Last swept: 2026-09-09 · **27 of 30 done**

---

## Done (27)

### Menu · Event Stock

![Menu · Event Stock](menu-stock.png)

### Menu · Station Inventory

![Menu · Station Inventory](menu-stationInventory.png)

### Stations

![Stations](stations.png)

### Branding · Logo & look

![Branding · Logo & look](branding-logo.png)

### Branding · Sponsors

![Branding · Sponsors](branding-sponsors.png)

### Branding · Labels

![Branding · Labels](branding-labels.png)

### Branding · Milk colours

![Branding · Milk colours](branding-milk.png)

### Schedule

![Schedule](schedule.png)

### People

![People](users-people.png)

### People · Roles & access

![People · Roles & access](users-access.png)

### Live · Readiness

![Live · Readiness](live-readiness.png)

### Live · Board

![Live · Board](live-board.png)

### Live · Metrics

![Live · Metrics](live-metrics.png)

### Orders · All

![Orders · All](orders-all.png)

### Orders · Groups

![Orders · Groups](orders-groups.png)

### Messages · Tell everyone

![Messages · Tell everyone](messages-notice.png)

### Messages · Test a text

![Messages · Test a text](messages-test.png)

### Messages · Blocked numbers

![Messages · Blocked numbers](messages-blocked.png)

### Screens

![Screens](screens.png)

### Printers

![Printers](printers.png)

### Report

![Report](report.png)

### System · Health

![System · Health](system-health.png)

### System · Diagnostics

![System · Diagnostics](system-diagnostics.png)

### EventsAir

![EventsAir](eventsair.png)

### Settings

![Settings](settings.png)

### Emergency

![Emergency](emergency.png)

### Help

![Help](help.png)

---

## Still to do (3), worst first

| Screen | legacy | cq | selects | inputs |
| --- | ---: | ---: | ---: | ---: |
| [Quick Setup](quickSetup.png) | 72 | 31 | 4 | 43 |
| [Menu · Event Inventory](menu-inventory.png) | 6 | 108 | 0 | 0 |
| [Messages · Text blast](messages-broadcast.png) | 3 | 101 | 0 | 1 |

Shots of these are in this folder too — they are the *before*.
