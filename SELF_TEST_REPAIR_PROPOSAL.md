# Self-test + self-repair: turning recent bugs into a regression net

The last ~15 commits have been bug-fixes. Most of them weren't novel
problems — they were the same handful of failure modes hitting
different surfaces. This doc:

1. Pattern-matches the recent bugs
2. Maps each pattern to the test that would have caught it
3. Proposes a small Claude-driven loop that runs the tests, diagnoses
   failures, and either auto-fixes or escalates

## Part 1 — Pattern analysis

Going through the recent fix commits (`87a8747` back to `c4e94b0` —
about 12 commits, ~25 individual bugs):

| Failure mode | Count | Examples |
|---|---|---|
| **FE↔BE field-name mismatch** | 5 | `fullName` vs `full_name` (Add User); `priceFormatted` missing from `/orders` (had it on `/orders/pending`); `inventory:updated` vs `event_inventory_updated`; `event_menu` vs `event_inventory` |
| **Auth decorator inconsistency** | 3 | `support_role_required` used strict `@jwt_required()` rejecting demo tokens (User CRUD + Diagnostics + Emergency); `users_simple_api` same issue |
| **String matching too strict** | 4 | Stock decrement (`oat milk` vs `oat`); Quick Setup canonical name set incomplete; case-sensitive `Set.has` |
| **Optimistic UI race with refetch** | 1 | Start bounce-back (fetch overwrites optimistic state) |
| **Missing / wrong default data** | 4 | Coffee category had drink names (caused Cappuccino Latte); iced drinks defaulted enabled; Quick Setup seed didn't include all canonical names; equipment_notes column had capabilities JSON from old buggy code |
| **UI state lost across remount** | 1 | Quick Setup form ticks reset on tab switch |
| **Undefined access without guard** | 2 | UserManagementTab crashed on backend-loaded users without enrichment; others |
| **CSS / visual math wrong** | 1 | Rotation 90°/180°/270° rendered off-screen |
| **Mute / silent failures** | 3 | Stock decrement fire-and-forget; ErrorBoundary not at top; Twilio webhook bypass-if-token-missing |

## What's striking

- **The same field-name-mismatch family hit 5 times** in 12 commits.
  Frontend reads `X`, backend returns `Y`, request silently 4xx's or
  returns `null`. Visible only when you actually exercise the flow.
- **Tests that booted the stack and clicked a button** would have
  caught most of them. Static analysis can't catch field-name
  mismatch across a Python + JS boundary.
- **A real human running through 8-10 operator scenarios** end-to-end
  would have surfaced ~all of them.

## Part 2 — What test would have caught each

| Failure mode | Best-fit test |
|---|---|
| FE↔BE field-name mismatch | **API contract smoke test**: log in, hit every documented endpoint with realistic params, assert the response JSON contains the keys the frontend reads |
| Auth decorator inconsistency | **Auth-decorator smoke**: log in with demo + real tokens, GET/POST every protected endpoint, assert no 401/403 for either |
| String matching too strict | **Unit fixtures**: real DB rows + realistic order strings → assert matcher returns the right row |
| Optimistic UI race | **Playwright**: click Start, assert order stays in In-Progress for 10s straight |
| Missing/wrong default data | **Default-data invariant**: shared canonical list between InventoryManagement and QuickSetup, asserted equal |
| UI state lost on remount | **Playwright**: tick checkbox → switch tab → switch back → assert tick still set |
| Undefined-access crash | **Top-level ErrorBoundary catches + logs**: any crash → log full traceback → keep app alive (already done in `7e94be7`); plus optional dev-mode strict null check |
| CSS math wrong | **Playwright + screenshot**: open Display with `?rotate=90`, assert nothing visible past viewport edges |
| Silent failures | **Every fire-and-forget write should log success/failure** + tests assert log shape |

## Part 3 — The Claude-driven loop

Realistic shape: a `smoke_test_full.sh` + a tiny Claude harness that
runs on commit / nightly / on-demand. Failure → spawn a repair session.

### Stage 1: just the smoke suite (build now)

A bash script that:

1. **Boots the stack** in `TESTING_MODE=True` (in-memory or test DB)
2. **Logs in as `coffeecue/adminpassword`** and grabs a real signed JWT
3. **Hits every documented API endpoint** with realistic payloads,
   captures (status code, response shape) — compares against an
   expected schema (a simple JSON file with required keys per endpoint)
