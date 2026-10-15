# CLAUDE.md

Guidance for Claude Code working in this repository. Rewritten 15 Oct 2026
to match the app as it is; older notes are in `_archive/`.

## What this is

**CupQ** (the code still says Expresso / Coffee Cue in places): coffee
ordering for events and conferences. Attendees order by text or on their
phone (cupq.app/my, also shown inside the EventsAir app as a static page),
or at a touch kiosk; baristas work a live queue; cups get printed labels;
a board and a pickup beacon show what's ready. Owner: Steve, non-coder.

**It is in production.** cupq.app serves real events. Fix, don't disable.
Never deploy during an event (the Event freeze check enforces this).

## Where it runs

| Copy | Address | Railway project | Region |
|---|---|---|---|
| Live | cupq.app | Coffee Cue | us-west2 |
| Demo / trial copy | demo.cupq.app | cupq-demo | Singapore |

- Both deploy from `main` on merge (Dockerfile; `python run_server.py`,
  eventlet, one process). Cloudflare in front.
- `main` is protected: Frontend build, Backend syntax, Python unit tests,
  Consistency checks, One handler per address, Event freeze must pass.
  No approvals needed. Branch each PR off `main`; never stack PRs.
- Railway API: `scripts/railway_api.py` (token in `~/.zshrc`, never print
  it). Rollback: `scripts/rollback.py` (`docs/ROLLBACK.md`). New client
  copy: `scripts/new_client.py <slug> [--apply]` (`docs/NEW_CLIENT_COPY.md`).
- Backups: `scripts/backup_prod.py` on Steve's Mac, nightly + hourly,
  with a check-in that texts if a day passes without one
  (`docs/RESTORE_DRILL.md`).

## Layout

- `app.py` (create_app, blueprint registration), `run_server.py`,
  `auth.py`, `config.py`, `security_middleware.py` (rate limits, CORS),
  `security_monitoring.py` (request logs), `ensure_admin_user.py`.
- `routes/`: one blueprint per area. `consolidated_api_routes.py` is the
  old giant (16,700 lines); new endpoints go in their own file.
- `services/`: `coffee_system.py` (the text bot and order logic, 11,600
  lines), `nlp.py`, `sms_wording.py` (editable bot replies), `sms/`
  providers, `service_watch.py` (minute-by-minute alerts),
  `admin_alerts.py`, `on_call.py`, `backup_watch.py`, `migrations.py`
  (numbered schema migrations; add the next number).
- `utils/`: `database.py` (pooled connections), `event_time.py` (the
  event's timezone; never group by the UTC date), `pricing.py`.
- `Barista Front End/` (note the space): React 18 + Tailwind. Runner
  (`/run`, organiser/admin), barista (`/barista`), display/kiosk/board
  (`/display...`), customer (`/my`), sign-up (`/start`), status (`/status`).
  Design system in `src/design/`; API client `src/services/ApiService.js`
  (errors carry the server's body on `error.details`).
- `docs/`: runbook, drills, release, fleet, legal drafts. `_archive/`:
  old scripts and reports, not used by anything.

## Running and testing locally

- Backend: `venv/bin/python run_server.py` (port 5001). For anything that
  could send texts, use the `backend-safe` preview config
  (TESTING_MODE=True, empty Twilio/alert settings); add it to
  `.claude/launch.json` temporarily and `git checkout .claude/launch.json`
  before committing.
- Frontend: `npm start` in `Barista Front End` (port 3000, proxies to 5001).
- Local logins: created on a laptop by `ensure_admin_user.py` and
  `create_test_users.py` / `prepare_test_environment.sh`. They exist only
  on local databases; a server's first admin gets a random password
  printed once in its deploy log. Never use local logins against cupq.app.
- Tests:
  - `venv/bin/python -m pytest tests/unit -q`
  - `cd "Barista Front End" && CI=true npm test -- --watchAll=false`
  - Text bot: `venv/bin/python tests/sms_scenarios/run_sms_scenarios.py --base-url http://127.0.0.1:5001`
    (16 scenarios; run one at a time) and `tests/sms_scenarios/golden_transcript.py`
    (record before, compare after, for any change to bot wording or flow).
  - `venv/bin/python scripts/check_route_shadowing.py`, `bash scripts/ci_consistency_checks.sh`
  - Frontend build as CI does it: `CI=false npm run build` (old lint warnings).
- Python: Black/isort style for new files; match the surrounding code.

## Rules that have bitten before

- One handler per method + path (route shadowing); CI checks it.
- A swallowed SQL error poisons the request's connection: roll back or
  use a SAVEPOINT (`services/nlp.py _optional_query`).
- No blocking calls on the eventlet hub; background loops use their own
  short connections.
- Flask-Limiter: the wrapper returned by `limit()` must replace the view.
- Plain ASCII in texts (an emoji or curly quote doubles the cost).
- Unspecified milk means full cream, shown in the recap; never other silent defaults.
- Real SMS tests: at most 10, only to Steve's phone, then ask.
- Secrets: never print tokens or passwords; paste via hidden-input Terminal.
  The repo is public: no client logos, no credentials in files.
- Railway deletions and billing changes are Steve's decision.

## Roadmap

The "Ready for 100 events" tracker (claude.ai artifact XWAXKHUH) holds
every task with its status; update it as PRs ship. The 15 Oct 2026 audit
(artifact 9Y8vZvxt) explains the current priorities.
