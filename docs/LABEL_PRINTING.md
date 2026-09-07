# Label printing — setup, speed, and locking the door

Everything here is about **CloudPRNT**, the mode where the printer talks to the
server itself over the network with no computer in between. It is the mode all
three of our printers use.

---

## 1. Lock the printer endpoint (do this first)

`/cloudprnt` cannot use a login — a printer has no way to hold a token — so it
is guarded by a shared secret in the URL. **That guard fails open.** With no
secret set there is no check at all, and the endpoint is public.

Two things a stranger can do with an open endpoint:

* `GET /cloudprnt` returns the **rendered label** — a customer's name and their
  order.
* Fetching a job **consumes** it, so the real printer never receives it. Labels
  go missing one at a time and it looks exactly like a flaky printer.

**To close it**

1. On the server (Railway → Variables), set:

       CLOUDPRNT_SHARED_SECRET = <a long random string>

2. In each printer's own web config page, change the CloudPRNT server URL from

       https://cupq.app/cloudprnt

   to

       https://cupq.app/cloudprnt?secret=<the same string>

3. Check Runner → Live → Readiness. **"Printer endpoint is locked"** turns green.

Do the printers in the same sitting as the server variable: between the two
steps, every printer is locked out and nothing prints.

---

## 2. Make it fast

**The polling time on the printer is the whole story.** CloudPRNT version 1 is
pull-only: the printer asks "anything for me?" on a timer and the server can
only answer. A printer set to 30 s puts up to 30 s on **every** label, about
15 s on average.

The server cannot shorten it. Star's protocol has `GetPollInterval`, which
*reports* the number — there is no command to set it. It lives in the printer's
web config, and nowhere else.

**Set every printer's CloudPRNT polling time to 5 s.** One field, no code, and
it is the single biggest thing you can do for label speed.

Readiness (**"Label printers polling fast"**) measures the real gap between
polls and warns above 10 s, so you can confirm the change took.

### Why not faster than 5 s?

Each poll is a request. Three printers at 1 s is 10,800 requests an hour for
mostly "nothing for you". 5 s is quick enough that nobody notices and cheap
enough that nobody cares.

### What would remove the wait entirely

**CloudPRNT Next** adds MQTT, letting the server *trigger* a poll the instant a
label is queued instead of waiting for the timer. We do not speak it — there is
no MQTT client in this codebase, and adding one means running a broker,
credentials, and a publish-on-enqueue path. It also needs printer firmware 2.2
or later, which the older interface cards may not have.

It is a real project, not a tweak. **Set polling to 5 s first** — that gets most
of the benefit for no risk.

### The printers, and what each one is

Two of the three names are nicknames, so write it down once:

| In the app | What it actually is |
| --- | --- |
| `Station 1 mC-Label3` | mC-Label3 (MCL32CI) — currently disabled |
| `24v Star738F` | **also an mC-Label3 (MCL32CI)** — the older one. "24v" is Steve's name for it because it runs on 24 V; "738F" is the tail of its MAC address, not a model number |
| `TSP100IVSK` | TSP100IV SK, the linerless sticky-label model |

All three are thermal with CloudPRNT built in — no add-on interface card, no
impact mechanism. **There is no mechanical reason for any of them to be slow.**
If one is, it is the polling time.

`24v Star738F` also carries a per-printer `offset_dots` correction: it places a
raw image ~58 dots left of where the label physically is (58 mm stock against
our 406-dot render width). That is a position fix, not a speed one.

---

## 3. When a label does not come out

The queue decodes what the printer is telling us. Runner → Printers shows the
sentence, not the code:

* **"Out of paper"** — it has been saying so on every poll, possibly for an hour.
* **"A printed label is waiting in the output — take it and the queue will start
  again."** Status 221. The printer is *deliberately* refusing to print the next
  job until someone takes the last one. Nothing is wrong with the queued jobs
  and retrying them does nothing.
* **No polls seen at all** — power and network, not the queue.

A job that sits at *queued / 0 attempts / no error* is almost always the printer
refusing to collect it, not the server failing to offer it.
