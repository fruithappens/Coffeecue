# Fleet plan: what a client copy costs

Roadmap C3-1. One question: if every client gets their own CupQ (its own
server, database and web address), what does each one cost, and when would
one shared system be cheaper?

## What one copy uses today (measured)

From `railway metrics --all --since 30d` on the live project (cupq.app),
12 Oct 2026. Averages over 30 days, which include the quiet weeks between
events:

| Service  | Memory | CPU            | Disk (volume) |
|----------|--------|----------------|---------------|
| web      | 307 MB | under 0.01 vCPU | 852 MB       |
| Postgres | 151 MB | under 0.01 vCPU | 183 MB       |

Traffic out (egress) is tiny: well under 1 GB a month.

## Railway's prices

From docs.railway.com/reference/pricing/plans, Oct 2026:

- Memory: **$10 per GB per month**
- CPU: **$20 per vCPU per month**
- Disk: **$0.15 per GB per month**
- Egress: $0.05 per GB
- Plans: Hobby $5/month including $5 of usage; Pro $20/month including
  $20 of usage.

## Cost per copy

| State | What runs | Per month | Per hour |
|-------|-----------|-----------|----------|
| **Live** (always on) | web + database | **about $5.00** | under 1 cent |
| **Parked** between events | database only, web stopped | **about $1.70** | |
| **Retired** | nothing (data exported, then deleted) | $0 | |

How the numbers add up:

- Live: memory 0.46 GB x $10 = $4.60; CPU ~0.01 vCPU x $20 = $0.20;
  disk 1.04 GB x $0.15 = $0.16. About **$4.95**.
- Parked: database memory 0.15 GB x $10 = $1.50; both volumes kept,
  $0.16. About **$1.70**.
- Event days barely move it. A busy day lifts CPU for a few hours. At
  $20 per vCPU-month, half a vCPU for 8 hours is about 11 cents. Memory
  rises a little and falls back.

So a 2-day event on its own copy, live for a week around it and parked for
the rest of the month, costs roughly **$2.50**. That's small next to the
price of any plan tier.

## Why "sleep" doesn't apply

Railway can put a quiet service to sleep, but only once it has sent
nothing out for 5 minutes. CupQ always has something running: the
EventsAir sync, the nightly backup, the printer checks and the live screen
connections. So it would never fall asleep. Railway also warns that the
first request to a sleeping service can fail with an error page, which
isn't acceptable at an event. **Parking** (stop the web service, keep the
database) is how a copy goes quiet between events, and the C3-8 retire
script will do it.

## How many before one shared system pays off

- 10 copies live all month: about $50. Mostly parked: about $20.
- 50 copies: about $250 live, about $90 mostly parked.
- 100 copies: about $500 live, about $170 mostly parked.

A shared system (every client in one database) might run for $20 to $40 a
month at that size. But CupQ is built for one event at a time: no table
has an event column, so sharing means changing all 35 tables and every
query that reads them. That's weeks of work, and a bug in it shows one
client another client's orders.

**Recommendation:** one copy per client, parked between events. Revisit
a shared system when more than about 50 copies are **live at the same
time**. Before that the saving is under $200 a month, and the risk and
effort aren't worth it.

## Plan to be on

- One copy (cupq.app today) fits inside **Hobby's** $5 included usage.
- From the second always-on copy, **Pro** ($20 including $20 of usage)
  covers about four live copies, or more if they're parked.

## What else is on the account

`railway list` (12 Oct 2026) shows two more projects, **calm-reflection**
and **giving-strength**. Each is just a stopped Postgres with 98 MB of
disk, about 1.5 cents a month. They look like leftovers from early
experiments. Delete them in the Railway dashboard if nothing needs them
(Steve's call: Claude doesn't delete projects).

## Check against the bill

These are estimates from measured averages and Railway's list prices.
Compare them with the latest invoice (Railway dashboard, then Usage).
If the bill is much higher, the likely cause is a memory spike during an
event, or a second environment (staging, the Next copy) that is also
running.
