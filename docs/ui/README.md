# What the screens look like now

Rebuilt from `scratchpad/capture/ui_sweep.js`. **Definition of done:**
`legacy: 0`, `selects: 0`, `inputs: 0` — *and somebody has looked at it.*

## The 30 runner destinations

All 30 clean as of 9 Sep 2026.

| Screen | legacy | cq | Shot |
| --- | ---: | ---: | --- |
| Quick Setup | 0 | 159 | ![](quickSetup.png) |
| Menu · Event Inventory | 0 | 117 | ![](menu-inventory.png) |
| Menu · Event Stock | 0 | 217 | ![](menu-stock.png) |
| Menu · Station Inventory | 0 | 45 | ![](menu-stationInventory.png) |
| Stations | 0 | 50 | ![](stations.png) |
| Branding · Logo & look | 0 | 140 | ![](branding-logo.png) |
| Branding · Sponsors | 0 | 285 | ![](branding-sponsors.png) |
| Branding · Labels | 0 | 169 | ![](branding-labels.png) |
| Branding · Milk colours | 0 | 105 | ![](branding-milk.png) |
| Schedule | 0 | 67 | ![](schedule.png) |
| People | 0 | 48 | ![](users-people.png) |
| People · Roles & access | 0 | 56 | ![](users-access.png) |
| Live · Readiness | 0 | 117 | ![](live-readiness.png) |
| Live · Board | 0 | 108 | ![](live-board.png) |
| Live · Metrics | 0 | 103 | ![](live-metrics.png) |
| Orders · All | 0 | 736 | ![](orders-all.png) |
| Orders · Groups | 0 | 62 | ![](orders-groups.png) |
| Messages · Tell everyone | 0 | 72 | ![](messages-notice.png) |
| Messages · Text blast | 0 | 105 | ![](messages-broadcast.png) |
| Messages · Test a text | 0 | 73 | ![](messages-test.png) |
| Messages · Blocked numbers | 0 | 43 | ![](messages-blocked.png) |
| Screens | 0 | 121 | ![](screens.png) |
| Printers | 0 | 108 | ![](printers.png) |
| Report | 0 | 194 | ![](report.png) |
| System · Health | 0 | 92 | ![](system-health.png) |
| System · Diagnostics | 0 | 138 | ![](system-diagnostics.png) |
| EventsAir | 0 | 81 | ![](eventsair.png) |
| Settings | 0 | 64 | ![](settings.png) |
| Emergency | 0 | 49 | ![](emergency.png) |
| Help | 0 | 44 | ![](help.png) |

## Beyond the 30

The sweep reads the live DOM, so it can only score what a nav click reaches.
These were converted in the same pass and are **not** in the table above —
see findings 14 and 15 in `FINDINGS_ROADMAP.md`.

**Dialogs** (all five were hand-rolled; there is a `Modal` primitive now):
Edit order, Move order, Message customer, Broadcast, Adjust wait time.

**Inside the barista interface:** the 86 board, Tools, Station printer panel,
Station capabilities editor, Station chooser, Queue intelligence, Station load
balancer, Station chat, Staff allocation, Multi-level inventory, Station
defaults, the in-progress order card, the rush mix strip, Ask-customer
controls, the customer questions list.

**Customer-facing:** the kiosk, the kiosk admin panel, How to order, the
mobile order page, My coffee, Cancel order, the barista Ask card, Sign, the
sponsor wall, the public display board.

**Sign-in and Unauthorized** — the first screen anyone sees. Sign-in scored
one grey class because its colours were inline hex in a `<style>` block.

**Deleted:** the old `OrganiserInterface` and its `Organiser` wrapper —
imported into App.js, never rendered, shipping in every download.
