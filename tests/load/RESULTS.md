# Load test results

First real run: 2026-06-12, local backend (`run_server.py`, eventlet,
single instance) against local Postgres 14. TESTING_MODE=True.

**Caveat — these are localhost numbers.** No network RTT to Railway, no
container CPU limits, local Postgres. Real cloud latency will be higher
(add network round-trip per request); the *relative* headroom and the
zero-error behaviour are the signal, not the absolute milliseconds.

## Headline

| Scenario | Workers | Requests | Throughput | Error rate | p99 (worst endpoint) |
|---|---|---|---|---|---|
| Typical event | 6 | 1,322 / 45s | 29 req/s | 0% | 22ms |
| Stress | 25 | 6,794 / 60s | 112 req/s | 0% | 47ms |

A single instance handled 25 concurrent flat-out baristas at 112 req/s
with **zero errors and sub-50ms p99**. Steve's events are 3–10 stations
with human-paced baristas — comfortably inside this envelope.

## Stress run detail (25 workers, 60s)

```
endpoint                       n      p50    p95    p99    max   err
GET /api/orders/pending      1772   11.4   33.2   47.3   67.0    0
GET /api/orders/in-progress  1772    3.7   20.1   31.3   52.4    0
GET /api/stations            1772    3.1   14.7   28.8   52.5    0
POST /api/orders (walkin)     626    6.4   20.1   30.7   42.3    0
GET /api/inventory            563    4.2   14.8   27.0   52.6    0
GET /api/catalog              289    4.1   16.6   28.5   32.9    0
6794 requests, 0 errors, 112 req/s
```

`/api/orders/pending` is the heaviest read (p99 47ms) — expected, it's
the busiest poll and returns the most rows. Still well under the 500ms
API target in CLAUDE.md.

## Two real bugs this exercise surfaced

1. **Load harness deadlock (fixed).** The harness shipped earlier but
   had never actually been *run*. First real run hung forever in the
   reporting phase. Stack dump showed a non-reentrant lock self-deadlock:
   `EndpointStats.summary()` held `self._lock` (a plain `threading.Lock`)
   and called `self.percentile()`, which re-acquired the same lock.
   Fixed: switched to `threading.RLock` + a `_percentile_locked` helper.
   Lesson: a test harness that's never run is not a test harness.

2. **Phantom 15% error rate (fixed, was a harness bug not a backend bug).**
   The first 6-worker run reported a 1.5% overall / ~17% walk-in error
   rate. All 25 errors were `400 "This station doesn't stock soy"`. The
   backend was *correct* — the default Quick Setup preset doesn't stock
   soy, and the capability check rejected it. The harness was randomly
   generating orders for milk the station doesn't carry. Fixed: the
   walk-in generator now only uses milks in the default preset
   (`full cream, skim, oat, almond, lactose free`). After the fix:
   0 errors. The capability-rejection path is genuinely solid under load.

## How to reproduce

```bash
./dev.sh --backend-only          # or: DATABASE_URL=... TESTING_MODE=True python run_server.py
python tests/load/run_load_test.py --workers 6  --duration 45 --ramp 8   # typical
python tests/load/run_load_test.py --workers 25 --duration 60 --ramp 15  # stress
# cleanup:
psql -d expresso -c "DELETE FROM orders WHERE order_details->>'notes' LIKE '%LOADTEST%';"
```

## Next time (cloud)

Run the same harness with `--base-url https://<railway-host>` from a
machine outside Railway to get real network-inclusive numbers. Expect
p50/p95 to rise by the RTT (~20–80ms depending on region); the error
rate and relative endpoint ranking should hold. If `pending` p99 climbs
past ~300ms under 25 workers on Railway, that's the signal to add the
`idx_orders_status` index and/or bump `DB_POOL_MAX_CONNECTIONS`.

---

## SMS-conversation load (2026-06-13) — Phase 5 of DEEP_TEST_PLAN

New scenario `conversation`: a full 7-turn SMS order per worker
(hi→name→drink→milk→size→sugar→yes), the realistic "N concurrent coffee
conversations". Needs `TESTING_MODE=true` (signature + outbound SMS stubbed).
Run: `python tests/load/run_load_test.py --only conversation --workers N`.

### Local baseline (single eventlet process, laptop Postgres)
| Concurrency | turns | p50 | p95 | p99 | turn errors |
|---|---|---|---|---|---|
| 20  | 1841 | 9.3ms  | 21.2ms  | 29.9ms  | 0 |
| 100 | 7833 | 186.7ms | 234.1ms | 273.2ms | 0 |

Knee is clearly visible between 20 and 100 concurrent on a single local
process — latency ~20×. This is the local app code's concurrency ceiling,
NOT Railway's (Railway = separate managed Postgres + its own CPU). The
Railway run (ramp 50→100→200→400) is the number that goes in the
deployment-sizing decision; it requires flipping the Railway service to
`TESTING_MODE=true` for the duration, then back.

Cleanup (safe — matches the LOADTEST name, never a phone prefix):
`DELETE FROM orders WHERE order_details::text LIKE '%LOADTEST%';`

### Full ramp — local single eventlet process (2026-06-13)
| Concurrency | turn p50 | turn p95 | turn p99 | turn errors | overall err | req/s |
|---|---|---|---|---|---|---|
| 50  | 21.7ms | 54.5ms | 69ms   | 0   | 0%    | 235 |
| 100 | 206ms  | 277ms  | 316ms  | 0   | 0.2%  | 262 |
| 200 | 282ms  | 479ms  | 6.1s   | 71  | 2.6%  | 328 |
| 400 | 298ms  | 6.1s   | 7.8s   | 467 | 10.1% | 370 |

**Read:** the knee is between 50 and 100 concurrent conversations — p50 jumps
10× (22ms → 206ms) as the single greenlet serialises CPU-bound NLP + synchronous
DB work. At 200 some turns queue past 6s; at 400 ~10% of turns time out. So on
the CURRENT single-process Dockerfile deploy:
- **≤ ~50 concurrent SMS conversations: comfortable** (sub-100ms, 0 errors)
- **~100: usable but latency-degraded** (200ms+ per turn)
- **200+: orders start timing out** — not safe for a large event

**Deployment-sizing implication:** a single Railway instance with one worker
handles a small/medium event well. For hundreds of simultaneous orders you need
to scale OUT — multiple gunicorn workers and/or Railway replicas, plus the Redis
SocketIO adapter (CLAUDE.md flags this) so WebSocket fan-out works across
instances. The app code is correct under load (0 turn-errors up to 100; failures
above are timeouts/saturation, not logic bugs — no 500s from the conversation
engine itself).

NOTE: these are LOCAL numbers (one process, laptop Postgres). The Railway run
(same harness, --base-url the live URL, TESTING_MODE=true) will shift the knee
per Railway's CPU + managed Postgres — that's the production-sizing number.
