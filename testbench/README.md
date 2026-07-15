# Coffee Cue Test Bench

A standalone tester for the Coffee Cue app. It exercises the whole live
surface — orders, SMS conversations, displays, stats, inventory consistency,
abuse protection — and writes **repair-ready feedback** for development.

## Quick start

```bash
./start_testbench.sh          # from the repo root
# then open http://localhost:5055
```

Enter the target URL (defaults to production), your admin login (used
in-memory for the run only, never stored), tick the suites, hit **Run**.
You get a colour-coded report page; every run also writes:

| File | Purpose |
|------|---------|
| `report.html` | Human dashboard (what you see in the browser) |
| `feedback.md` | Prioritised findings with evidence + likely source files — **hand this to a developer or a Claude Code session to fix the app** |
| `report.json` | Machine-readable results for tooling/CI |

Reports live in `testbench/reports/<timestamp>/` (git-ignored).

Headless (cron/CI):

```bash
BENCH_USER=... BENCH_PASS=... python3 testbench/run_bench.py \
  --base-url https://web-production-4cc9c.up.railway.app --suites all
# exit code 1 = failures found
```

## The master plan: COVERAGE_MAP.md

[`COVERAGE_MAP.md`](COVERAGE_MAP.md) is the living inventory of EVERY function
the app has (derived from the code: 321 API routes, 32 SMS keywords, all
screens and settings), each marked covered / partial / not-yet, with a phased
roadmap for closing the gaps. When you wonder "is X tested?" — look there.

## Suites

| Suite | Needs login | What it proves |
|-------|-------------|----------------|
| health | no | endpoints up, response times, **auth gate** (stations API must reject anonymous calls) |
| auth | yes | login token actually authorises API calls |
| stations | yes | statuses canonical, queue counts sane, wait estimates in 0–240 min (catches the bogus-4320-minute class) |
| display | no (+extra with login) | display config + kiosk menu populated; **every menu milk has a capable active station** (the oat/#165 silent-strand class) |
| orders | yes | kiosk order (phoneless) → appears in pending queue → cancelled. Opt-in: full start→complete lifecycle |
| sms | yes | full conversations via `/api/sms/simulate` (**zero real SMS**): one-shot order confirm + CANCEL, "Last latte" name bug, MENU, unavailable-milk refusal, STATUS |
| stats | yes | today-report shape (orders/sms/issues/per_station), statistics endpoint |
| inventory | yes | the multi-store consistency class: every active station has an inventory config |
| blocklist | yes, opt-in | block → listed → unblock roundtrip with a fake number |

## Safety design

- **No real SMS, ever.** SMS flows use the simulate harness (Twilio is not in
  the loop) with fake `+6140000xxx` numbers; order lifecycle only uses
  **phoneless** orders so no ready-SMS can fire.
- **Self-cleaning.** Bench orders are named `ZZBench …` and cancelled at the
  end of the run (the SMS order is cancelled by texting CANCEL in-conversation).
- **Mutations are opt-in.** start→complete lifecycle and block/unblock only run
  if you tick them. Everything else is read-only or create+cancel.
- The UI binds to `127.0.0.1` only.

## Feeding results back into development

`feedback.md` is written for exactly that: each failure includes what was
observed, the raw evidence, a suggested next step, and the likely source
files. Paste it (or the whole file) into a Claude Code session on this repo
and ask it to investigate/fix the failures.

## Ideas for later

- UI-level runs (drive the barista/organiser screens via Cypress — specs
  already exist under `Barista Front End/cypress`).
- Scheduled nightly run + email of `feedback.md`.
- A "pre-event readiness" preset (health + stations + display + one SMS
  order) to run the morning of an event.
