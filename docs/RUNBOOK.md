# Event-Day Runbook

The page to have open at the cart. Written for whoever is on the floor,
not for a developer.

## Arrival smoke test (before doors, every event)

1. Text the event number: **Hi** → expect the welcome within seconds.
2. Place one order (your own phone) → it appears on the barista screen.
3. Start it → the label prints. Complete it → the ready-SMS arrives.
4. Glance at Support → SMS health says **OK** with a recent inbound.
5. Cancel the test order. Doors open.

If step 1 fails: check the split-network table below before touching
anything else.

## The split-network diagnosis table (B2)

Run the display iPad on the Nighthawk and one staff phone on venue
Wi-Fi. When something breaks, the pattern of what died tells you where
the fault is — read it off, don't reason it out under pressure:

| Symptom | Diagnosis |
|---|---|
| Both devices dead | Backend / Railway problem — check status page, re-push if a deploy hung |
| Only the Nighthawk device dead | Cellular / SIM / Nighthawk — power-cycle the router |
| Only the venue-Wi-Fi device dead | Venue Wi-Fi — move staff devices to the Nighthawk |

The printer stays hardwired to the Nighthawk regardless: printing is
the least recoverable function — no label means no order.

## Switches that matter on the day

- **Unlimited stock mode** (Quick Setup): ON = never refuse for stock
  (still counts everything). OFF + strict = refuse what can't be made,
  same message on every channel. Takes effect within ~10 seconds.
- **86 board** (barista Stock tab): one tap marks an item sold out on
  every channel instantly, whatever the ledger says. Tap again to
  bring it back. Works in either stock mode.
- **Device admin panel**: press-and-hold the TOP-LEFT corner of any
  display for 3 seconds → PIN (default 1234 — change it in Comms Hub →
  Event wording before the event). From there: convert the display to
  a barista terminal, change station, clear a confused device, test
  sound.

## Device failover (a barista terminal dies)

1. Walk to the nearest display screen.
2. Press-and-hold top-left corner, 3 seconds. Enter the PIN.
3. **Switch to Barista** → log in → pick the dead station.
4. Keep serving. Total cost: about twenty seconds.

## Cup counts (for the reconciliation report)

- Morning: count each station's cup stacks, enter under Organiser →
  Stations → Event Stock → **Cup reconciliation** (start column).
- Pack-down: count what's left, enter the end column.
- The variance against our order count appears immediately; ±5 is
  normal (staff coffees, remakes). The report shows it either way.

## When the system must NOT be touched

Never merge, deploy, or restart while baristas are serving. The restore
point (`stable-treenet-v1`) exists for catastrophe, not convenience —
rolling back mid-event loses nothing already ordered, but every device
needs a hard refresh afterwards.

## Paper fallback

If everything digital dies: pen, the paper pad, and cup numbers written
by hand. The SMS number keeps accepting orders into the queue for when
the screens come back — nothing is lost, only delayed.
