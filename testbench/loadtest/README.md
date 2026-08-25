# Load testing — can it take a 400-person event?

Three tools. Run them in this order; each one refuses to run against
anything it could damage.

## 1. Take a snapshot (and keep it)

```bash
python testbench/dbsnapshot.py save --label pre-event
python testbench/dbsnapshot.py list
```

Snapshots land in `testbench/snapshots/`. **They are git-ignored and must
stay that way** — they are dumps of the live system and carry real
customer names and mobile numbers, and this repository is public. To keep
one off the machine, copy it yourself:

```bash
cp testbench/snapshots/pre-event-*.sql.gz ~/Desktop/
```

Taking one before every event is worth the ten seconds: it is the
known-good point to come back to.

## 2. Restore it into a throwaway database

```bash
python testbench/dbsnapshot.py restore pre-event --into expresso_loadtest
```

`restore` **drops and recreates** the target, so it refuses to touch
`expresso`, `postgres` or `railway`, and refuses any database something
else is connected to.

The restored copy is faithful — which means it holds real phone numbers.
Everything below keeps the SMS path shut three separate ways: the server
runs with `TESTING_MODE=True` and `PICKUP_REMINDER_MINUTES=0`, and the
seeded delegates use the `+6140000` bench range the SMS layer blocks
outright. Three barriers, because one is how accidents happen.

## 3. Seed delegates and run the swarm

```bash
python testbench/loadtest/seed_delegates.py --db expresso_loadtest --count 400
python testbench/loadtest/my_swarm.py --db expresso_loadtest \
    --delegates 400 --seconds 60 --orders 40 --sms 15
```

### What it actually simulates

`/my` is not a page people open once. They order, then leave it open to
watch for "ready", and it polls every 8 seconds the whole time. So the
load is not 400 requests:

```
400 delegates / 8s  ≈  50 requests/second, sustained, all morning
```

That is a completely different shape from the order burst in
`testbench/load_test.py`. Orders are spiky and brief; this is flat and
endless, and it is the one that quietly exhausts a connection pool. Run
both.

Orders and SMS run **concurrently** with the poll storm, because the
question is not whether each survives alone.

### It checks survival, not just speed

A run that is fast and leaves the database wedged is a failure. After the
storm it asks:

- did every accepted order actually reach the database (an order the
  system said yes to and then lost is the worst outcome — the customer is
  waiting and no barista can see it)
- are there leaked transactions holding locks
- is anything stuck in a lock queue
- **can it still read `users`** — i.e. can anyone still log in

That last one matters more than it looks: `/api/health` answers without
touching `users`, so health can be green while the system is dead for
real people. See `testbench/check_boot_lock_convoy.py`.

## Comparing branches

```bash
python testbench/loadtest/my_swarm.py --db expresso_loadtest --repo /path/to/other/checkout
```

## Cleaning up

```bash
python testbench/loadtest/seed_delegates.py --db expresso_loadtest --clean
dropdb expresso_loadtest
```

## Reading the numbers honestly

These run on a laptop against a local Postgres. Railway is a smaller box
with real network latency, so treat local figures as a **ceiling**, not a
forecast. What transfers is the *shape*: whether latency stays flat as
delegates climb, whether errors appear, and whether the database is clean
afterwards. If p95 grows with delegate count locally, it will be worse in
production, and that is the signal worth acting on.
