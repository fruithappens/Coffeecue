# Expresso — an opinionated review

*By Claude Opus 4.7, 2026-05-19, after ~2 days of reading code and making focused fixes.*

You asked what I'd change. This is honest, not a sales pitch — I'm going to flag things I think are wrong, things I think are great, and a few bigger directional bets you might take or leave. Where I cite line numbers I've actually looked at the code; where I'm guessing I'll say so.

---

## The single biggest thing

**The conversation parser is doing more harm than its complexity is worth.**

[services/nlp.py](services/nlp.py) is ~700 lines of regex + alias tables that try to recognise every way a human might phrase "large oat latte 2 sugar". It works *fine* for the canonical cases and falls down predictably on anything unusual ("a bit of sugar", "make it iced", "actually scrap that, make it a flat white"). The state machine in [services/coffee_system.py](services/coffee_system.py) is 4,300 lines and most of it exists to compensate for the fact that the parser returns a flat dict with no confidence, no slot-tracking, and no ability to handle revisions.

What I'd actually do: keep the regex parser as a fast path for the obvious cases, and behind it call a small LLM (Haiku, sub-second, cheap) with a strict JSON output schema for everything that doesn't parse cleanly. Two benefits compound:

1. The "ignored my SMS" problem (the one you described) largely goes away because the LLM can hold an order in mind across messages and ask exactly what's missing, not whatever the next state in the chain expects.
2. You can support natural editing mid-order: *"actually make it medium"*. Right now the only way to edit is `EDIT`, which restarts the entire flow ([services/coffee_system.py:1470](services/coffee_system.py:1470)). That feels broken even when it isn't.

It's a real change. I'd phase it: ship as an opt-in flag, A/B against the regex flow for a week, measure customer follow-up SMS counts (a proxy for confusion).

---

## Customer-facing issues I'd fix

### High-impact, small
1. **Read back what you understood, every step.** I added this for the coffee-type → milk → size → sugar path in this session. The friend/group flow does it now too. But the post-confirmation messages and reminders don't. When the customer gets *"✅ Order #A1402153 confirmed!"* they have no way to verify the bot heard them right.
2. **Stop using order numbers like `A1402153`.** That's `<AM/PM><HHMMSS><microsecond_chunk>`. It's collision-resistant but it's not a number you can shout across a café. Use a per-event running counter ("Order #142") for the customer-facing string and keep the timestamp version in the DB as `external_id`. The risk is double-claiming when two stations process concurrently, but a Postgres sequence handles that natively.
3. **No "your order is being made now" notification.** Customers get the confirmation, then silence, then ready. The gap is anxiety-inducing — they go ask the barista if it's been forgotten. A single "your barista just started your latte 👋" SMS when the order moves into in-progress would massively reduce floor traffic.
4. **No queue position / live wait time.** You have the data — `current_load` is right there in [services/coffee_system.py:2264](services/coffee_system.py:2264) — but the customer never sees it. *"You're number 4 in line, ~6 min"* is a one-SMS feature.
5. **Sugar vs. sweetener confusion.** [services/coffee_system.py:1198](services/coffee_system.py:1198) literally has a workaround comment about Equal being miscategorised as sugar. The data model conflates two different things. A drinker asking for stevia gets routed to a sugar dispenser. Split the schema.
6. **The `USUAL` shortcut is hidden.** It's a great feature buried in the docs. Surface it: when a returning customer texts, the first reply should literally show *"Reply USUAL for your normal order (large oat latte, 1 sugar) or tell me what you want."*

