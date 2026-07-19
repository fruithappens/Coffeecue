# Coffee Cue — Known Weak Points & Proposed Fixes

Tabled 2026-07-20 at Steve's request: the honest list of what's weakest,
why it matters, and the fix I'd propose — ranked by how much it matters
for the upcoming **400-person event**. Nothing here is currently broken
for events at the scale run so far; these are the places where margin is
thinnest or behaviour is quietly less than it appears.

Evidence base: the full test campaign (26 bench suites, 23 UI tests,
14 bugs found+fixed) + the 2026-07-20 load test (two runs, 720 requests,
0 errors: 48 orders in ~11s ≈ 100× the event's realistic peak; read p95
1.5s under 20 pollers; SMS turn p95 ~2.8s under 12-way burst).

## Tier 1 — do before the 400-person event

| # | Weak point | Why it matters at 400 pax | Proposed fix | Effort |
|---|---|---|---|---|
| 1 | **Security not yet swept** — role gates unverified; Twilio creds were once committed; webhook signature validation missing | A public event is when someone pokes at it | Run the parked security sweep (role-gate suite + creds rotation + Twilio signature check) | ~half day incl. fixes |
| 2 | **Single Railway instance, no monitoring** — if the dyno dies mid-rush, everything stops and nobody is alerted | 400 people notice a 5-minute outage | Add a dead-simple uptime ping (UptimeRobot-class, free) on /api/display/config + Railway restart-on-failure is already on; agree a "display down" paper fallback with baristas | 1 hour |
| 3 | **Real-SMS smoke untested per-event** — the bench is zero-real-SMS by design; carrier quirks only show on real phones | The duplicate-SMS bug came from a real phone | Event-morning ritual: the group test tool (`run_group_test.sh`) with 3-5 real phones + review its report; budget ~10 SMS | 15 min on the day |

## Tier 2 — worth doing soon (functional gaps found by testing)

| # | Weak point | Truth today | Proposed fix | Effort |
|---|---|---|---|---|
| 4 | **SMS templates are decorative** | The Comms screen edits templates no message builder reads; wording is hardcoded | Either wire confirm/started/ready to templates (with GSM-7 length guard so costs don't double) or remove the editor to stop the illusion | small-medium |
| 5 | **Roster names silently dropped** | POST shift accepts barista_name and discards it; names only stick via notes | One-column fix (add/persist barista_name) + UI shows it; then the Schedule tab becomes genuinely useful | small |
| 6 | **Inventory status vocabulary split** | Stored `low_stock/in_stock` vs computed `good/warning/danger` depending on endpoint | Pick the computed family as canon, delete the stored writes, one serializer | small |
| 7 | **Some organiser config is browser-only** | A few settings (parts of station inventory config, walk-in defaults) live in localStorage — a different laptop shows different config | Continue the KV-backend migration pattern already used elsewhere | medium |

## Tier 3 — scale ceilings (fine at 400, real at multi-thousand or multi-instance)

| # | Weak point | Why it's fine now | When it bites | Proposed fix |
|---|---|---|---|---|
| 8 | **In-memory protections** — SMS burst throttle, conversation-state cache, heal flags live in process memory | Single instance = one memory | The moment Railway runs 2+ replicas, the throttle halves and conversations can split-brain | Move throttle + conversation cache to Postgres/Redis (conversation_states table already exists — make it the source of truth) |
| 9 | **WebSocket fan-out** — Socket.IO in-process | One instance handles event-size traffic easily (load test: reads fine) | Multi-instance | Redis adapter (documented in CLAUDE.md already) |
| 10 | **DB connection pool** — heavy parallel testing once exhausted it | Load test at 20 concurrent readers: 0 errors | Sustained hundreds of concurrent clients | Pool size + pgbouncer if ever needed |
| 11 | **Boards query full tables** — pending/display scans grow with event size | LIMIT 10 on display; day-scale volumes are trivial for Postgres | Multi-day mega-events without wipes | The event-data wipe between events (already built) is the practical answer |

## Standing design notes (documented in every bench report)
- Barista shifts are informational — routing respects station status +
  breaks only ("roster gates routing" would be a new feature).
- Empty-stock refusal auto-skips while unlimited-stock mode is ON (it is,
  for the current event preset).

## Tools added for the 400-pax runway (2026-07-20)
- `bash testbench/run_group_test.sh start|report` — live group SMS test
  capture: per-participant conversation replay + outcomes + auto-flagged
  anomalies (no reply, error-ish replies, confirmed-but-no-order).
- `bash testbench/run_load_test.sh` — the load test above; run it any
  evening before the event for a fresh PASS.
