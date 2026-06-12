# Feature status — what's real vs placeholder (2026-06-12)

Answers to "check if these are working" across the Organiser/Support
interfaces. Verdicts from a code+endpoint trace; the live UI walkthrough
agrees.

| Feature | Verdict | Notes |
|---|---|---|
| **Analytics** | ✅ REAL | Charts computed from real orders (orders/hr, avg wait, completion %, revenue, popular items, peak times). Read-only. The fake CSAT was already removed. |
| **Users** | ✅ REAL | Add/edit/delete persist to the DB (`/api/users` CRUD). Identity (username/email/role/password) is backend; *skills/availability/notes* are localStorage-only enrichment (per-device, not synced). |
| **Branding Settings** | ✅ REAL (save works) | PUT `/api/settings/branding` persists. ⚠️ **No logo/image upload** — `clientLogo` is a field but there's no file input or storage. |
| **Sponsor** | ⚠️ BACKEND ONLY | The display screen + SMS confirmations DO render a sponsor (`sponsor_name`, `sponsor_message`, `sponsor_display_enabled` in settings). But there's **no UI to set it** — you'd have to edit the DB. → Building a UI this session. |
| **Stations sub-tabs** | ✅/⚠️ MOSTLY REAL | Station Settings, Event Inventory, Event Stock, Station Inventory, Menu Items, Station Defaults all persist and flow to the Barista UI (capabilities filter the menu; defaults pre-fill walk-ins). ⚠️ **"Two inventory stores" gotcha**: a Barista's manual stock edits save to `localStorage` only — the Organiser never sees them and they reset on reload. |
| **Event Phases** | ❌ PLACEHOLDER | "Configure Phases" button has **no onclick handler**; switching phases is React-state-only, no backend, doesn't affect operations. It's a graphic/early-warning view (and is disclaimed as such). |
| **Comms Hub** | ⚠️ STUB | Reads message history, shows templates, but the **broadcast/send is not wired** to a backend endpoint. (Note: `/api/sms/send` exists with rate-limit+audit — broadcast could be wired to it.) |
| **AI Predict** | ❌ PLACEHOLDER | Forecasts use hardcoded multipliers and `Math.random()` confidence; no backend, no learning. Disclaimed as "Preview". |

## What I'm acting on this session
1. ✅ **Fallback popup fix** — removed the 6 blocking "enable sample-data mode?" confirms (the root of fake-orders-shown-as-real).
2. **Sponsor UI** — backend renders it; adding the settings UI so you can set "Coffee sponsored by X" + daily/session sponsor.
3. **Admin SMS alerts** — configurable alert number + severity threshold (error/critical) + rate-limit, built on the structured-logging/client-errors work.

## Recommended follow-ups (not done this session)
- **Logo / display-graphic upload** — needs an upload endpoint + storage (local dir or S3) + a file input in Branding. Medium effort.
- **Event Phases** — either wire "Configure Phases" to persist + drive operations, or relabel it clearly as a read-only timeline. Currently a dead button.
- **Comms Hub broadcast** — wire the send button to `/api/sms/send` (which exists) so operator broadcasts actually go out.
- **Stock sync gotcha** — sync Barista localStorage stock edits back to the backend so the Organiser sees them and they survive reload.
- **AI Predict** — either build a real forecast (needs historical data) or keep clearly labeled as preview.
