# SMS interaction audit — May 2026

Steve asked for an honest read on the SMS UX. This is the audit.

The state machine lives in `services/coffee_system.py:handle_sms` (top of
the dispatcher) → routes by `state.state` to `_handle_awaiting_*`
helpers. Welcome / commands / menu / status / cancel all branch off
the top before state-machine dispatch.

---

## What's working well

### Customer recognition
- **Names persist by phone number.** `customer_preferences.name` is upserted on every order via `_save_customer_preferences()`. Texting from the same number = "Welcome back, Steve!" no need to re-introduce.
- **Returning-customer welcome works at any conversation state** — `_is_greeting_or_help` catches "hi/hello/hey/?" and redirects through `_handle_greeting` which loads the saved name and offers their usual.
- **CHANGENAME [name]** lets the customer update their saved name without re-ordering.

### Usual order recall
- `customer_preferences.preferred_drink / preferred_milk / preferred_size / preferred_sugar` persist the last completed order.
- On greeting: bot says **"Would you like your usual {size} {coffee} with {milk}? Reply YES or tell me what you'd like."** — clean two-option prompt rather than starting from zero.
- **USUAL** command triggers the same flow mid-conversation.
- Time-of-day suggestion message exists ("which you often enjoy around this time?") but the underlying logic isn't actually time-aware — it offers the same usual regardless of hour. Suggestion text is mildly misleading.

### Menu command
- `MENU` returns a live snapshot of current inventory, split into 🍵 Tea, ☕ Coffee, 🥛 Milk, 🍯 Sweetener, 📏 Size sections.
- Special note when a milk is only at one station: "💡 Note: oat only at certain stations — we'll route your order automatically."
- Always ends with "Reply with your order, e.g. 'large oat latte 1 sugar'" so first-time customers see an example.

### Rejection responses
- When a customer asks for something off-menu (e.g. "earl grey" when not stocked), the bot says "Sorry, we don't have earl grey tea today. Available: Coffee: ..., Tea: ...".
- Also includes "Reply MENU for the full list" so customers can re-discover options without a dead-end.

### Status / Cancel / Friend
- `STATUS` returns current order + wait time + station.
- `CANCEL` cancels a pending order.
- `FRIEND` initiates the group/friend order flow — full state machine for adding additional drinks to one order.

### Operator-side
- `INFO` and `OPTIONS` (correctly avoiding `HELP` since Twilio reserves it for STOP/HELP opt-outs).
- Privacy commands: `MYDATA`, `RESET`, `DELETE` for GDPR-style customer self-service.
- VIP code redemption via `_handle_vip_code`.

### "Never silently default" rule
- `parse_order(apply_defaults=False)` — the bot does NOT fill in milk/size/sugar from defaults. If the customer says only "latte", the bot asks "what size?", "what milk?", "how much sugar?" one at a time with a read-back of what it heard.
- This was the original Issue #1 complaint — it's now genuinely fixed.

### Vocabulary (just expanded)
- Bot recognises tea flavours (Earl Grey, English Breakfast, Green, Peppermint, Chamomile, Rooibos, Lemon & Ginger, Chai), alt-drink (matcha, chai latte, golden latte, hot chocolate), iced drinks, babyccino, fresh juice, smoothie.
- Longest-match-first parsing so "matcha latte" beats "latte" and "earl grey tea" beats "tea".

---

## What's broken or weak

### Tier 1 — affects every customer

**1. No "your order is ready for pickup" SMS when barista taps Complete.**
The new `/api/orders/<id>/complete` endpoint (the path the Barista UI uses) updates status but **doesn't send the customer an SMS**. The legacy `PUT /status` route DOES send it (`routes/order_status_api.py:165`), but nothing in the UI calls that anymore. So today, a customer's only signal their drink is ready is the customer Display screen — they have to be watching it. If they wandered off, they miss it.

**Why it bites:** the whole point of the SMS bot is to free people from queueing. Without a ready-notification, customers either hover at the bar (defeating the point) or take their chances. This is the highest-impact gap.

**Fix scope:** small — copy the message-send logic from `routes/order_status_api.py:165` into the `/complete` endpoint. ~15 lines.

**2. The "Hi {name}! What are the details..." prompt advertises defaults that aren't applied.**
Line 1032: `"Default: medium, full cream, no sugar"` — but the actual code uses `apply_defaults=False` and asks for each missing field. So a customer who reads the prompt and types "latte" expects to get a medium full-cream latte with no sugar; instead, the bot asks "what size?" — confusing. The prompt is from the pre-fix era.

**Fix scope:** trivial — change the message.

### Tier 2 — recognition gaps

**3. Time-of-day usual suggestion lies.**
Message says "which you often enjoy around this time" but the underlying logic doesn't actually look at the time of day. Mildly dishonest — customers may notice.

**Fix scope:** either implement time-of-day filtering (~30 min — query historical orders by hour-of-day), or change the message to drop the time claim.

