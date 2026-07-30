# Real-SMS ritual — the event-morning (and pre-event) live check

The bench sends **zero** real SMS by design, so carrier-side quirks
(duplicate sends, sender-ID display, delivery lag) only ever show on a
real phone. This is the short script for checking that rail with a real
handset — budget ≈ **5 outbound SMS**, well under the 10-message cap.

**Phone**: Steve's (+61 412 693 279) → text **0489 263 333**.
**When**: event morning; also fine any time as a dress rehearsal.
**Before starting**: tell Claude the run is starting — the message log
is captured live from the API and reviewed as you go (who said what,
timestamps, segment counts, anything anomalous).

## The script (in order)

| # | You send | Expect back (1 SMS each) | What it proves |
|---|---|---|---|
| 1 | `medium latte` | Either "Welcome back Steve! …" with your usual, or the confirm with **full cream** recapped and an order number | Parse + milk default + queue position + prefix numbering |
| 2 | `status` | Position in queue / being made | STATUS with an active order (the old crash class) |
| 3 | *(barista screen: tap COMPLETE on your order)* | "Your coffee is ready — collect from Station N" | The ready rail end-to-end incl. station name + template |
| 4 | *(walk to the display board)* | — | Your name on the READY board, correct station |
| 5 | `menu` | The menu list | MENU keyword + inventory-driven menu accuracy |

Optional (+2 SMS): text `im 15 mins away` after step 5 → expect a
scheduled-order reply with a time; then `cancel` → confirmation. Proves
the ETA lane on a real phone.

## What Claude checks in the capture
- Every outbound rendered from the right template, single-segment
  (plain ASCII — no accidental emoji/em-dash doubling the cost).
- No duplicate sends (the original real-phone bug class).
- Timestamps: reply within seconds; carrier lag visible if any.
- The order's full lifecycle in the DB matches what your phone saw.

## Cost note
5 messages ≈ $0.20–0.40 depending on rate. The budget cap (10) is a
standing rule — if a retry is needed, the whole ritual still fits.
