# Australian SMS providers — Twilio alternatives for Coffee Cue

**Use case:** Transactional two-way SMS (inbound NLP-parsed orders, outbound confirmations / pickup), 50–2,000 SMS per event, 10–30 events/month (~5k–60k SMS/mo peak).

Compiled 2026-06-12 — verify pricing on signup, especially Telstra (their dev pricing pages currently return empty, so the figure here may be stale).

---

## 1. Providers & ownership

| Provider | Ownership | Notes |
|---|---|---|
| **Sinch MessageMedia** | Swedish (Sinch AB) — Melbourne HQ retained after the 2021 US$1.3B acquisition | Largest AU presence |
| **ClickSend** | Australian-owned (Perth) | Some review sites call them international; HQ is Australian |
| **SMSGlobal** | Australian-owned (Melbourne) | Global coverage, AU-headquartered |
| **Cellcast** | Australian-owned (Melbourne, ASX-listed) | Pitched as the "cheapest" AU gateway |
| **Burst SMS / Kudosity** | Australian-owned (Sydney, founded 2008, rebranded to Kudosity 2024) | `burstsms.com.au` now redirects to `kudosity.com` |
| **Sinch (direct)** | Swedish | Enterprise tier above MessageMedia; same pricing model |
| **Telstra Messaging API** | Australian (Telstra) | Premium, direct on-net delivery |

---

## 2. Pricing (AUD unless noted)

| Provider | Outbound /SMS | Inbound | Dedicated number | Min/subscription |
|---|---|---|---|---|
| **Cellcast** | 4.7¢ → 2.8¢ tiered (10–100k credits) | Free (shared or dedicated) | ~$18/mo per smscomparison | None — pure PAYG |
| **ClickSend** | 7.2¢ <5k → 5.7¢ at 150k+ | **Free** | $19/mo (cited by smscomparison) | None — pure PAYG |
| **Kudosity (Burst SMS)** | 7.9¢ PAYG → 4.9¢ Scale → custom Enterprise | Not publicly disclosed | Not publicly disclosed | None on PAYG |
| **Sinch MessageMedia** | 7.9¢ Basics → 5.9¢ Advanced | Included | 1 free Sender ID/number included | **$45–$789/mo subscription required** |
| **SMSGlobal** | 3.8¢ → 1.6¢ in-plan (Build → Scale) | Not disclosed | "Access included" — cost opaque | **$39–$179/mo subscription**; PAYG available but rate not public |
| **Telstra Messaging API** | ~$253/mo for 3k msgs (≈8.4¢/SMS) | Not clearly disclosed | Bundled | **Plans $253/$385/$748/mo**, no published PAYG |
| **Twilio (current)** | **USD 5.15¢** (~AUD 8c) | USD 0.75¢ (~AUD 1.1c) | USD $8.25/mo (~AUD $12.50) | None |

### Per-event viability

ClickSend, Cellcast, Kudosity PAYG, and SMSGlobal PAYG all match Steve's per-event billing model — no monthly commitment, credits don't expire.

**MessageMedia and Telstra are unsuitable** for low/variable volume — their subscription floor ($45–$253/mo) wastes money in slow months. SMSGlobal's PAYG is theoretical (rates not public on the page).

---

## 3. Feature parity with Twilio

| Feature | ClickSend | Cellcast | Kudosity | MessageMedia | SMSGlobal | Telstra |
|---|---|---|---|---|---|---|
| Two-way SMS + webhook | Yes | Yes | Yes | Yes | Yes | Yes |
| Dedicated long-code | Yes ($19/mo) | Yes (paid) | Yes | Included | Yes | Included |
| Webhook signature validation | HMAC-SHA via headers | Basic auth; HMAC not documented | HMAC supported | HMAC + public/private key signing | HMAC available | OAuth2; signing not standard |
| Python SDK | Official `clicksend-client` on PyPI | REST only (no official Python SDK) | REST + community libs | Official `messagemedia-messages-sdk` | Official `smsglobal` PyPI pkg | `telstra.messaging` on PyPI |
| Status callbacks | Yes (delivery_report URL) | Yes | Yes | Yes | Yes | Yes |
| Throughput | 1 msg/s default, lift on request | Up to 100 msg/s | Up to 60 msg/s | 100+ msg/s | 100 msg/s | Bulk-rated |