### Medium / opinionated
7. **2-way SMS-to-web fallback.** When the customer's first SMS comes in, reply with *both*: a follow-up text question AND a one-tap link to a tiny web form pre-filled from their phone. Some people prefer chat; some prefer tapping buttons. The current pure-SMS flow forces everyone through the same conversational funnel even when a web form would be faster.
8. **Group orders are painful over SMS.** You support them (the `awaiting_friend_*` states) but it takes 8-12 messages for a group of three. A web form linked from the first SMS would do it in 30 seconds. The SMS group flow should stay as a fallback for people who don't want to tap a link.
9. **No cancel window.** Once confirmed the customer can text `CANCEL` (good) but I didn't find a time gate — if the barista has already pulled the shot, cancelling shouldn't be free. Surface a *"too late to cancel — your barista is making it now"* path.
10. **VIP codes are global.** A single `VIP_CODE` shared with a few people, plus optional custom codes ([services/coffee_system.py:859](services/coffee_system.py:859)). If a code leaks it's a manual rotation. Either generate per-recipient codes from the organiser UI, or move to a one-tap link with a signed token. (Probably YAGNI for small events.)
11. **The bot's voice is robotic.** *"I'm not sure what type of coffee you'd like. Please specify a coffee type like latte, cappuccino, flat white, etc."* No event organiser would write that — they'd say something like *"didn't catch that — what are you after? ☕"*. The strings should be settings-driven (some are, via `_get_setting`), so this is mostly content work.

---

## Barista-facing issues I'd fix

### High-impact, small
1. **The interface is overwhelming.** [Barista Front End/src/components/BaristaInterface.js](Barista%20Front%20End/src/components/BaristaInterface.js) is 2,979 lines. There's also a `ModernBaristaInterface.js` (1,156 lines) and a `barista-tabs/` directory. Three parallel attempts to solve the same UI. At a real morning rush, a barista shouldn't be choosing tabs — they should be looking at *the next three orders* and nothing else.
2. **Build a "Rush mode" view.** When pending > 10, collapse the UI to: current drink, next two on deck, batch hints ("two oat lattes coming up — pour together"), and one big "DONE" button. Hide everything else. Triggered manually with a toggle or automatically by queue depth.
3. **Surface batching opportunities.** Two oat lattes back-to-back should be flagged so the barista heats milk once. The data is all there; just needs a UI hint.
4. **Order-edit at the barista station.** If a customer walks up and says "actually can I make it decaf?", the barista has no in-app way to amend. Today they have to cancel + walkup-create. A simple inline edit on an in-progress order would be a quick win.
5. **Station chat ([Barista Front End/src/components/StationChat.js](Barista%20Front%20End/src/components/StationChat.js)) needs notification audio + a badge.** Without one, station-to-station messages will be missed.
6. **The display screen ([Barista Front End/src/components/DisplayScreen.js](Barista%20Front%20End/src/components/DisplayScreen.js)) is what customers see. It deserves the most polish and probably has the least.** I'd start there for visible wins.

### Medium / opinionated
7. **No barista accountability metrics.** [Barista Front End/src/components/StaffManagementPanel.js](Barista%20Front%20End/src/components/StaffManagementPanel.js) shows mock per-barista stats, but the backend doesn't compute them. For events with paid staff, this is real money: who's averaging 90 sec per latte vs. 4 min? That's a backend route over the `orders` table joined to `barista_id`. (Listed as one of the unbuilt features in the survey.)
8. **Inventory pushed from organiser doesn't reach baristas in real time.** Organiser changes a station's milk capability → barista interface keeps showing the old options until refresh. The WebSocket infrastructure is already there; just needs a `station:capabilities_updated` emit on the right route handler.

---

## Architecture / engineering observations

These are deeper changes. None of them block shipping, all of them get harder the longer they wait.

