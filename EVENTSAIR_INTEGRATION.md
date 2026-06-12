# EventsAir ↔ Coffee Cue integration

Status: **design + scaffold** (2026-06-12). No EventsAir API key yet —
the Coffee Cue side is built behind a clean, mockable boundary and is
ready to flip on the moment credentials exist. The EventsAir-side
mechanics marked ⚠️ need confirmation from EventsAir (their docs /
support / a Smart Connector conversation).

## The vision (Steve's words)

> "Allows people to place order via EA app, and get notifications.
> Coffee Cue talks to EA notifications and CC stock control. Messages
> from CC app go to EA."

So: a conference attendee orders coffee **inside the EventsAir app they
already have**, the order lands in Coffee Cue's normal barista queue and
decrements Coffee Cue stock, and status updates ("being made", "ready
for pickup") are delivered back through **EventsAir's push
notifications** — not only SMS. Two-way.

## Why it's worth doing

EventsAir is a dominant conference platform in Coffee Cue's core market
(AU events). "Coffee that's built into the event app" is a premium,
sticky, white-label selling point: no separate number to advertise, no
"text this to order", the attendee uses one app for the whole
conference. It also unlocks attendee identity (name, registration
category) so VIPs are auto-flagged and nobody re-types their name.

## What EventsAir actually provides (researched 2026-06-12)

- **Open GraphQL API** — OAuth 2.0 **client-credentials** (Client ID +
  Secret → bearer access token). Created in the EventsAir UI.
  Attendee/contact + registration data is queryable. Rate-limited.
  Sandbox available (Apollo Sandbox + `eventsairtest.com`).
- **Webhooks** — "contact updated", "new registration", etc. → we can
  receive near-real-time events.
- **Push notifications** — EventsAir can push alerts to attendees'
  devices. This is our outbound "your coffee is ready" channel.
- **Smart Connectors** — a no-code integration option EventsAir builds/
  maintains; the alternative to the raw Open API for some flows.
- **Attendee App + Organizer App** — custom mobile apps.

Sources: [EventsAir Developer Portal](https://developer.eventsair.com/docs/),
[Get an access token](https://developer.eventsair.com/docs/guides/access-token/),
[Integrations](https://www.eventsair.com/event-management-software/event-integrations),
[Event app](https://www.eventsair.com/event-management-software/event-app).

## The big open question ⚠️ — how an attendee places the order *in* the EA app

This is the one piece that depends on EventsAir capabilities we can't
confirm without their team / detailed app docs. Three plausible
mechanisms, in order of likely effort:

1. **Embedded web view / custom page (most likely, lowest effort).**
   The EA Attendee App hosts a custom page or external link that points
   at a Coffee Cue mobile ordering page (passing the attendee's id /
   token so we know who they are). The attendee taps "Order Coffee",
   fills the Coffee Cue form, submits → Coffee Cue creates the order.
   Coffee Cue already renders mobile-friendly pages (receipt, track).
   **We can build the ordering page now; EA just needs to link to it.**

2. **Smart Connector / EA form → webhook.** EventsAir collects the order
   via one of its own modules and POSTs it to a Coffee Cue webhook
   (`/api/integrations/eventsair/order`). No-code on EA's side, but
   depends on what fields their module can capture.

3. **API-driven deep integration.** Coffee Cue and EA exchange data via
   the GraphQL API + webhooks in both directions. Most powerful, most
   work, needs the most from EA.

**Coffee Cue's side is the same regardless of which wins:** a normalized
inbound order endpoint + an attendee-identity lookup + an outbound
notifier. That's what this scaffold builds. When Steve learns which
mechanism EA supports, only the thin adapter at the edge changes.

## Architecture (Coffee Cue side)

```
  EA Attendee App
      │  (order: embedded page OR EA module OR API — see open question)
      ▼
  POST /api/integrations/eventsair/order   ← shared-secret auth
      │  normalize EA payload → canonical order
      ▼
  create_order_record()   ← THE SAME path walk-in + SMS orders use
      │  capability check · order number · INSERT · WS emit · STOCK DECREMENT
      ▼
  Barista queue (unchanged) ── barista makes it, taps Ready
      │
      ▼
  on status change → notify():
      ├─ SMS (existing)
      └─ EventsAirClient.push_notification()  ← NEW, to the attendee's EA device
```

Mirrors the **SMS provider abstraction** (`services/sms/`): one clean
interface, mockable, config-gated, health-checked. Same playbook.

### Components

- `services/eventsair/client.py` — `EventsAirClient`:
  - `get_token()` — OAuth client-credentials → cached bearer token.
  - `find_attendee(phone=…|email=…|external_id=…)` — GraphQL query for
    attendee identity + registration category (→ name + auto-VIP).
  - `push_notification(attendee_ref, title, body)` — outbound status.
  - All stubbed (log + return canned data) when no creds / TESTING_MODE.
- `services/eventsair/__init__.py` — config (settings KV: enabled,
  client_id, client_secret, event_id, webhook_secret, vip_categories)
  + a `get_client()` factory.
- Routes (`/api/integrations/eventsair/...`):
  - `POST /order` — inbound order (shared-secret), → `create_order_record`.
  - `POST /webhook` — EA webhooks (registration created/updated) → upsert
    `event_attendees`.
  - `GET/PUT /config` — Organiser connects EA (admin only).
  - `GET /status` — health (configured? token ok? attendee count).
- `create_order_record()` — extracted shared order-creation core so
  walk-in, SMS, and EA orders are ONE implementation (stock control is
  not optional, it must be the real path).
- Outbound: hook `EventsAirClient.push_notification()` into the existing
  order-ready notification alongside SMS.

### Data model

`event_attendees` (new table, migration):
```
id, external_id (EA contact id), phone, email, full_name,
registration_category, is_vip, raw (jsonb), synced_at
```
The SMS flow already keys customers by phone — when an inbound SMS or EA
order arrives, we look up `event_attendees` by phone to get name +
VIP + EA external_id (needed to push notifications back).

Config lives in settings KV under `eventsair_config` (no per-event
secret bleed — same pattern as branding/printer config).

## Phased plan

- **Phase 0 — scaffold (this PR).** Client stub, config, inbound order
  endpoint routed through the shared `create_order_record()` (real stock
  control), outbound push hook (stubbed), health, smoke. Nothing talks
  to the real EA yet; everything is ready to.
- **Phase 1 — identity.** `event_attendees` table + webhook receiver +
  attendee lookup in the SMS/order flow (skip name prompt, auto-VIP).
  Needs: API key + the webhook config in EA.
- **Phase 2 — ordering in the EA app.** Build the Coffee Cue mobile
  ordering page; get EA to link to it (mechanism #1), OR wire the EA
  module/webhook (mechanism #2). Needs: the open-question answer.
- **Phase 3 — notifications.** Real `push_notification()` against EA.
  Needs: confirmation of EA's push API surface.

## What we need from EventsAir (the ask list for Steve)

1. An **API key** (Client ID + Secret) — even sandbox — to build Phase 1.
2. Confirmation of **how the Attendee App can surface a custom order
   action** (embedded page / link / module) — decides Phase 2.
3. Confirmation of the **push-notification API** (can a 3rd party
   trigger a push to a specific attendee?) — decides Phase 3.
4. Which **registration categories** map to VIP (Speaker, Sponsor, …).

## Security notes

- Inbound `/order` and `/webhook` are gated by a shared secret
  (`X-Coffee-Cue-Webhook-Secret`), same pattern as the ClickSend/Cellcast
  webhooks.
- EA Client Secret stored in settings KV / env, never returned by the
  config GET (write-only field).
- Order creation reuses the existing capability + stock + queue path —
  no parallel order logic to drift or under-validate.
