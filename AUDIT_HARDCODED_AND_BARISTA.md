# Audit: hardcoded data + Barista tab power (2026-06-12)

Two audits driven this session: (1) a frontend sweep for hardcoded /
fabricated data shown as real, (2) a Barista-interface tab audit for
placeholders, duplication, and over-broad power. Status column tracks
what's fixed vs flagged.

---

## A. Barista tabs — "too much power" (Steve's observation, confirmed)

The Barista interface had **11 tabs**; several are event-configuration
concerns a floor barista shouldn't touch. Worst: **Capabilities** lets a
barista change what drinks/milks a station serves, which drives **SMS
order routing** — one mistake silently misroutes every matching order.

| Tab | Verdict | Status |
|---|---|---|
| Orders | core barista | keep |
| Stock | barista needs it (deplete) | keep — flag: hide delete (deplete-only) |
| Inventory AI | read-only analytics | keep |
| Schedule | read-only view | keep |
| Completed | order history | keep |
| Display | organiser config | **role-gated → manager-only ✅** |
| Queue AI | order-routing rules (HIGH) | **role-gated → manager-only ✅** |
| Balance | load-balancing rules (HIGH) | **role-gated → manager-only ✅** |
| Capabilities | drives SMS routing (CRITICAL) | **role-gated → manager-only ✅** |
| Staff | perf metrics / allocation | **role-gated → manager-only ✅** |
| Settings | system settings | **role-gated → manager-only ✅** |

**Fix applied:** `BaristaInterface.js` now hides Display, Queue AI,
Balance, Capabilities, Staff, Settings from a plain `barista` role
(shown only to admin/staff/organiser, who also use this route). A
barista with a stale active-tab pointing at a hidden tab is bounced to
Orders. Plain baristas now see a focused floor interface: Orders, Stock,
Inventory AI, Schedule, Completed.

**Follow-up (not done):** Stock should be deplete-only for baristas
(hide delete); Settings should split personal (name/UI) from system.

---

## B. Hardcoded / fabricated data shown as real

### Fixed this session ✅
| What | File:line | Fix |
|---|---|---|
| (see commit) | | |

### Highest priority — fabricated metrics (embarrassing in a demo)
| What user sees | File:line | Should come from |
|---|---|---|
| "94% Satisfaction" | EnhancedLiveOperationsDashboard.js:87 | feedback system (doesn't exist) |
| "4.5" satisfaction | support-tabs/DashboardTab.js:94 | feedback system |
| "4.8 Satisfaction (Based on feedback)" | EnhancedCommunicationHub.js:642 | feedback system |
| "Uptime: 99.8%" | support-tabs/DashboardTab.js:93 | real uptime calc |
| "Avg Response 1.8s (Within SLA)" | EnhancedCommunicationHub.js:636 | message latency tracking |
| "+12%" trend (orders) | EnhancedLiveOperationsDashboard.js:392 | prev-period comparison |
| "+12% vs yesterday" (messages) | EnhancedCommunicationHub.js:623 | prev-day count |
| "+8%" revenue trend | support-tabs/DashboardTab.js:178 | prev-day revenue |
| Recent Alerts (3 fake) | support-tabs/DashboardTab.js:97-101 | real alerts feed |

Principle: a metric with no real source should show "—" / "not yet
measured", not an invented number. Satisfaction/uptime need real data
pipelines (feature work) before they can show a real value.

### Fake roster / sample data
| What | File:line |
|---|---|
| Fake staff (John Davis 4.8★, Sarah Martinez…) + certifications | StaffManagementPanel.js:17-90 |
| Demo barista names (Alex Johnson, Julia…) | DemoDataService.js:27-36,219 |
| Sample announcements / "Station 2 Closure" | EnhancedCommunicationHub.js:207-210 |

### Real data-loss bug
| What | File:line | Impact |
|---|---|---|
| Station init hardcoded to `['1','2','3']` | StationInventoryConfig.js:173 | events with 4+ stations silently get no inventory config for #4+ |

### Hardcoded option lists (should read catalog/inventory)
| What | File:line |
|---|---|
| Milk types in prediction model | MultiLevelInventory.js:122 |
| Coffee types in prediction model | MultiLevelInventory.js:123 |
| Consumption-rate / event-duration assumptions | MultiLevelInventory.js:131,159,160 |
| Default coffee menu | MenuManagement.js:18-150 |

### Acceptable (fallbacks / demo-scoped) — leave
- `DEFAULT_MILK_TYPES` fallback in StationDefaults (only when catalog
  unreachable), DemoDataService lists (demo-mode only).

---

## Recommended remediation order

1. **DONE** — Barista tab role-gating (security + focus).
2. **DONE/this commit** — neutralize the demo-facing fabricated metrics
   on the Support Dashboard + Live Ops (show real or "—", not invented).
3. **Quick** — fix StationInventoryConfig 1-3 limit (dynamic stations).
4. **Feature work** — real feedback collection → real CSAT; real uptime;
   real staff roster from `/api/users`; real trend comparisons. These
   need backend data before the cards can be truthful.
5. **Cleanup** — prediction model reads catalog; demo names genericised.

---

## C. Auth robustness bug found during this session (🔴 worth a dedicated fix)

Mid-session, login started returning 401 for valid credentials while the
backend was otherwise healthy (orders/branding worked). Diagnosis:

- The token-refresh endpoint (`routes/auth_routes.py:113`) errored with
  `near "%": syntax error` — a **SQLite** error (Postgres accepts `%s`).
- That means `get_db_connection()` in the auth path had fallen back to
  SQLite (`coffee_orders.db`) while the rest of the app (`coffee_system.db`)
  was still on Postgres — a **split-brain**: auth reads a stale SQLite
  user table (old/missing password) so login fails, while orders write
  to Postgres.
- Likely trigger: connection-pool exhaustion under the session's heavy
  load (load tests + many requests) → silent SQLite fallback in
  `utils/database.py:get_db_connection`. A poisoned/aborted pooled
  connection (the refresh SQL error not rolled back) compounds it.
- A backend restart cleared it (login → 200, 30/30 smoke green).

**Why it matters at an event:** under real load, auth could silently
degrade to a stale SQLite copy — baristas/organisers get logged out and
can't log back in, while orders appear to keep flowing. Recommended:
(1) make `get_db_connection()` NOT silently fall back to SQLite when
`DATABASE_URL` is set (fail loud, like the production guard already does
for missing psycopg2); (2) ensure every auth query rolls back its
connection on error before returning it to the pool; (3) fix the
refresh-endpoint error handling so one bad refresh can't poison a pooled
connection. Also: one user's `password_hash` was found in a bare-hex
format that none of `verify_login`'s three branches handle — re-hash via
the normal admin-reset path.