### Where the code surprised me (good)
- **Conversation state IS persisted to the DB**, not just held in memory ([services/coffee_system.py:3171](services/coffee_system.py:3171)). I assumed otherwise on first read and was wrong. A restart doesn't drop in-flight conversations. Nice.
- **Twilio signature validation is implemented properly** ([routes/sms_routes.py:49](routes/sms_routes.py:49)) with the Railway HTTPS-proxy fix worked out (commit `01dc261`). Easy thing to get wrong; this is right.
- **JWT refresh logic** in [Barista Front End/src/services/ApiService.js](Barista%20Front%20End/src/services/ApiService.js) is conservative and works around the 401 race condition reasonably.
- **Offline fallback for the frontend** is real — not just decoration. [Barista Front End/src/services/FallbackService.js](Barista%20Front%20End/src/services/FallbackService.js) caches last-known-good data and the UI degrades gracefully. This is the kind of thing that pays off precisely when you most need it (event Wi-Fi dies).

### Where I'd push back
- **[services/coffee_system.py](services/coffee_system.py) is 4,300 lines.** It's a god-class. Every state handler, every DB write, every business rule lives in one file. If two engineers ever work on this concurrently it'll be a merge-conflict factory. I'd split it: one module per state group (`order_flow.py`, `friend_flow.py`, `commands.py`), with shared helpers in a `coffee_system_helpers.py`. The state machine itself becomes a 200-line dispatcher.
- **Two database backends are still being maintained** (Postgres + SQLite). Every `INSERT` in `_confirm_order` is written twice with different parameter styles. Pick Postgres for prod and SQLite *only* in tests via the same parameter style (`?` works in psycopg2 with a thin shim). The dual-path is a continuous tax on every change.
- **`_confirm_order` has no transaction boundary.** It does the order INSERT, then customer_preferences UPDATE, then station_stats UPDATE, each with their own try/except. If the station_stats step fails after a successful order insert, you end up with an order that doesn't count against the station's load. Wrap the whole thing in a single transaction; only commit at the end.
- **Order number generation is collision-prone under load.** `f"{prefix}{now.strftime('%H%M%S')}{now.microsecond // 10000}"` ([services/coffee_system.py:1986](services/coffee_system.py:1986)) collides if two orders land within ~10 ms. At normal volume this is fine; at conference rush you'll see duplicates. Use a Postgres SEQUENCE.
- **Default credentials and "TESTING_MODE" handling.** CLAUDE.md lists the working admin as `coffeecue / adminpassword`. If that's the production admin, rotate it before going public. Also: any code path gated on `TESTING_MODE=True` is a foot-gun in prod. Audit with `grep -rn "TESTING_MODE"`.
- **Polling instead of WebSocket in places.** [Barista Front End/src/components/AllOrdersTab.js:31](Barista%20Front%20End/src/components/AllOrdersTab.js:31) has a 30-second `setInterval` even though the WebSocket service is already wired. Sub-second is achievable for free.
- **Two systems of identity** that never meet: SMS customers are identified by phone number; web customers by JWT. A customer who orders via SMS at one event and the web at the next is two different records. If you ever want loyalty across events, this needs joining.
- **Markdown docs out of date.** ~50 `.md` files at repo root. Several contradict each other. New people opening the repo can't tell what's current. I'd nominate **one** doc as canonical (`README.md`) and move the rest under `docs/legacy/` with a banner saying "may be stale".
- **Conversation logging is `logger.info(f"...")` everywhere.** Hard to search, hard to aggregate, no correlation IDs across an SMS conversation. Add a request ID per inbound SMS and propagate it; it becomes 10× easier to debug "why did THAT order go wrong" three weeks later.
- **Secrets in `.env`.** Already flagged in CLAUDE.md as a known issue. Critical for the cloud-deploy goal — Railway has env-var support, but the values shouldn't live in a checked-in file even as an example with the real creds redacted.

---

## Bigger / more speculative ideas

Take or leave. Roughly in order of how interesting I find them.

