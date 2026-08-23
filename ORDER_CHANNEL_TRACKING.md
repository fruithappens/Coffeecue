# Knowing where your orders come from

**Set this up before the event, not after.** Provenance is stamped at the
moment an order is created; it cannot be reconstructed later. CTN26 is the
worked example — 74% of that event reads as "self-service" and there is no
way to ever find out how much of it was the cart's iPad versus a QR scan,
because both wrote identical rows.

---

## The two things recorded

| field | the question it answers | who sets it |
|---|---|---|
| `channel` | **How** did they order? | the code, automatically |
| `source_code` | **Which sign or iPad** did they use? | you, via `?src=` on the QR |

They are separate on purpose. Channel tells you whether SMS is still
earning its keep. Source tells you which poster is working. One field
could not answer both.

### The five channels

These are fixed. Nothing else can be stored, so a typo or a bad caller can
never quietly add a sixth and split your numbers in half.

| value | what it means | report label |
|---|---|---|
| `sms` | texted the event number | SMS |
| `kiosk` | tapped the touchscreen at the cart | On-site touchscreen |
| `web` | scanned a QR, ordered on their own phone | Own phone (QR) |
| `app` | came in from the events app | Event app |
| `barista` | a barista typed it in at the station | Entered by barista |

---

## Setting up before an event

### 1. Decide your placements

One code per **physical place a person can start an order**. Keep them
short, lowercase and obvious — they appear verbatim on the report:

```
cart-1-ipad        the touchscreen on cart 1
cart-2-ipad        the touchscreen on cart 2
foyer-poster       the A1 poster by the entrance
room-a-signage     the sign inside the main plenary room
table-tent         the little cards on the catering tables
lanyard            the card in everyone's badge holder
program            printed in the program
```

Anything you type is squashed to lowercase letters, numbers and hyphens and
capped at 32 characters. `Cart 1 iPad!!` becomes `cart-1-ipad`, so you get
the same answer whether or not you were careful.

### 2. Print one QR per placement

Open the poster page with the placement code on the end:

```
/how?station=1&src=foyer-poster
/how?station=2&src=room-a-signage
/how?src=lanyard
```

The QR on that page now carries the code. Every order started by scanning
it is tagged `foyer-poster` — no deploy, no config, no database change. A
new sign is a new URL.

Leave `station` off when the sign is not next to a particular cart; orders
will be balanced as usual.

### 3. Point the events app at `/my`

Orders arriving that way record themselves as `app` automatically, because
the app's link carries `?cid=`. Add `&src=` too if you want to tell an
in-app button apart from an emailed link.

---

## Reading the results

```
GET /api/reports/channels?start_date=2026-09-14&end_date=2026-09-14
```

Returns orders by channel, by source, and by station, plus the
self-service and SMS shares.

### The one number to check first

`estimated_pct`. It is the share of the report that was **inferred from
old markers rather than recorded**. Anything above zero means part of the
breakdown is a reconstruction.

- **0%** — every order stamped itself. The numbers are exact.
- **anything else** — those orders predate provenance, and any `kiosk` in
  them may in truth have been a QR scan.

**Do not retire a channel while this is high.** That is the whole reason
the field exists: turning SMS off is a one-way decision, and it should
rest on measurement, not on a reconstruction that happens to look
confident.

For reference, CTN26 reads as 100% estimated — correctly, because all of
it predates this.

---

## Answering "can we turn SMS off?"

Wait for one full event with `estimated_pct` at 0, then look at the SMS
share. Two cautions before acting on it:

**SMS is the fallback, not just a channel.** It works with no WiFi, no
app, no camera and no battery-hungry browser. A 5% share may be 5% of
people who had no other way to order.

**Look at who used it.** SMS skews to people who could not or would not
scan. Removing it removes them, not their orders.

A safer sequence than switching it off: stop *advertising* it on signage
for one event, keep the number live, and see whether the share falls to
near zero on its own. If it does not, the people using it needed it.

---

## Adding a channel later

Add it to `CHANNELS` in `utils/order_provenance.py` and stamp it at the
point the order is created. Do not invent values at the call site — an
unknown channel is deliberately dropped rather than stored, so it would
vanish silently rather than appear as a new column.
