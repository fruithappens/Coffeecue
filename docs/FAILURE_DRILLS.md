# Failure drills and the 1,000-phone load test

Roadmap X7-1 and X7-2. Run on **demo.cupq.app** (the test copy: texts
off, demo numbers only), never on cupq.app. Re-run them before a big
event, or after anything changes how the server handles requests.

## The load test (X7-1)

```bash
python testbench/loadtest/remote_siege.py --base https://demo.cupq.app \
    --public --delegates 1000 --seconds 180 --orders 150 --yes-this-is-production
```

`--public` orders the way a phone does and needs no staff login. Every
phone polls its order like the real page; afterwards every accepted order
is checked on its own tracking page. Clear the test orders with Demo Room >
Wipe.

### What it found (13-15 Oct 2026)

| Run | Phone wait (median) | Orders in 3 min | Errors | Orders lost |
|---|---|---|---|---|
| Before fixes | 6.5 s | 21 | 0.4% | 0 |
| After the pool fix (#686) | 1.6 s | 44 | 3.9% (clean "busy" refusals) | 0 |

About 1 s of every number is the network from the test Mac (VPN through
the US). Measure the real wait from a phone in Australia.

Fixed along the way:

1. **The connection pool's limit never held** (#686). Under eventlet,
   psycopg2's `SimpleConnectionPool` let 200 requests past a cap of 4, and
   a busy pool was treated as broken and rebuilt. Locally that hung the
   server outright, and Postgres refused all clients. This is the same
   pattern as the 8 Sep outage. Now the pool is locked, waits up to 10 s
   for a free connection, and never rebuilds just because it's busy.
2. **A venue's wifi was rate-limited as one person** (#687, held for
   Steve). Phones on the same wifi share one address, and the 5,000/hour
   cap cut off the whole room and the TV board after about a dozen
   phones.
3. **Every tracking phone checked twice** (#689). The question card ran
   its own copy of the page's poll. Phones now also pace by need: 8 s when
   being made or near the front, 20 s far back, 30 s hidden, and they stop
   once the order is collected.
4. **Three log lines per request** (#688). Railway started dropping log
   lines. Full phone numbers were in every `/api/ea/me` log line; they're
   now masked.

### The ceiling that's left

One web process on Railway costs about 2.5 ms of CPU for even the
cheapest request (about 3.5x a Mac), so it handles roughly 100-200 real
requests a second. Before #689, 1,000 phones sent 250 a second (two
checks every 8 s each). With it, they send an estimated 60-70 (one check,
mostly at 20 s because most phones are well back in the queue). That's
inside the ceiling, but it's an estimate: the load test still polls at a
flat 8 s. Past about 2,000 phones at once, the
next step is a second web process. That needs a Redis queue for the live
updates (the "WebSocket scaling" item).

## Failure drills (X7-2)

```bash
python testbench/loadtest/drill_restart.py --base https://demo.cupq.app \
    --service <service id> --label Postgres --environment <env id>
```

A 50-phone rush with orders coming in, the named service restarted 60 s
in, and one order's tracking page probed every second.

| Drill | Down for | Came back by itself | Orders lost | Customers saw |
|---|---|---|---|---|
| Database restart (15 Oct) | 2.3 s (Postgres log) | Yes | 0 of 44 | 1 order refused (could retry), 1.3% of checks failed |
| Web server restart (15 Oct) | ~1 s (1 probe got 502) | Yes | 0 of 43 | 1 order refused (could retry), 2.3% of checks failed |

Found along the way: on a brand-new copy the two SMS tables didn't exist
until the first text, so the minute-by-minute checks errored on demo
(#690, migration 28).

### Printer down (local copy, 15 Oct)

Run locally because demo's test printer needs a staff login. The alert
was shortened to 30 s (`PRINTER_ALERT_AFTER_S=30`; it's 180 s at an
event). A fake printer checked in, an order put the copy "in service",
then the printer went quiet.

| | Result |
|---|---|
| Admin alert | Sent once (stubbed text, testing mode). The repeat a minute later was held by the 15-minute cooldown. |
| cupq.app/status | Amber "0 of 1 printer online" about 90 s after the last check-in. Back to green within seconds of the printer returning. |
| Gap | No "printer is back" message, so the admin only knows it's fixed by looking. |

### Texts down

There's no real texting on demo, so this was read from the code and then
tested. **Hole found:** "texts are down" meant 2+ failures and 0
successes *since the server started*. An outage that starts after the
first good text of the day was never flagged: no barista banner, no
admin alert. Fixed in #691: also down after 3 failures in a row since
the last text that got out.

What the room does when texts are down (unchanged, and it's the right
fallback): the board and every phone's tracking page still show each
order's name and status, and the barista banner says to call names.

### Not drilled yet

- **Venue wifi down.** The tablets' offline queue and the phones'
  "reconnecting" state. Needs a real tablet; do it at the next setup
  day.
- **Twilio itself down for real.** Only a live copy with texts can show
  it. The test number budget is 10 texts.
