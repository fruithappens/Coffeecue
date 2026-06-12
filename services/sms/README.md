# SMS provider abstraction

Twilio is the default. ClickSend and Cellcast are wired but disabled until
you set their env vars. All three can run simultaneously (each on its
own webhook URL); the outbound primary is picked by `SMS_PROVIDER`.

See `SMS_PROVIDERS_AU.md` at the repo root for the per-provider research
that drove this design.

## The big picture

```
                                                 ┌──────────────┐
        +61 489 COFFEE  ───  Twilio  ──── /sms ─────────────┐│
                                                                ││
        +61 4XX XXXX    ───  ClickSend ─── /sms/clicksend ──┼┤
                                                                ││ same NLP
        +61 4XX XXXX    ───  Cellcast  ─── /sms/cellcast ───┘│
                                                                 │
                                                          coffee_system.handle_sms()
                                                                 │
                                                    reply via THE SAME provider
                                                          (same number)
```

- **Inbound is per-provider.** Each provider has its own webhook URL. You
  can advertise all three numbers if you want — the system handles whichever
  the customer texts.
- **Outbound is one-at-a-time.** `SMS_PROVIDER` env var picks which
  provider WE use when WE send (order confirmations, "ready for pickup",
  reminders, BARISTA-mode replies). Flip the env var, redeploy, done —
  no code change.
- **Twilio still goes through the legacy path by default** for safety. To
  use the new factory: set `SMS_USE_PROVIDER_FACTORY=true` to opt in.
  Once shaken down in staging, this flips to default-on in a follow-up.

## Disaster-recovery story

Twilio outage mid-event:

```bash
# Old config — Twilio outbound, Twilio number 0489...
SMS_PROVIDER=twilio

# Flip to ClickSend outbound — assumes you have CLICKSEND_* env vars
# already populated and a ClickSend number registered.
SMS_PROVIDER=clicksend
SMS_USE_PROVIDER_FACTORY=true   # if not already on
```

Restart the backend (Railway: redeploy with new env vars). Outbound sends
now go via ClickSend's number. Inbound webhooks at `/sms` keep working
the whole time — Twilio's just receiving them, replying via ClickSend.

Caveat: customers' active conversations are mid-flow. They get a reply
from a new number. Plan for that: have the new outbound include "Replying
from our backup line — please reply here to continue your order."

## Adding a new provider

1. Drop a new module `services/sms/<name>_provider.py` subclassing
   `SMSProvider`. Implement `send()`, `verify_inbound()`, `parse_inbound()`,
   and `health()`. Set `name` and `webhook_path` class attrs.
2. Register in `services/sms/__init__.py:PROVIDERS`.
3. Add credential env vars (e.g. `MYPROV_API_KEY`).
4. Add an inbound webhook route in `routes/sms_routes.py` that calls
   `_process_inbound_via_provider('<name>')`.
5. Configure the provider's portal to POST to `https://<host>/sms/<name>`.

## Env var reference

### Common
- `SMS_PROVIDER` (default `twilio`): which provider's `send()` is the
  outbound primary.
- `SMS_USE_PROVIDER_FACTORY` (default `false`): opt-in to the factory in
  `services.messaging.MessagingService.send_message`. Set to `true` to
  swap outbound providers.
- `TESTING_MODE` (default `false`): every provider stubs `send()` in this
  mode and accepts unsigned inbound webhooks.

### Twilio (`twilio`)
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_PHONE_NUMBER`
- Webhook: `/sms`

### ClickSend (`clicksend`)
- `CLICKSEND_USERNAME`
- `CLICKSEND_API_KEY`
- `CLICKSEND_FROM_NUMBER` (E.164, e.g. `+61480000000`)
- `CLICKSEND_WEBHOOK_SECRET` (optional but strongly recommended)
- Webhook: `/sms/clicksend` — POST, JSON, add custom header
  `X-Coffee-Cue-Webhook-Secret: <CLICKSEND_WEBHOOK_SECRET>` in the
  provider portal.

### Cellcast (`cellcast`)
- `CELLCAST_API_KEY`
- `CELLCAST_FROM_NUMBER` (E.164)
- `CELLCAST_WEBHOOK_SECRET` (optional but strongly recommended)
- Webhook: `/sms/cellcast` — POST, JSON, add custom header
  `X-Coffee-Cue-Webhook-Secret: <CELLCAST_WEBHOOK_SECRET>`.

## How to test without spending real money

```bash
# Boot the backend with TESTING_MODE on — every send() is stubbed.
TESTING_MODE=true SMS_USE_PROVIDER_FACTORY=true SMS_PROVIDER=clicksend ./dev.sh --backend-only

# Hit the health endpoint and look for sms_* checks:
curl -s http://localhost:5001/api/health/full | jq '.checks[] | select(.name | startswith("sms_"))'
# Should show sms_twilio, sms_clicksend, sms_cellcast, sms_primary —
# all 'ok' under TESTING_MODE.

# Simulate a ClickSend inbound (no real secret needed in TESTING_MODE):
curl -X POST http://localhost:5001/sms/clicksend \
  -H 'Content-Type: application/json' \
  -d '{"from":"+61400000000","body":"latte oat","message_id":"cs_test_1"}'
# Backend should log the inbound, run it through the NLP, and stub the
# reply via clicksend.send() — visible in the server log.
```

## Validation status

- ✅ Provider registry resolves: factory test boots all three.
- ✅ Send-in-TESTING_MODE stubs correctly across all three.
- ✅ Health checks surface per-provider status.
- ⏳ ClickSend live send/receive — not yet verified against a real
  account (needs ClickSend creds + dedicated number).
- ⏳ Cellcast inbound payload shape — see `CELLCAST_INBOUND_SHAPE`
  comment in `cellcast_provider.py`; verify field names on first
  real inbound.

## Cost references (from `SMS_PROVIDERS_AU.md`, 2026-06)

At ~20k SMS/month:

| Provider | Monthly cost AUD | vs Twilio |
|---|---|---|
| Twilio | ~$1,667 | baseline |
| ClickSend | ~$1,459 | -$208 (~13% saving) |
| Cellcast | ~$650 | -$1,017 (~61% saving) |

ClickSend wins on ergonomics + AUD billing. Cellcast wins on margin.
Twilio stays as the proven default.
