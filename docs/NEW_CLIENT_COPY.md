# A client's own copy of CupQ

How to give a client (say, a venue on an annual subscription) their own
CupQ, with its own server, database and web address. Written from building
the first one, **demo.cupq.app**, on 12 Oct 2026. About 30 minutes of
work the first time; aim for 15.

Why one copy per client: a client's attendees, menu and branding never
share a database with anyone else's. Cost is about $5 a month per copy
running, $1.70 parked (docs/FLEET_COST.md). CupQ has no "event" column in
its tables, so one shared system would mean rebuilding every table.

## What you need first (once)

| | Where | Status |
|---|---|---|
| Railway **workspace** token | railway.com/account/tokens, workspace "My Projects" | in `~/.zshrc` as `RAILWAY_API_TOKEN` |
| Cloudflare token | DNS Edit + Zone Read on **cupq.app only** | in `~/.zshrc` as `CLOUDFLARE_API_TOKEN` |
| Railway CLI login | `railway login` | done (used for the steps the token can't do) |
| Twilio sub-account per client | only for a client that texts | not set up yet (roadmap C3-5) |

Paste tokens into Terminal with the hidden-input command, never into chat:
```bash
read -s "T?Paste the token, then press Enter: " && echo "export RAILWAY_API_TOKEN='$T'" >> ~/.zshrc && unset T && chmod 600 ~/.zshrc
```

## Plan it (changes nothing)

```bash
python scripts/new_client.py <slug> --event-file ~/cupq-demo-events/<event>.cupq-event.json
```
Prints every step, every setting and anything still missing.

## Build it

Every call goes through `scripts/railway_api.py` (Railway's API, reading
the token from `~/.zshrc`). **The Railway CLI refuses workspace tokens**
("Unauthorized"), so it's the API for everything, except one CLI step
that uses your normal login (`env -u RAILWAY_API_TOKEN railway ...`).

1. **Project.** `projectCreate` with name `cupq-<slug>` and the workspace
   **ID** (look it up from an existing project: `project(id) { workspaceId }`).
   The workspace *name* doesn't work.
2. **Database.** In a scratch folder: `railway link --project <id>
   --environment production`, then `railway add --database postgres`
   (CLI login).
3. **Region, while it's empty.** `serviceInstanceUpdate(serviceId,
   environmentId, input: {multiRegionConfig: {"asia-southeast1-eqsg3a":
   {numReplicas: 1}}})`. The old `region` field returns true and does
   nothing. Read it back from `latestDeployment.meta.serviceManifest.deploy`.
   **Then redeploy Postgres** (`serviceInstanceDeployV2`) and check its
   **disk** moved too: `volumeInstances { region }` must say Singapore.
   Changing the region alone left the disk in us-west2, the database ran
   next to its disk, and every query crossed the Pacific: the demo menu
   took 15.7 s instead of 1.2 s. The redeploy migrates the disk (about
   90 s). After it, **restart the web service** (`deploymentRestart`),
   or it hangs on its old connections (502/524).
4. **Web service.** `serviceCreate` with source repo
   `fruithappens/Coffeecue`, branch `main`, and its settings in the same
   call (below), so the first deploy already has them.
5. **Web region** (same mutation as step 3) and a **volume** at `/data`
   (`volumeCreate`, same region).
6. **Deploy.** `serviceInstanceDeployV2`, then poll
   `serviceInstance.latestDeployment.status` until SUCCESS (about 3-6
   minutes for the Docker build).
7. **Test address.** `serviceDomainCreate` (targetPort 8080) gives
   `web-production-xxxxx.up.railway.app`; check `/api/health` is 200.
8. **Its own address.** `customDomainCreate` for `<slug>.cupq.app`
   returns two records. Add them on Cloudflare (cupq.app zone), **proxied
   like the main cupq.app record**:
   - CNAME `<slug>` -> the `requiredValue` (`xxxx.up.railway.app`)
   - TXT `_railway-verify.<slug>` -> the verification token

   It answered on https within about a minute.
9. **First admin.** On first boot the server makes
   `DEFAULT_ADMIN_USERNAME` with a random password and prints
   `FIRST ADMIN LOGIN ...` once in the deploy log. Copy that line from
   `deploymentLogs` straight into `~/cupq-demo-events/<slug>-admin.txt`
   (chmod 600), never into chat.
10. **Saved event.** Log in, Runner > Quick Setup > saved events >
    Import file, then Load. Or Demo Room > Load demo.
11. **Checklist.** Runner > Live > Readiness until green.
12. **Fleet board.** On cupq.app: System > Fleet > Edit copies > add it.

## Its settings

| Setting | Value |
|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (Railway reference) |
| `JWT_SECRET_KEY`, `SECRET_KEY`, `PIN_PEPPER`, `CLOUDPRNT_SHARED_SECRET` | fresh random per copy, never shared |
| `DEBUG` / `LOG_LEVEL` / `JWT_COOKIE_SECURE` | `False` / `INFO` / `True` (same as cupq.app) |
| `TESTING_MODE` | `False` for a client that texts; `True` for a demo copy |
| `EVENT_NAME` | the client's event |
| `DEFAULT_ADMIN_USERNAME` / `_EMAIL` | `<slug>admin` / `<slug>admin@cupq.app`; **leave `DEFAULT_ADMIN_PASSWORD` unset** |
| `PYTHONUNBUFFERED` | `1` |
| Twilio (`TWILIO_ACCOUNT_SID`, `_AUTH_TOKEN`, `_PHONE_NUMBER`) | the client's own sub-account; none for a demo |
| Never copy | anything from cupq.app's EventsAir, Twilio or Square settings |

## Gotchas found on the first build

- **The CLI refuses workspace tokens.** Use the API (or your CLI login
  for `link`/`add`).
- **Region needs `multiRegionConfig`**, not `region`.
- **The first-admin line didn't reach the log.** Python buffers printing
  when it isn't writing to a terminal, so the line sat in memory. Fixed:
  `flush=True` in ensure_admin_user.py, plus `PYTHONUNBUFFERED=1`. On
  demo.cupq.app the first admin (`demoadmin`) was created before the fix
  and its password was never seen, so a second admin, `demoowner`, was
  made. `demoadmin` can be deleted in People.
- **A region change doesn't move the database's disk** until Postgres
  is redeployed (step 3). Check `volumeInstances { region }` for every
  volume before calling the copy done. Then restart web.
- **Railway SSH needs an SSH key** registered with Railway. We didn't
  make one; the first-admin line is the way in.
- **Timing from a Mac on a VPN is meaningless.** Both copies measured
  the same because the traffic left through the US. Measure a new region
  from a phone on an Australian network.

## The copies today

| Copy | Railway project | Region | Address |
|---|---|---|---|
| Live events | Coffee Cue | US West (us-west2) | cupq.app |
| Demo | cupq-demo | Singapore (asia-southeast1-eqsg3a) | demo.cupq.app |

## Retire a copy

Runner > Settings > Retire this event (erase attendee details, keep the
numbers), download the report, then stop the web service (parked, about
$1.70 a month) or delete the project in the Railway dashboard (Steve
deletes, there's no undo). Remove its two Cloudflare records.
