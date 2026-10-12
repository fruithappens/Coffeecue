# What answers without a login (probe, 12 Oct 2026)

Roadmap X7-4. Every `/api` route (393 routes, 427 method/route pairs) was
called with **no login**, on a local copy with texts forced off, and
everything that answered was checked for phone numbers, emails, names and
secrets. Re-run: `scripts/probe_public_endpoints.py` (local or test server
only; it sends write requests).

**Result after the fixes below:** 375 of 427 refuse without a login (401).
Everything still answering is public by design and listed here.

## Fixed

| Address | Problem | Fix |
|---|---|---|
| `GET /api/orders/<n>` | Returned the customer's **name and full phone number**. Order numbers count up, so anyone could walk 1, 2, 3… and list every customer. | Staff login required. Customers' pages use `/orders/<n>/track` (first name and drink, no phone). |
| `POST /api/orders/<n>/reply` | Anyone could write 280 characters onto **any** order's barista card by guessing its number, even with no question asked. | Accepted only while the barista has an open question on that order and it's still live. |
| `GET /api/inventory`, `/categories`, `/low-stock`, `/event`, `/<id>` | Stock levels and menu setup, readable by anyone. The guarded copies were **shadowed** by "login optional" ones in `inventory_routes.py`. | Staff login required (only staff screens use them). |
| `GET /api/debug/api-health` | A map of the server's endpoints. | Admin or support login. |
| EventsAir shared secret | Compared with `!=` (leaks timing). | `hmac.compare_digest`. |

## Public on purpose (accepted)

| Address | Why it's public | What it shows |
|---|---|---|
| `/api/display/config`, `/menu`, `/orders`, `/bg-video`, `/api/sponsors`, `/api/notices/active` | The board, kiosk and phone ordering pages have no login | Branding, menu, the event's **text number** (meant to be shown), and the board's queue as already displayed in public: first names, drinks, masked numbers |
| `POST /api/display/order`, `/order-group`, `/api/ea/guest`, `/api/ea/me/collected` | Placing an order from a phone or kiosk | Validated; event-code door applies |
| `GET /api/orders/find?name=` | A customer finding their own order | Active orders, last 2 hours, name prefix of 2+ letters, max 8, **never a phone** |
| `GET /api/orders/<n>/track`, `POST .../collected`, `.../customer-cancel` | The customer's own phone page | First name, drink, status |
| `POST /api/integrations/eventsair/order`, `/webhook`, `/api/ea/webhook` | EventsAir calling in | Shared secret required; **refused when no secret is set** (test mode excepted) |
| `POST /api/public/demo-request` | cupq.com.au's Book-a-demo form | Rate-limited, honeypot, CORS to cupq.com.au |
| `POST /api/client-errors`, `/api/client-events` | Tablets reporting crashes and usage | Write-only, truncated |
| `POST /api/auth/login`, `/refresh`, `GET /api/auth/verify`, `/logout` | Logging in | Login throttle (#573) |
| `GET /api/health`, `/heartbeat`, `/app-version`, `/status`, `/test`, `/auth-test` | Health checks and the post-deploy check | Up/down, version, event name, database type |
| `GET /api/event-access/public`, `POST /verify` | The event-code door | Whether a code is needed |
| `GET /api/qr` | QR images for posters | Encodes the given text (max 512 chars) |
| `GET /api/print/auto-print-mode` | Print agent | On/off |

## Still worth doing

- **Route shadowing** is how the inventory reads slipped through: two
  files registered the same address and the unguarded one won. A CI
  check that fails when two handlers share a method and path would stop
  the next one.
- `/api/status` and `/api/test` give away a little (event name, database
  type). Harmless today; could move behind the login with the health
  check kept public.