1. **A pre-event "ordering preview" link** the organiser sends out the night before. Customers see the menu, set their usual once, opt in to push notifications. Day-of, ordering is a single tap. Reduces SMS volume by ~70%. The data is all already modelled.
2. **Predictive pre-prep.** You know the conference schedule has a coffee break at 10:30. You know the 50 returning customers' usuals. Pre-stage milk pitchers and pre-fire orders 90 seconds before the break starts. This is what makes a coffee station *feel magic* at a conference. Operationally complicated (what if the talk runs over?) but high-ceiling.
3. **Self-serve event setup.** Today an organiser sets up an event through the Organiser interface (multiple tabs, lots of clicks). A guided wizard ("how many stations? what's your event date? upload your logo") would massively shorten time-to-first-event. Especially important if you do white-label.
4. **Inventory shrinkage tracking.** You count what's ordered. You don't count what's wasted (failed pours, dropped cups). For a paying organiser running a 500-person event, the variance between "ordered" and "actually used" is meaningful for cost reconciliation. A simple "report wastage" button on the barista UI feeds it.
5. **Multi-bar coordination at one event.** Several stations, one queue. The system kind-of does this already, but routing logic is naive ("which station has the most capacity?"). A better model: account for the milk distribution at each station (one station with oat, one without), the barista's measured throughput, walking distance from the customer's location if you have it. Mostly an algorithm change.
6. **Revenue tracking and per-event P&L.** If this is going commercial, the organiser wants to see total spend per event broken down by drink type, milk type, time of day. Reuse the data you already have. The Analytics dashboard skeleton exists; just needs the queries.
7. **Voice interface for accessibility.** Twilio supports inbound voice → speech-to-text → your NLP. Probably YAGNI today but very cheap to bolt on once the LLM-backed parser exists.
8. **Replace the four interfaces with one role-based app.** Landing, Barista, Organiser, Support are four React apps in one tree, each duplicating sidebar/header/auth. One app with role-gated routes would be simpler to maintain and easier to QA.

---

## Things that are fine — don't change them

Resist the urge to keep refactoring these:

- **The four-role permission model** (Admin / Staff / Barista / Customer). It's enough; don't over-engineer it.
- **Tailwind + lucide icons.** Boring, works, easy to hand off.
- **Flask-SocketIO over raw WebSockets.** Slightly heavier but the developer ergonomics are good.
- **JWT with refresh tokens.** Standard, well-understood, the implementation is fine.
- **localStorage caching as offline fallback.** Yes it's "tech debt" per CLAUDE.md — but for an *event-day* app where Wi-Fi flakes, this is the right tradeoff. Don't replace with IndexedDB unless someone's measured a real problem.
- **The Twilio dependency.** Don't try to abstract it behind a vendor-neutral messaging layer "for portability". You'll spend a month and never switch.

---

## What I'd actually do in the next 2 weeks

If you handed this to me as a real project, in priority order:

1. **Land the SMS confirmation read-back + "order being made now" + queue-position SMS** (~2 days, mostly content + small route changes). Biggest customer UX bump.
2. **Replace the order-number format** + add a per-event sequence (~half day). Solves the "what's my order again?" problem cheaply.
3. **Wire the planned-but-unbuilt broadcast-SMS route** ([SUPPORT_INTERFACE_DETAILED_PLAN.md](SUPPORT_INTERFACE_DETAILED_PLAN.md) Communications tab) (~1 day). Gives organisers an immediate, visible new power.
4. **Split [services/coffee_system.py](services/coffee_system.py) into modules** (~1-2 days, careful refactor with the new SMS unit tests as guard rails). Pays off forever.
5. **Audit and remove the two-database-driver code paths** (~1-2 days). Long-term debt reduction.
6. **Spike the LLM-backed parser** as an opt-in (~1-2 days for the spike, no commitment to ship). Find out if the customer-experience win is real before promising anything.

Stop and re-plan after this. The bigger ideas (pre-prep, single-app rewrite, identity unification) should wait until you've seen the system actually run a few real events under the existing architecture — you'll have much better data about which bets pay off.

---

*This document is one engineer's read after a couple of focused sessions. I haven't operated this at a real event; the operators have. Trust their lived experience over my code-reading instincts where they conflict.*
