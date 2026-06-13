# Chaos scenarios — Phase 6 findings (2026-06-13)

`python tests/chaos/run_chaos.py` against local (TESTING_MODE=true, zero real
SMS). **4/4 invariants held — no new bugs.** Each scenario is self-cleaning.

| Scenario | Invariant | Result |
|---|---|---|
| **double_claim_race** | 6 baristas tap "Start" on the same pending order at once → no 5xx, order ends in-progress once, side-effects fire once | ✅ Exactly **1 of 6** processed as a fresh start; the other 5 saw in-progress and no-op'd. The `/start` state guard holds under real concurrency — no double "being made" SMS. |
| **disable_drink_midflight** | Disable a drink in the Organiser while an order for it is pending → the in-flight order survives AND new orders for it are refused | ✅ Pending order kept (status `pending`); new SMS order for the drink refused. Config changes don't corrupt in-flight work. |
| **bad_jwt_is_clean_401** | Garbage/expired token on a protected endpoint → 401/422, never a 500 | ✅ 401. |
| **reassign_no_crash** | Reassign an order to a station that can't make it → clean rejection, not a crash | ✅ 400 (rejected cleanly). |

## Not yet scripted (need real infra/UI, deferred)
- Offline → reconnect queue replay (needs a real browser going offline mid-order)
- JWT *expiry mid-shift* with auto-refresh (covered partially by bad_jwt; full
  flow needs a short-lived token minted server-side)
- Event end-time passing with orders in flight (needs event-end config wired —
  see Phase 3 task #45, event lifecycle endpoints don't exist yet)
- Quick Setup re-run mid-event drift (the dry-run preview covers the safe case;
  the destructive re-apply path is worth a dedicated test later)