4. **Drives Playwright** through 8 canonical operator scenarios:
   - Login → Organiser → Quick Setup → apply
   - Login → Organiser → Stations → add station → rename → delete
   - Login → Organiser → Users → add user → edit → delete
   - Login → Barista → walk-in order → start → complete → mark picked-up
   - Login → Barista → click Start, wait 10s, assert order didn't bounce
   - SMS test simulator → place order → confirm → status
   - Display screen → assert renders, with `?rotate=90` assert rotated
   - Login → Organiser → Comms Hub → broadcast SMS preview
5. **Captures failures** to `logs/smoke_<timestamp>.json` with:
   `{step, expected, actual, traceback, screenshot_path}`

Output: a single pass/fail + a list of failed-step JSON blobs.

### Stage 2: the Claude repair loop (next)

A small shell wrapper:

```bash
#!/bin/bash
# smoke_and_repair.sh

./smoke_test_full.sh > /tmp/smoke.log 2>&1
if [ $? -ne 0 ]; then
  # Failures — hand to Claude
  claude --headless --prompt "$(cat <<EOF
Smoke suite failed. Review /tmp/smoke.log, identify root cause,
propose minimal fix, apply it, re-run /smoke_test_full.sh. If
re-run passes, commit on a branch named 'claude/auto-fix-<date>'.
If re-run still fails, write a diagnostic summary to
SELF_TEST_FAILURES.md and stop.
EOF
)"
fi
```

Claude's repair session:

1. Reads `/tmp/smoke.log` — knows exactly which step failed
2. Greps for the relevant code (e.g. failure was in POST `/api/users` →
   look at `routes/users_simple_api.py`)
3. Compares against the expected contract
4. Proposes minimal fix
5. Applies it
6. Re-runs `smoke_test_full.sh`
7. If pass: commits on a branch + opens PR with body containing the
   failure → fix mapping
8. If fail: writes `SELF_TEST_FAILURES.md` and tags it `needs-human`

### Stop conditions (so it doesn't go off the rails)

- Max 3 retry attempts per failure
- Never modifies migrations, auth.py signature logic, or schema
  without `needs-human` tag
- Always commits to a BRANCH, never main
- Always opens a PR — a human merges
- If multiple unrelated failures, treat each independently rather
  than trying to fix in one pass

### What this catches vs. what it doesn't

Catches well:
- API contract drift (#1 + #3 + #8 above)
- Auth decorator drift (#2)
- Crashes from null deref (#7)
- Optimistic UI race (#4 — Playwright assertion catches the bounce)
- Mock-data leakage (smoke test failing because Health tab returns
  hardcoded `$123.45` when expected `null`)

Doesn't catch (still needs humans):
- New features the operator asks for
- Aesthetic / UX judgement calls
- Multi-step product logic bugs ("the FRIEND flow's combined total
  should sum prices")
- Schema migration safety

## Concrete next steps

1. **Today** (~30 min): write `smoke_test_full.sh` — the API portion
   first (lighter, faster, no browser). Cover the 8 most-used
   endpoints. Adds a failing-test net for the FE↔BE mismatch class
   of bug immediately.

2. **This week** (~2 hours): wire Playwright for the 8 operator
   scenarios above. That covers the visual + race-condition classes.

3. **Once smoke suite is real**: write the small Claude wrapper. The
   SDK side is ~30 lines; the value is in the smoke suite, not the
   wrapper.

4. **Nice-to-have later**: convert the recurring `assertResponseHas
   Keys()` calls into a shared `api_contracts.json` that's checked at
   both the smoke-test boundary AND in the frontend TS types (if/when
   we add TS). That'd statically catch field-name mismatch at
   compile time rather than at test time.

## Honest assessment

A Claude-driven auto-repair loop is genuinely useful for the
**field-name-mismatch / decorator-inconsistency / null-deref** family
because the diagnosis is mechanical: "you used X but expected Y, fix
in file Z line W." Claude is very good at that kind of point-edit.

It's less useful for the **race-condition / wrong-default-data /
visual-math** family because the root cause requires reasoning about
behaviour, not text. Claude can attempt but will sometimes make
things worse. The `needs-human` escape hatch matters.

The right first investment is the smoke suite itself. Even without
the auto-repair loop, just running it on every commit catches 80%
of recent bug class. The auto-repair loop multiplies that by reducing
your manual triage time, but it's the cherry on top.

If you want me to start, I'd open with step 1 (the API smoke
script) — it's the highest ratio of bug-catching-per-hour-invested
of anything on this list.