All seven meet the functional bar. **ClickSend and MessageMedia have the most Twilio-like developer ergonomics** (Python SDK + signed webhooks).

---

## 4. Migration effort from Twilio

Coffee Cue's Twilio surface area (per `twilio.rest.Client` + `TwilioRequestValidator` usage):

- **Outbound send** — 1 function (`messages.create`) → replace with provider SDK call. ~20 lines.
- **Inbound webhook** — Flask route parses Twilio's `From`/`Body`/`MessageSid` form-encoded POST → adapt to provider's JSON/form schema. ~30–50 lines.
- **Signature validation** — swap `TwilioRequestValidator` for provider's HMAC verifier. ~10 lines.
- **Status callbacks** — Twilio's `MessageStatus` enum → map provider statuses. ~15 lines.

### Effort estimates
- **ClickSend** — ~1 day. Official Python SDK, similar payload shapes. Smallest delta.
- **MessageMedia** — ~1–2 days. Official SDK is solid; webhook signing is more involved (public/private key pair).
- **Cellcast** — ~2–3 days. No official Python SDK — hand-roll requests + custom webhook handler.

**Recommended:** introduce an `SMSProvider` interface (`send()`, `verify_webhook()`, `parse_inbound()`) so future swaps are 1-file changes. The current code already has all the Twilio calls in `services/messaging.py` + `routes/sms_routes.py` — the abstraction surface is small.

---

## 5. Recommendation

### Primary: **ClickSend**

Best fit for per-event billing — pure PAYG, no subscription, **free inbound**, Australian-owned, official Python SDK, transparent published pricing. At Steve's volume (~20k SMS/month worst case): 7¢ outbound + free inbound + $19/mo number ≈ **$1,420/month** vs Twilio at ~$1,650 AUD — modest savings plus simpler per-event invoicing.

### Secondary / cheapest: **Cellcast**

If margin matters more than SDK polish, Cellcast at 3.1¢ outbound (5k tier) cuts costs to **~$650/month** for the same volume — less than half of Twilio. Trade-off: no official Python SDK, less battle-tested webhook signing. Good choice for white-label resellers chasing per-event margin.

### Avoid for this use case
- **MessageMedia** — subscription floor wastes money on quiet months.
- **Telstra** — enterprise pricing, opaque, no clear PAYG.
- **SMSGlobal** — PAYG rates not public; can't quote clients confidently.

---

## Caveats

- ClickSend's public AU pricing page rendered as "0¢" placeholders during the research fetch. The 7.2¢ figure comes from third-party reviews (smscomparison, textbolt) and ClickSend's own historical pricing — verify on signup.
- Telstra's $253/month figure is from a smscomparison citation of a Telstra PDF; `dev.telstra.com` pricing pages currently return empty, so this number may be stale. Get a quote before committing.

## Sources

- [ClickSend AU pricing](https://www.clicksend.com/au/pricing/au/) · [ClickSend review (smscomparison)](https://www.smscomparison.com.au/reviews/clicksend-review/)
- [Cellcast pricing](https://www.cellcast.com/au/pricing)
- [Sinch MessageMedia AU pricing](https://messagemedia.com/au/pricing/) · [MessageMedia Python SDK](https://github.com/messagemedia/messages-python-sdk)
- [SMSGlobal pricing](https://www.smsglobal.com/pricing/)
- [Kudosity (Burst SMS) pricing](https://kudosity.com/pricing)
- [Telstra Messaging API](https://dev.telstra.com/docs/messaging-api)
- [Twilio AU SMS pricing](https://www.twilio.com/en-us/sms/pricing/au)
- [AU SMS gateway comparison](https://www.smscomparison.com.au/sms-gateway/)
- [Sinch acquisition of MessageMedia (Startup Daily)](https://www.startupdaily.net/topic/asx/sms-marketing-tech-venture-messagemedia-sells-to-swedish-rival-for-1-7-billion/)
