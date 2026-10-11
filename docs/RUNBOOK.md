# Event-Day Runbook

The page to have open at the cart. Written for whoever is on the floor, not
for a developer: each problem has what you'll see, then what to do, in order.
Screens are named as they appear in the **Runner** (cupq.app/run).

## Before doors: the 6am check (15 minutes)

1. **Log in to the Runner** on the operator laptop or tablet.
2. **Live → Readiness**: everything should be green. Fix any red line first;
   each one says what's wrong.
3. **Printers**: each station's printer says *Online* (it has checked in
   within the last 15 seconds). Print one **Test label** per printer.
4. **Messages → Text meter**: the plan and cap look right for this event,
   and the meter isn't already near the cap.
5. **Text the event number** from your own phone: **Hi** → the welcome
   arrives within seconds.
6. **Place one order end to end** (your phone): it appears on the barista
   screen → Start → the label prints → Ready → the ready text arrives and
   your phone page turns green.
7. **Every screen** (barista tablets, kiosk, queue board): if a banner offers
   a newer version, tap it. Then check each shows today's event name.
8. **Orders → All orders**: cancel your test order (and anything left from
   yesterday). Doors open.

If step 5 or 6 fails, use the network table below before touching anything
else.

## When something goes wrong

### Nothing loads anywhere
*You'll see:* every device spins or says it can't reach the server.
1. Use the network table below. If **both** networks are dead, it's the
   server, not the venue.
2. Check the health page: `https://cupq.app/api/health`. No answer → open
   Railway → **web** → **Deployments**. If the newest deployment failed or
   is stuck, press **Redeploy** on the last good one (about 2 minutes).
3. Meanwhile, go to the **paper fallback** (bottom of this page). Texted
   orders keep queueing on Twilio's side and arrive when the server is back.

### The network table (which network died?)
Run the kiosk or queue board on the **Nighthawk** and one staff phone on
**venue Wi-Fi**. When something breaks, read the answer off this table:

| What died | Where the fault is | Do this |
|---|---|---|
| Both devices | The server (see above) | Health page, Railway |
| Only the Nighthawk device | Mobile data, SIM or the Nighthawk | Power-cycle the Nighthawk (30 s off) |
| Only the venue-Wi-Fi device | Venue Wi-Fi | Move staff devices to the Nighthawk |

The printer stays on the Nighthawk regardless: no label means no order.

### Texts aren't arriving
*You'll see:* a red **"Text messages are NOT sending"** banner on the barista screen, or
customers saying they never got the ready text.
1. **Messages → Text meter**: if it says *Cap reached*, texts were stopped on
   purpose. Raise the cap there if the client agrees to the extra texts.
2. Otherwise it's the text provider. Customers still see their order on the
   **queue board** and their **phone page**, so service continues.
3. **Messages → Tell everyone**: post "Texts are delayed. Watch the screen
   for your name" on the board and phone pages.
4. Tell the organiser. Don't change any settings to "fix" it.

### A printer stops printing
*You'll see:* orders start but no labels; or **Printers** shows *Offline*.
1. Paper and lid: open it, check the roll, close it firmly.
2. Power: off for 10 seconds, on again. It reappears as *Online* within
   about 15 seconds.
3. Still offline: is it on the Nighthawk? Hold **FEED** while powering on to
   print its network details.
4. Meanwhile, write names on cups. To reprint a missed label once it's back,
   use the **print** button on that order's card on the barista screen.

### A barista tablet freezes or dies
1. Walk to the nearest **display screen**. Press and hold the **top-left
   corner** for 3 seconds and enter the PIN.
2. **Switch to Barista** → log in → pick the dead station.
3. Keep serving. Total time: about twenty seconds.

### An order is stuck
*You'll see:* an order sitting in *Waiting* or *Making* that nobody is
making (a test order, a duplicate, a customer who left).
**Orders → All orders** → the order → **Cancel order**. It leaves every
count and alert straight away.

### Something has sold out
On the barista screen's **Stock** tab, tap the item. It's marked sold out
on every ordering channel immediately; tap again to bring it back.

### A station is swamped
**Live** shows every station's queue. On the barista screen, use an order
card's **Move** button to send waiting orders to a quieter station, or post
a notice (Messages → Tell everyone) pointing people to the other cart.

## Switches that matter on the day

- **Unlimited stock mode** (Quick Setup): ON = never refuse for stock
  (still counts everything). OFF = refuse what can't be made, with the same
  message on every channel. Takes effect within about 10 seconds.
- **Sold-out board** (barista Stock tab): one tap, every channel, instantly.
- **Device PIN**: opens the hidden admin panel on displays and the barista
  padlock. Default 1234: **change it before the event** (see the setting's
  current home in the Runner).

## Cup counts (for the reconciliation report)

- Morning: count each station's cup stacks and enter them as the start
  count under **Stations → Event Stock → Cup reconciliation**.
- Pack-down: count what's left and enter the end count.
- The difference from the order count appears straight away. Around ±5 is
  normal (staff coffees, remakes).

## When the system must NOT be touched

Never merge, deploy or restart while baristas are serving. Fixes wait until
the break is over or the day is done. If a rollback is unavoidable, see
docs/RELEASE_AND_ROLLBACK.md: nothing already ordered is lost, but every
device needs to accept the "new version" banner afterwards.

## Paper fallback

If everything digital dies: pen, the paper pad, and names written on cups.
The text number keeps accepting orders into the queue for when the screens
come back. Nothing is lost, only delayed.

## Who to call

| Problem | First call | Then |
|---|---|---|
| Anything technical | The on-call person on this event's roster | Steve |
| Venue Wi-Fi or power | Venue AV / operations desk | |
| Printers, cups, stock | Station lead | Steve |

(Fill in names and numbers for each event: roadmap task U4-6.)
