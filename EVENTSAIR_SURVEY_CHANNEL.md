# EventsAir Survey Order Channel (BETA)

Attendees order coffee from inside the EventsAir event app by submitting
a "Coffee Order" survey. EA fires a webhook to CoffeeCue; CoffeeCue
fetches the response via GraphQL, resolves the attendee (name + mobile),
and injects the order into the normal queue. Confirmation + "ready"
notifications go out via the existing SMS rail. Phase-0 background:
`EVENTSAIR_INTEGRATION.md`.

**Feature flag: `EA_SURVEY_CHANNEL_ENABLED` (default false).** With the
flag off every `/api/ea/*` route refuses work (503) and nothing can
touch an order — zero impact on SMS ordering.

## Configuration (Railway env vars)

| Var | Meaning |
|---|---|
| `EA_SURVEY_CHANNEL_ENABLED` | master switch, default `false` |
| `EA_CLIENT_ID` / `EA_CLIENT_SECRET` | OAuth2 client-credentials |
| `EA_TENANT_ENDPOINT` | per-customer GraphQL endpoint URL |
| `EA_WEBHOOK_TIMESTAMP_TOLERANCE_S` | replay window, default 300 |
| `EA_FETCH_RETRIES` | GraphQL fetch retries, default 3 |
| `PUBLIC_BASE_URL` | used by `flask ea setup-webhooks` for the webhook URL |

Channel-specific state lives in the `ea_config` DB row (edited via
`PUT /api/ea/config`, admin JWT): `ea_event_id`, `ea_survey_ids`
(**JSON array** — supports one survey per break if EA blocks
re-submission, see Open Questions), `question_map`, `signing_secret`
(write-only; never echoed or logged), `signature_mode` (`svix`|`raw`),
`webhook_subscription_id`.

## EA-side survey design (organiser)

Create a survey per the spec — choice lists, not free text:

1. **Drink** — single choice: Flat White / Latte / Cappuccino / Long
   Black / Espresso / Hot Chocolate / Tea
2. **Milk** — single choice: Full cream / Skim / Oat / Soy / Almond / None
3. **Sugar** — single choice: 0 / 1 / 2
4. **Notes** — short text, optional (only free-text field; truncated to
   60 chars on the barista card)

Name it "☕ Coffee Order — <Break Name>". Milk left unanswered defaults
to full cream **and the confirmation SMS recaps it** (visible, never
silent — house rule).

## Setup runbook (once credentials exist)

1. Set the env vars; redeploy. Keep `EA_SURVEY_CHANNEL_ENABLED=false`.
2. `PUT /api/ea/config` with `ea_event_id` and `ea_survey_ids`.
3. `flask ea map-survey` — prints every question + ID and writes a draft
   `question_map` (auto-detects drink/milk/sugar/notes from question
   text). Review via `GET /api/ea/status`; adjust via `PUT /api/ea/config`.
   Question IDs are **never hardcoded**.
4. `flask ea setup-webhooks` — lists `webhookEventTypes` (record the
   real survey event type name below), creates the subscription scoped
   to the event, stores subscription id + signing secret.
5. Flip `EA_SURVEY_CHANNEL_ENABLED=true`; redeploy.
6. Rehearse without EA: `POST /api/ea/test-order` (admin JWT) runs the
   full worker path off a fixture — expect a queued order with the APP
   badge. Default has no phone (needs_contact path, zero SMS); pass
   `{"phone": "..."}` to exercise the confirmation SMS.
7. Submit a real survey in the EA app; watch `GET /api/ea/status` and
   the Support panel. Target latency < 30s (§9).

## How it works / guarantees

- **Thin payloads**: the webhook carries only IDs + `correlationId`.
  Payload contents are never trusted beyond IDs — the worker always
  fetches fresh via GraphQL (3 tries, 2s/4s backoff for read-after-write
  lag).
- **Fast ACK**: the route verifies the signature on the RAW body,
  dedupes on `correlationId`, inserts a log stub, spawns a worker
  thread, returns 200 — well inside EA's 15s budget.
- **Idempotency, two walls**: `correlation_id` UNIQUE in
  `ea_webhook_log` (replayed webhook → `duplicate`, no order), and
  `ea_response_id` UNIQUE on `orders` (replay with a NEW correlationId
  still can't double-create; a worker race cancels the loser).
- **No half-parsed orders**: any unmappable answer → log `failed` +
  error feed entry, no order.
- **No mobile on the contact**: order still created, flagged
  `needs_contact` — barista calls the name; no SMS attempted.
- **EA outage**: the app channel goes silent; SMS ordering is untouched.
  Missed webhooks can be replayed from the EA portal — replays are
  dedupe-safe (walls above).
- Failures land in the webhook log (`GET /api/ea/webhook-log`) and the
  system events feed (`component: ea-integration`).

## Testing

- Offline unit tests (signature valid/tampered/stale, mapping happy/
  malformed/truncation, E.164): `venv/bin/python tests/unit/test_ea_survey.py`
- Live (flag on): `POST /api/ea/test-order`; bench suite `ea_channel`
  (skips honestly while the flag is off).

## Open questions — resolve at first sandbox access (spec §10)

| # | Question | Where it bites | Answer (fill in) |
|---|---|---|---|
| 1 | Exact survey webhook event type name | `flask ea setup-webhooks` filter | _TBD via `webhookEventTypes`_ |
| 2 | Can a contact re-submit the same survey? | single survey vs one-per-break (`ea_survey_ids` is already an array) | _TBD_ |
| 3 | Read-after-write lag webhook→GraphQL | retry/backoff tuning | _TBD (2s/4s default)_ |
| 4 | Contact inline on the response, or ID only? | worker resolution order (inline → mirror → direct query all implemented) | _TBD_ |
| 5 | EA-side automation push on survey response | free "order received" app push (bonus) | _TBD_ |
| 6 | Exact signature scheme | `signature_mode` config: `svix` (default) or `raw` | _TBD at first real webhook_ |

Every GraphQL query string in `services/eventsair/survey_client.py` is
marked `TODO_EA` where the live schema must confirm field names — they
follow the documented entity names (`surveysPaged`, `SurveyResponse`,
`QuestionResponse`, `contactsPaged`, `webhookEventTypes`,
`createWebhookSubscription`) but were written without sandbox access.

## PII

The attendee mirror stores name, mobile, email, contact ID only. Purge
post-event:

```sql
TRUNCATE ea_attendees;
```
