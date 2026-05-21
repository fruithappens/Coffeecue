# Smoke test

Cheap, fast contract test that catches the bug family we keep
shipping: the frontend reads field `X`, the backend returns field `Y`,
nobody notices until an operator clicks the button in production.

See `../../SELF_TEST_REPAIR_PROPOSAL.md` for the bigger picture.

## What it does

1. Logs in as `coffeecue/adminpassword` against the running backend.
2. Hits every endpoint listed in `api_contracts.json`.
3. Asserts each response has the keys the frontend reads.
4. Writes a structured failure report to `logs/smoke_<ts>.json`.

## Run it

```bash
# Start the stack first.
./start_expresso.sh

# Then in another tab:
./tests/smoke/smoke_test_full.sh
```

Or point at a different host (Railway, etc.):
```bash
BASE_URL=https://expresso-production.up.railway.app ./tests/smoke/smoke_test_full.sh
```

## Adding a check

Drop a new object into `api_contracts.json` → `checks`. No Python change
needed. Example:

```json
{
  "name": "GET /api/sms/templates",
  "method": "GET",
  "path": "/api/sms/templates",
  "expect_status": 200,
  "expect_keys": ["status", "data"]
}
```

For per-item checks (e.g. each order in a list must have certain keys):

```json
{
  "name": "GET /api/orders",
  "method": "GET",
  "path": "/api/orders?status=pending",
  "expect_status": 200,
  "expect_keys": ["data"],
  "expect_item_keys_at": "data[*]",
  "expect_item_keys": ["id", "orderNumber", "customerName"]
}
```

`expect_item_keys_at` supports dotted paths and `[*]` for list
iteration: `data[*]`, `a.b[*]`, `result.items[*]`, etc.

## Exit codes

- `0` — all checks passed
- `1` — at least one check failed
- `2` — bootstrap failed (server unreachable, login failed, bad
  contracts file). Don't trigger the auto-repair loop on `2` — it's an
  environment problem, not a code regression.

## Why not pytest?

Could be a pytest, but a flat JSON contract file is friendlier when
the goal is "anyone can add a check by editing data, not code." The
runner is ~250 lines and has no test framework dependency beyond
`requests`.
