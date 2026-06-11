# Load testing

Find the wall before the wall finds you at an event.

## What this answers

- How many concurrent baristas can the current backend serve before p95
  latency climbs above 500ms?
- At what SMS-in rate does the NLP parser start backing up?
- Does the per-station inventory read scale? (It's the hottest read.)
- Are there error-floor leaks — endpoints that 500 at 1% under no load
  and 30% under any load?

Answers go in `OVERNIGHT_REPORT.md` / a deployment-sizing note before
you charge a client for a 500-person event you've never load-tested
against.

## Quickstart

```bash
# Make sure the backend is up
./dev.sh --backend-only

# In another terminal — 30-second smoke to confirm wiring
python tests/load/run_load_test.py --workers 5 --duration 30

# Real load — 20 concurrent baristas for 5 minutes, 30s ramp
python tests/load/run_load_test.py --workers 20 --duration 300 --ramp 30

# Hammer ONLY the walk-in path — worst-case write contention
python tests/load/run_load_test.py --workers 10 --only walkin

# Include inbound SMS — needs TESTING_MODE=true (no Twilio sig check)
python tests/load/run_load_test.py --workers 10 --include-sms

# Test against staging/Railway, not localhost
python tests/load/run_load_test.py \
  --base-url https://coffee-cue-staging.up.railway.app \
  --workers 20 --duration 300
```

## Reading the output

```
endpoint                                    n     p50     p95     p99     max   err
--------------------------------------------------------------------------------
GET /api/orders/pending                  6432    18.2    52.1    98.3   312.4     0
GET /api/orders/in-progress              6431    19.4    55.2   101.4   289.2     0
GET /api/inventory                       2104    24.7    78.1   144.5   401.1     0
POST /api/orders (walkin)                2103    42.1   142.3   289.4   712.5    12
GET /api/catalog                         1051    11.2    24.4    36.1    97.3     0
```

- **p95 column is the load-sizing one.** If POST /api/orders p95 is
  under 200ms, we're fine. Over 500ms, the walk-in dialog starts
  feeling laggy. Over 1000ms, baristas start tapping the button twice
  (and the VIP-tap-confirm we added stops the worst damage, but it's
  a bandage).
- **err column is the dealbreaker.** Anything above zero means the
  load itself is breaking the backend — investigate before going to
  production.
- **Status code distribution** at the bottom shows 200/201 vs 5xx.
  Lots of 0 status codes = connections refused = backend out of
  workers.

## Configuration

| flag | default | meaning |
|---|---|---|
| `--workers` | 10 | concurrent worker threads (≈ baristas) |
| `--duration` | 60 | how many seconds to run the burst |
| `--ramp` | 5 | ramp-up window; workers stagger their first hit across this |
| `--think-min` / `--think-max` | 150 / 600 ms | per-iteration sleep window |
| `--include-sms` | off | add `POST /api/sms` to the scenario mix |
| `--only walkin\|read\|inventory\|catalog\|sms` | — | hammer one path only |
| `--json PATH` | — | write a machine-readable summary alongside the console report |

## What it simulates

The default mix is weighted to look like a real event:

| scenario | weight | what the real operator does |
|---|---|---|
| `read` | 6 | barista UI polling pending + in-progress + stations every ~250ms |
| `inventory` | 2 | walk-in dialog opens → fetches station inventory |
| `walkin` | 2 | barista clicks "Add walk-in" and submits |
| `catalog` | 1 | useCatalog refreshes after inventory edit |
| `sms` (opt-in) | 2 | Twilio webhook hits `/api/sms` with a parseable order |

Each worker picks a scenario at random from the weighted mix, then
sleeps 150-600ms (mimics human pacing). 10 workers ≈ 10 baristas
running fully busy.

## Safety notes

- **No production guard.** The harness will happily hammer whatever
  `--base-url` you give it. Be deliberate.
- **Synthetic orders are marked.** Every walk-in body sets
  `notes: 'LOADTEST'` so cleanup is one query:
  ```sql
  DELETE FROM orders WHERE notes LIKE '%LOADTEST%';
  ```
- **Inbound SMS path needs TESTING_MODE.** Otherwise the Twilio
  signature check rejects every request (correctly — the harness can't
  sign as Twilio). For load-testing the NLP parser specifically, run
  the backend with `TESTING_MODE=true`.
- **One JWT shared across workers.** Real events have N independent
  baristas with N tokens. Sharing one is fine for load purposes (the
  server hashes the same token either way), but if you want to test
  the auth path itself, log in N times instead.

## Reasonable starting numbers

For a typical Steve event (3 stations, 1 barista each, ~300 orders
over 4 hours):

```bash
python tests/load/run_load_test.py --workers 6 --duration 240 --ramp 30
```

If p95 stays under 250ms and error rate is zero, the backend is sized.
If either misses, dig into which endpoint is the bottleneck before
pricing the next event.

For a large client (10 stations, ~2000 orders over 6 hours):

```bash
python tests/load/run_load_test.py --workers 25 --duration 600 --ramp 60
```

This is the "are we white-label-ready" smoke. Numbers here go in the
RAILWAY_DEPLOY_CHECKLIST.md.
