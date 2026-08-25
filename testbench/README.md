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

## Letting the assistant self-run (credentials via .bench_env)

So a Claude session can run the FULL authenticated bench itself — without the
password ever appearing in a command or the transcript — put the credentials
in a **gitignored** file it reads but never prints:

1. Create a **dedicated** bench account in the app (Organiser → Users → Add
   User): username `benchbot`, role **Admin**, a password only you type.
2. `cp testbench/.bench_env.example testbench/.bench_env` and fill in the real
   password. `.bench_env` is gitignored — never commit it, never paste it.
3. The assistant then runs:
   ```bash
   bash testbench/run_bench_auth.sh --suites all         # everything
   bash testbench/run_bench_auth.sh --suites all --allow-lifecycle --allow-blocklist --allow-settings
   ```
   The password is read from `.bench_env` into the environment; `run_bench.py`
   picks it up (never logs it), and reports never contain it.

Revoke anytime by disabling `benchbot` in Organiser → Users. Deploys still
require your explicit approval — this only unblocks *testing*, not shipping.

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

## Standalone checks: the startup deadlock

Two checks for the 2026-08-24 startup deadlock — the one where a second server
against the same database hung and stayed hung. They are separate from the
suites above because they need their own database.

```bash
createdb expresso_locktest
pg_dump -d expresso --no-owner --no-privileges | psql -q -d expresso_locktest
python3 testbench/check_startup_transaction_leak.py   # ~2s, the cause
python3 testbench/check_boot_lock_convoy.py           # ~30s, the symptom
```

### `check_startup_transaction_leak.py` — the cause

Asks the connection directly, the instant `create_app()` returns, whether a
transaction is still open.

**Do not be tempted to rewrite this as "boot a server and grep
`pg_stat_activity`".** That was tried and it passed on known-broken code, for
two reasons worth remembering:

- **Too late.** Anything that waits for `/api/health` to answer has caused a
  request, and the `before_request` hook rolls the connection back at the start
  of every request. The leak is real at *boot* — exactly the window the startup
  DDL runs in — and gone by the time a health check succeeds. The evidence
  clears itself.
- **Too specific.** Grepping for one known query recognises one spelling of the
  bug and passes for every other one.

### `check_boot_lock_convoy.py` — the symptom

Reproduces the failure end to end.

It holds a read lock on `users`, boots a server alongside it, and then checks
that a **login** still answers. Health alone is not enough: `/api/health` never
touches `users`, so it returns 200 while the system is dead for real people.

`--repo <path>` boots a different checkout, so one copy can compare two
branches. Exit 0 = usable, 1 = convoy.

**Why both insist on a throwaway database:** on unfixed code they run schema
changes, and the convoy check deliberately wedges the `users` table. Pointed
at a database a live server is using, they would take that server down too. Both refuse databases named
`expresso`/`railway`/`postgres`, and refuse *any* database another connection
is already on. Both also disable the pickup-reminder loop: the throwaway copy
is a dump of live data, so its orders carry real phone numbers.

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
