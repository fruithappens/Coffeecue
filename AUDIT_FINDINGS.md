# Cross-codebase consistency audit — May 2026

Run `python audit_inconsistencies.py` to regenerate. Full output in
`AUDIT_REPORT.txt`. This file is the human summary + the things
worth fixing.

The audit script lives at `audit_inconsistencies.py` and covers six
classes of drift Steve identified — `_` vs `-`, parallel-naming,
hardcoded vs configurable, dead vs live code.

---

## The big numbers

| Check | Finding |
|------|---------|
| Endpoints | **49 frontend calls hit URLs the backend doesn't expose** (likely 404s). **62 backend routes the frontend never calls** (probably dead). |
| Status strings | `in_progress` AND `in-progress` both in use (6+8 py, 7+10 js). Same for `picked_up`/`picked-up`. |
| localStorage keys | 47 "other" + 28 station-related + 16 order-related — many overlapping. |
| Schema columns | (Heuristic — see notes below.) |
| Parallel files | `ApiService.simplified.js` exists alongside `ApiService.js` |
| Placeholder UI buttons | 8 `onClick={() => console.log(...)}` stubs |

---

## What to actually fix, in priority order

### Tier 1 — actively breaking things

These caused real bugs we've already debugged:

- **`in_progress` vs `in-progress`** is the bug that made started orders vanish (caught yesterday). Pick one — recommend `'in-progress'` because that's what the backend stores — and mass-rename everywhere else. Same for `picked_up` ⇄ `picked-up`.
- **Endpoint 404s.** Some frontend calls (e.g. `GET /api/auth/me`, `GET /api/users`, `POST /api/emergency/*`) hit URLs the backend doesn't have. Each one is either: (a) a real feature that needs the backend built, (b) dead code that should be removed, or (c) a typo. Cataloged in `AUDIT_REPORT.txt`.
- **localStorage key collision for settings.** Already known: `coffee_cue_settings`, `coffee_cue_barista_settings`, `coffee_system_branding` — three stores for overlapping data. Settled this with a mirror+event last session but the underlying mess is still there.

### Tier 2 — confusing but not breaking yet

- **28 station-related localStorage keys**, including templated ones like `coffee_station_name_${stationId}`, `coffee_barista_name_station_${numericStationId}`, etc. There are 4-5 different naming conventions for the same idea.
- **47 "other" localStorage keys.** Many look like debug toggles or one-off caches that could be cleaned up: `coffee_debug_milk_colors`, `JWT_SIGNATURE_ERROR`, `html_etag`, `errorLog`, `migration_completed`, etc. Most are probably dead.
- **`ApiService.simplified.js`** still exists. Either deleted-but-not-removed or a half-finished rewrite. Confirm nothing imports it, then move to `_archive_legacy/`.

### Tier 3 — placeholders to either build or remove

These 8 buttons just `console.log('thing')` when clicked — they look functional but do nothing:

```
EnhancedLiveOperationsDashboard.js:584   Announce
EnhancedLiveOperationsDashboard.js:606   Redistribute
EnhancedLiveOperationsDashboard.js:615   Manual SMS
EnhancedStationCapabilities.js:412       Assign order to station
support-tabs/DashboardTab.js:143         Pause all orders
support-tabs/DashboardTab.js:149         Broadcast message
support-tabs/DashboardTab.js:155         Restart services
support-tabs/DashboardTab.js:161         Emergency stop
```

Decide for each: build the backend, or remove the button. Half-built features are worse than no feature because the operator expects them to work.

---

## Dead backend endpoints (62)

These exist but nothing in the frontend calls them. Categories:

- `/api/customer*`, `/api/customer_management` — customer-facing UI that was never built (the SMS bot is the customer interface).
- `/api/auto-test.js`, `/api/display-helper.js`, `/api/coffee-sounds.js`, `/api/display-scaling.css` — these look like static-asset routes returning JS/CSS strings. Probably legacy.
- `/api/dashboard`, `/api/diagnostics/*` — admin tools that aren't wired up.
- `/api/migration/*` — one-off migration endpoints, probably safe to delete.
- A bunch of `/api/<param>/...` patterns — these are blueprint-prefix mismatches; the audit script's pattern matching mis-attributes them, so verify before deleting.

Recommendation: spend 30 min one day removing the obviously-dead ones. Drops the surface area meaningfully.

---

## What the audit DOESN'T catch (limitations)

- **Schema column check** is heuristic — it finds column references by parsing SQL strings, so it has false positives for SQL keywords and aliases. Disabled the noisy section from the summary; raw output in `AUDIT_REPORT.txt`.
- **Endpoint matching** can't tell the difference between `/api/foo/123` (numeric ID) and `/api/foo/<param>` always — the script normalises both ways, but some legitimate calls show up as "missing" because of escaped quotes or template literals in the path.
- **Hardcoded data** — the audit doesn't (yet) scan for hardcoded test orders, mock stations, or sample milk lists. Worth adding.
- **Behaviour drift** — e.g. "this localStorage key is read in 5 places but only 3 of them treat it consistently" requires deeper static analysis.

---

## How to run

```bash
# Full report (text)
python audit_inconsistencies.py

# Just one section
python audit_inconsistencies.py --section endpoints

# Machine-readable JSON (for piping into other tools)
python audit_inconsistencies.py --json > audit.json
```

Run it after major refactors. The numbers should go DOWN over time —
that's the leading indicator that the codebase is converging rather
than fraying.
