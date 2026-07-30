# CoffeeCue ↔ EventsAir Integration — Research Findings & Test Plan

> Research date: July 2026. Sources: developer.eventsair.com (GraphQL docs, change log), EventsAir product pages. API is evolving monthly — re-check the change log before build.
>
> Repo note: this is the research document the Survey Order Channel spec
> references. Implementation status against it lives at the bottom and in
> `EVENTSAIR_SURVEY_CHANNEL.md`.

---

## 1. What the EventsAir API definitely provides (confirmed in docs)

### Platform basics
- **Single GraphQL endpoint**, OAuth2 client-credentials auth, API keys with granular permissions (e.g. a separate "Enable webhooks" permission). Apollo Sandbox + GraphQL Voyager provided for schema exploration.
- Monthly releases; deprecation-with-notice policy; paged queries (`*Paged`) are the current pattern.

### Attendee data (the correlation problem — SOLVED via API)
- `Event.contacts` / `contactsPaged` with rich filtering; single-contact lookup by ID.
- Contacts expose phone/mobile, email, names, registration data. **Mobile-number correlation is a straightforward query** — pull the event's contacts, index by normalised mobile, match inbound SMS sender → attendee identity.
- `Contact.communications` query exists (sent comms history per contact).

### Custom fields (the "coffee order on the attendee record" — SOLVED via API)
- Full CRUD on **custom field definitions** via mutations (`createEventScopedCustomFieldDefinition`, tabs, etc.) and **custom field values are set through the normal create/update mutations** — upsert semantics: supply the definition ID, value is created or updated.
- Types include text, numbers, booleans, TAG (fixed value lists). Fields can be flagged as containing personal data (GDPR handling).
- So CoffeeCue can: create a "Coffee Preference" and/or "Coffee Orders" custom field per event, write each order (or a running summary/JSON blob) back onto the attendee's record. Organisers then see coffee data inside EventsAir and can use it in EventsAir's own reporting/merge docs.

### Outbound messaging FROM EventsAir via API (partially solves notifications)
- **`queueEventTextMessageCommunication`** — queue an SMS to event contacts through EventsAir's comms platform (added May 2026). CoffeeCue could trigger "your coffee is ready" SMS via EventsAir instead of Twilio/Mobile Message for EA-linked events. Costs/sender-ID sit on the organiser's EventsAir account — potentially attractive commercially (client pays their own SMS).
- **`queueContactStoreEmailCommunication` / HtmlEmail variants** (added July 2026) — programmatic email, merge-doc or raw HTML.
- Caveat noted in change log: earlier bug "module not enabled" errors on these mutations — the client's EA subscription must have the communications module enabled. Verify per client.

### Webhooks (real-time sync — CONFIRMED)
- `createWebhookSubscription` with event types like `Event.Contact.Created` / `Event.Contact.Updated`, filters per event/contact store, up to 10 subscriptions, signed headers for authenticity, delivery-attempt query + replay, 90-day payload retention, management portal.
- So CoffeeCue can subscribe to contact changes for the event and keep a **local mirror of the attendee list** (name + mobile + contact ID) that's always current — no polling, and SMS correlation works even if EA is briefly unreachable.

### Badges / QR (mechanism confirmed, payload format NOT documented publicly)
- EventsAir check-in is built around **a unique QR code per attendee** (self check-in kiosks, staffed scanning, remote check-in via the app; attendees also carry their QR in the event app for lead retrieval).
- What's NOT in public docs: the exact QR payload on Treenet's badge stock (raw contact/registration ID? URL? EA-proprietary token?). This is a **test item** — scan a real badge and inspect the string.
- Fallback if payload is opaque: EventsAir supports custom badge designs — ask the organiser to add a second barcode/QR containing the plain contact ID or mobile number via merge field. Organiser-side config, zero API work.

---

## 2. The gaps — what the API does NOT (visibly) provide

1. **No documented mutation to send an attendee-app PUSH notification / alert.** EventsAir's marketing confirms app push alerts exist, and the console/Organizer App can send them — but the public GraphQL change log shows email + SMS queue mutations only. **Per-attendee programmatic push is unconfirmed.** (This matches our earlier open question.)
   - Test/ask: EventsAir support ticket + schema introspection in Apollo Sandbox for anything like `queueAppAlert`/`notification` mutations. Also check whether EA "app alerts" can be triggered by EA's own automation on a custom-field change (indirect path: CoffeeCue writes field → EA automation sends alert).
2. **No documented "add a button to the attendee app" API.** However, EventsAir app menus support custom links/portal pages (change log references App Store Portals in the `links` query). The realistic pattern is a **menu item in the event app linking to a CoffeeCue web page**, with the attendee's identity passed via EA merge-field in the URL (e.g. `?contactId={ContactID}`). Config is organiser-side in the EA app builder, not API.
   - Test: whether EA app external links support merge fields in URLs (docs suggest merge fields are pervasive in comms; confirm for app links).
