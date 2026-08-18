# Event-day protocol for Claude

You are being asked to fix a live coffee system while an event is running.
People are standing at a counter waiting. Read this before touching anything.

The single most important rule:

> **Deploying is the most dangerous thing you can do. Prefer any fix that
> does not require a deploy.**

This is not caution for its own sake. On 2026-08-18 a merge dropped a
customer's confirmed order mid-flight, and a *second* deploy that day —
a Railway healthcheck intended to make deploys safer — took production
down for ten minutes. Both were avoidable. Neither was a code bug.

---

## 0. Before you do anything

Ask the operator (Steve) these, and wait:

1. **Is the event running right now?** If yes, you are in FREEZE. See §1.
2. **What is the symptom a customer or barista actually sees?** Not the
   theory — the observation.
3. **When did it start, and what changed just before?**

Do not start editing files while you wait.

---

## 1. FREEZE rules (event running)

**Allowed without asking:**
- Reading anything: logs, database queries, API GETs, bench suites.
- Restarting the local print agent (`~/coffeecue-print-agent/`), which
  affects only printing on that machine.
- Telling the operator what to click.

**Requires an explicit "yes" from the operator, every time:**
- Any merge to `main` (this redeploys and restarts the app).
- Any write to the production database.
- Anything in the Emergency panel.
- Changing settings that affect ordering (menu, stations, SMS).

**Never during an event, regardless of who asks:**
- Deploy config changes (`railway.json` / `railway.toml`, Dockerfile,
  start command). These cannot be validated before they are live. This
  is what caused the ten-minute outage.
- Database migrations or schema changes.
- Anything labelled reset / purge / wipe.

If the operator says "just do whatever it takes", still say what you are
about to do and what it risks, in one sentence, before doing it.

---

## 2. Diagnose in this order

Work outside-in. Most "the app is broken" reports are not the app.

```
1. Is the site up?        curl -m 10 -o /dev/null -w '%{http_code}\n' \
                            https://web-production-4cc9c.up.railway.app/api/health
   000 = nothing serving   -> §3 outage
   200 = app is fine       -> keep going

2. What do the REAL logs say?   GET /api/diagnostics/logs?level=ERROR
   In-memory, WARNING and above, newest first, with tracebacks.
   RESETS ON REDEPLOY: empty means "nothing since the last deploy",
   NOT "nothing went wrong".

3. Did any customer message get dropped?   GET /api/sms/dropped
   Each row is a real person whose order never landed.

4. Reproduce it.   POST /api/sms/simulate {"from":"+61400009xxx","body":"..."}
   Same handler a real SMS uses, no Twilio, no cost. Use a +6140000
   bench number, NEVER a real customer's.

5. Only now read code.
```

**Correlate against deploys before blaming code:**
`gh pr view <N> --json mergedAt` — Adelaide is UTC+9:30. A failure within
~5 minutes of a merge is a deploy artefact until proven otherwise.

**A `processed=false` row with `response_sent=null` in `sms_messages`
means the request died mid-processing** — that is the fingerprint of a
restart, not a logic bug.

---

## 3. If production is down (HTTP 000)

Diagnose the layer before assuming it is the code:

```
dig +short web-production-4cc9c.up.railway.app     # DNS
nc -z -w 6 web-production-4cc9c.up.railway.app 443 # TCP
curl -m 10 -w 'connect=%{time_connect} tls=%{time_appconnect}\n' ...
```

DNS + TCP + TLS all fine but no HTTP = the container is not serving.

**Prove whether the app is at fault before changing anything:**

```bash
cd /tmp && rm -rf startcheck && mkdir startcheck
git archive origin/main | tar -x -C startcheck && cd startcheck
DATABASE_URL=postgresql://localhost/expresso TESTING_MODE=True \
  <repo>/venv/bin/python -c "from app import create_app; a,_=create_app(); \
  print(a.test_client().get('/api/health').status_code)"
```

200 means the deployed code is healthy and the problem is infrastructure
or deploy config — **revert the last infra change**, do not debug it live.

---

## 4. What the operational surfaces actually do

Audited 2026-08-18. Do not trust a control because it looks official.

| Surface | Real? | Notes |
|---|---|---|
| `GET /api/diagnostics/logs` | **Yes** (since #216) | Was fabricated data until today. Resets on redeploy. |
| `GET /api/sms/dropped` | **Yes** (#215) | Accepted-but-unprocessed inbound. |
| `POST /api/sms/simulate` | **Yes** | Real handler, no Twilio cost. The safest repro tool. |
| Emergency: Create Backup | **Yes** | Returns orders/settings/stations JSON. |
| Emergency: Stop All / Resume | **Yes, since #220** | Broken before (wrong column, HTTP 500, did nothing). Resume now restores each order's ORIGINAL status. |
| Emergency: Clear ALL Queues | **Yes, since #220** | Cancels `pending` only; leaves in-progress alone. |
| Emergency: Lock, Reset Stations, Purge, Reset DB, Restore | **No backend** | Correctly shown as "Deferred controls", not clickable. Do not promise them. |
| `GET /api/diagnostics/performance` | Unverified | Treat numbers as decorative until checked. |
| Test bench (`testbench/run_bench_auth.sh`) | **Yes** | Read-only by default. Safe during an event. |

**Stop All Operations freezes every pending and in-progress order to
status `paused`, which no barista screen renders — the orders vanish from
every display until Resume.** That is the intent, but say it out loud to
the operator before pressing it, and confirm Resume works first.

---

## 5. Things that will bite you

- **The print agent must be running** for USB printers or nothing prints
  and jobs queue silently. `~/coffeecue-print-agent/start-printing.command`.
  Not needed if the printer is on LAN via CloudPRNT.
- **The driver dropdown in Support → Printers does not change the
  connection**, it only labels it. The agent's `config.json` decides.
- **The bench cannot see restart, timing, hardware, real-Twilio or load
  failures.** A green bench is not proof the event will go well.
- **`orders` has `barista_notes`, not `notes`.** Writing `notes` throws
  and rolls the whole statement back. CI check 4 guards this.
- **Bench phone numbers start `+6140000`** and are blocked from real SMS
  by a hard guard. Never test with a real number.
- **Never `git commit` onto an already-merged branch**; branch from
  `origin/main` every time.

---

## 6. Making a change during an event

If a deploy is genuinely unavoidable and the operator has said yes:

1. Say what you are changing and what breaks if you are wrong.
2. Smallest possible diff. One thing.
3. Run `./scripts/ci_consistency_checks.sh` and the relevant bench suite
   locally first.
4. Merge, then **watch it land** — poll `/api/health` until 200 and
   confirm the specific fix works. Do not walk away.
5. If it is not healthy within ~4 minutes, **revert immediately** rather
   than debugging forward.

Keep a note of what you changed so it can be undone by someone who is not
you and does not have your context.

---

## 7. Reporting back

Tell the operator, briefly:
- what a customer would have seen,
- what was actually wrong,
- what you changed,
- what you verified, and how,
- what you did **not** fix.

No hedging, no false reassurance. If you are not sure it is fixed, say
that. "I think it's fine" during an event is worse than "I don't know
yet — here's how we'd tell."