**4. Sugar amount in saved usual is stored as the original phrase.**
`preferred_sugar` saves whatever string the customer used ("1 sugar", "two", "no sugar"). When the bot reads it back as "your usual latte with oat, 2 sugar" — that's fine. But it's never normalised, so a customer who texted "one sugar" then ordered again gets "Would you like your usual ... one sugar?" — slightly stilted.

**Fix scope:** small — normalise on save via `_sugar_sachets_from_text`.

**5. "Strength" / "shots" is not captured in usual.**
`preferred_*` columns don't include shots. If a regular always orders a double-shot, they have to specify again every time.

**Fix scope:** medium — add `preferred_shots` column (via the new migrations runner — easy now), update save/read.

**6. No mid-order EDIT support.**
The confirmation message says "EDIT to change something" but the actual EDIT handler is partial — it routes back to "awaiting_coffee_type" wiping the whole context. So saying EDIT effectively cancels and restarts; you can't say EDIT MILK / EDIT SIZE / EDIT SUGAR.

**Fix scope:** medium — a small parser for "edit milk to oat" / "change size to large" type messages.

**7. No "decaf" stamping on saved usual.**
A customer who always orders decaf flat white is stored as just "flat white". Next visit, the suggestion drops the decaf.

**Fix scope:** small — extract decaf as a flag during parse.

### Tier 3 — edge cases & polish

**8. Restart on completed order is silent.**
After completing an order, the next message restarts the conversation without acknowledging "OK, new order coming up." Customers occasionally double-text the same drink thinking the first didn't go through. A "Got it, what's next?" interstitial would help.

**9. Order summary read-back is inconsistent.**
Sometimes the confirmation says "Just to confirm — large oat latte 1 sugar." Other times "Here's your order: latte, oat, medium, 1 sugar." Slightly different phrasings from different code paths. Minor but jarring across multiple orders.

**10. No "ready for pickup" reminder.**
If a customer doesn't collect within a configurable time (`reminderDelay` setting exists), no follow-up SMS goes out. The Barista UI has a "Send Reminder" button per order, but it's manual. Auto-reminder would close the loop on no-shows.

**11. Welcome message hardcodes "Coffee Cue".**
The fallback welcome message bypasses branding settings if `sms_welcome_message` isn't explicitly saved. Should fall through to `branding_settings.event_name` instead of literal "Coffee Cue".

**12. Phone number formatting.**
The bot is permissive about phone format (good — Twilio normalises). But the saved phone might have inconsistent format vs. the customer's later message format. Worth a sanity check across the persistence path.

**13. Names with apostrophes / accents.**
Name validation `if len(name) < 2 or len(name) > 50` doesn't strip whitespace or filter weird characters. A customer texting "O'Brien" gets through fine; "Andre 👍" gets saved with the emoji. Minor.

**14. Multi-message order doesn't time out.**
If a customer starts an order ("latte"), the bot asks for milk, and the customer never replies — the state lingers indefinitely. Their next message hours later still goes into `_handle_awaiting_milk` thinking they're answering. Should time out after N minutes (15-30) and reset.

**15. FRIEND ordering is full-featured but undocumented.**
The `_handle_awaiting_friend_*` chain is full of state machine work. Customers wouldn't know it exists unless they read OPTIONS. The MENU command could mention it.

---

## Concrete recommendations, in priority order

These are listed by impact-per-effort. The top 3 close real customer-facing gaps; the rest are polish.

| # | Fix | Effort | Why |
|---|-----|--------|-----|
| 1 | Send "your X is ready for pickup at Station N" SMS from `/complete` endpoint | 15 min | Biggest customer-experience gap right now |
| 2 | Drop the misleading "Default: medium, full cream, no sugar" line from the prompt | 2 min | Lies about behavior |
| 3 | Add stale-conversation timeout (15-30 min) — reset state if no reply | 30 min | Stops customers getting stuck mid-flow next day |
| 4 | Capture `preferred_shots` (decaf flag too) on saved usual | 45 min | Returning customers get their full usual |
| 5 | Real time-of-day-aware usual suggestion, OR drop the misleading wording | 30 min / 1 min | Either deliver on the promise or stop making it |
| 6 | Auto-reminder SMS after N min of "completed but not picked up" | 1 hour | Closes the no-show loop |
| 7 | Real EDIT support (edit milk / size / sugar without restarting) | 1 hour | Operator-flagged friction |
| 8 | Welcome message respects branding event_name | 5 min | Consistency with rest of system |

Want me to do #1, #2, #3 right now? They're together about an hour of work and they're the biggest customer-facing wins.

---

## Things I deliberately didn't audit (out of scope for this pass)

- The `services/nlp.py` regex coverage for typos/misspellings (already pretty broad)
- The friend/group order flow's UX (works, just undocumented)
- Spam / abuse protection (rate limiter exists but disabled in dev)
- Multi-language support (the codebase has translation infrastructure but isn't wired into the SMS flow)
- Customer privacy (MYDATA / DELETE work; not deeply audited for GDPR compliance edge cases)