3. **Badge QR payload format** — undocumented, needs a physical scan test (above).
4. **API usage limits** — a cost/quota model exists ("operation-cost calculator", "Updated API quota limits"). Fine for our volumes (hundreds of ops/day), but confirm quota tier on the client's account before relying on webhook + write-back at load-test scale.
5. **Sandbox access** — developer portal references a sandbox/test tenant (developer.eventsairtest.com). Getting API credentials requires the organiser (Treenet's EA account owner) or an EA partner arrangement to issue an API key with the right permissions. **Blocking prerequisite: request credentials + webhook permission + comms module status from the client.**

---

## 3. Recommended integration architecture (build order)

### Phase 1 — Identity sync (foundation, all value flows from this)
1. Obtain API credentials scoped to the Treenet event (read contacts, read/write custom fields, webhooks, queue SMS).
2. Nightly full pull + webhook-driven incremental sync of contacts → local `ea_attendees` table (`ea_contact_id`, name, mobile_normalised, email).
3. Inbound SMS handler: match sender number → attendee → orders become identity-linked ("Flat White for Sarah M (delegate)" instead of just a number). Unmatched numbers behave exactly as today.

### Phase 2 — Order write-back (organiser-visible value)
4. Create event-scoped custom fields via API: e.g. `CoffeeCue Orders` (text/JSON summary), `Coffee Preference` (TAG or text).
5. On each completed order for a matched attendee, upsert the custom field. Treenet sees coffee engagement inside EventsAir; post-event, it feeds their own reports.

### Phase 3 — Badge scan ordering (barista-side fast lane)
6. Add "Scan badge" to BaristaInterface/walk-in dialog: camera QR scan (browser `BarcodeDetector` / jsQR — works in Safari on iPad) → resolve payload → attendee → pre-filled order (name auto-populated, mobile known for ready-SMS, stored preference pre-selected → "The usual?" one-tap order).
7. Requires the QR payload test; if opaque, request the extra plain-ID barcode on badge design.

### Phase 4 — Attendee-initiated ordering via the EA app (self-serve lane)
8. CoffeeCue mobile ordering web page (exists conceptually as the SMS alternative): `order.coffeecue.app/treenet?cid={ContactID}` — attendee lands pre-identified, picks drink, order enters the same queue. Add as a menu button in the EA event app by the organiser.
9. Ready-notification for these orders: SMS via existing path (or `queueEventTextMessageCommunication` if we want EA-billed SMS). If the push-notification test (gap #1) succeeds, upgrade to app push.

### Explicitly NOT building
- Anything depending on undocumented push APIs until confirmed.
- Two-way sync of order state into EA beyond custom fields (keep EA as identity + comms rail, CoffeeCue as the operational system).

---

## 4. Test checklist (in order, before committing to Phases 3–4)

| # | Test | Method | Pass criteria |
|---|---|---|---|
| 1 | Get API key + permissions | Ask Treenet's EA admin (or EA partner program) | Key works in Apollo Sandbox against their tenant |
| 2 | Read event contacts incl. mobile | `contactsPaged` query | Mobiles present & queryable for ≥90% of registrants |
| 3 | Create + write custom field | mutations above | Field visible in EA console on a test contact |
| 4 | Webhook round-trip | `createWebhookSubscription` → edit a contact in EA → Railway endpoint receives signed message | <60s latency, signature verifies |
| 5 | Queue SMS via EA | `queueEventTextMessageCommunication` to own number | SMS arrives; note sender ID + cost model; confirm comms module enabled |
| 6 | Badge QR payload | Scan a real/test badge, dump raw string | Contains a resolvable ID (else: request extra barcode on badge design) |
| 7 | App menu link with merge field | Organiser adds test link `...?cid={ContactID}` in app builder | Landing page receives correct contact ID |
| 8 | App push via API | Schema introspection + EA support question | Mutation exists OR automation-on-field-change workaround OR mark as unavailable |
| 9 | Quota sanity | Run Phase-1 sync at load-test volume | No quota errors; note operation costs |

## 5. Questions to send EventsAir support / the organiser now
1. Can API keys be issued for a single event scope on Treenet's tenant, and who approves?
2. Is the communications (SMS/app messaging) module enabled on their plan?
3. Is there any API surface (current or roadmap) for sending attendee-app push alerts programmatically?
4. What does the badge QR encode by default, and can the badge template add a merge-field barcode?
5. Do event-app menu links support merge fields in external URLs?

---

## Implementation status (2026-07-31, PRs #179 / #180 / this one)

| Research item | Status |
|---|---|
| Phase 1.2 — `ea_attendees` mirror (full pull + webhook incremental) | **Built** (`POST /api/ea/sync-attendees` + contact-webhook touch; nightly pull not scheduled yet — manual/`webhook` driven) |
| Phase 1.3 — inbound SMS → attendee identity match | **Built** (this PR: mirror lookup in `get_customer`; first-time texters on the registration list are greeted by name and their orders carry it; unmatched numbers behave exactly as before) |
| Survey channel (spec "Phase 4B") | **Built** behind `EA_SURVEY_CHANNEL_ENABLED` — see `EVENTSAIR_SURVEY_CHANNEL.md` |
| Phase 2 — custom-field order write-back | Not built (next candidate once credentials exist) |
| Phase 3 — badge-scan fast lane | Not built (blocked on badge QR payload test, checklist #6) |
| Phase 4.8 — EA app menu link → kiosk page with `?cid=` | Not built; the kiosk ordering page exists, pre-identification via contact ID is a small follow-up |
| EA-billed SMS (`queueEventTextMessageCommunication`) | Not built; noted as a commercial option (client pays own SMS) |
