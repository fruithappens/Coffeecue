# _archive_legacy/

Files moved here on 2026-05-19 by a Claude session, during a cleanup of the repo root and `Barista Front End/src/`. **Nothing has been deleted** — `git mv` was used so the history is preserved and any file can be restored with `git mv _archive_legacy/<path> <original-path>`.

## Selection criteria

A file was moved here only if **all** of the following held:
- Its filename clearly marks it as superseded (`.backup`, `_broken`, `.broken.`, `.old.`, `.old2.`, `.original.`, `.refactored.`, `.enhanced.`, `.fixed.`, `.improved.`, `.simplified.`, `.test.backup.`, `-fix.`).
- There is an un-suffixed sibling (`ApiService.js`, `AuthService.js`, `OrderDataService.js`, `SupportInterface.js`, `auth_routes.py`, `index.js`, `useOrders.js`) that **is** actively imported.
- `grep -r` across `Barista Front End/src` and the backend confirmed **no file imports the suffixed variant**.

Files were **not** moved if any importer was found, even if the name looked legacy. Notably:
- `routes/websocket_routes_fixed.py` — *kept*, because `app.py` actually imports it (the "fixed" suffix is misleading; this is the live version).
- `Barista Front End/src/services/ApiService.simplified.js` — *kept*, because `Barista Front End/src/components/DemoModeToggle.js` imports it. Worth investigating whether DemoModeToggle should switch to the canonical `ApiService.js`, but that needs a behavior check first.

## Contents

```
_archive_legacy/
  routes/                     # backend
    auth_routes.py.backup
    auth_routes_broken.py
  frontend_services/
    ApiService.enhanced.js
    ApiService.fixed.js
    ApiService.improved.js
    AuthService.improved.js
    ConfigService.improved.js
    OrderDataService.original.js
    OrderDataService.refactored.js
  frontend_components/
    SupportInterface.broken.js
    SupportInterface.old.js
    SupportInterface.old2.js
    SupportInterface.test.backup.js
  frontend_misc/
    index.improved.js
    useOrders-fix.js
```

## Restoring

```bash
# Example: restore a single file
git mv _archive_legacy/frontend_services/ApiService.simplified.js \
       "Barista Front End/src/services/ApiService.simplified.js"

# Or just look at it without restoring:
git log -- _archive_legacy/frontend_services/ApiService.simplified.js
```

## Not yet audited

These look like cruft too but were left alone to keep this change small / safe:

- `backend_backup_20250525_125912/` — whole-tree snapshot from earlier work.
- `_archive/` — pre-existing archive directory (separate from this one).
- `Barista Front End/public/auto-tester-DELETE_LATER.js`, `clear-storage-and-test-DELETE_LATER.html` — the filenames literally say "delete later" but they live in `public/` so the build copies them; needs a UI check before removing.
- `Barista Front End/TEST-TOOLS-README-DELETE_LATER.md` — same pattern.
- Dozens of `.md` files at the repo root with overlapping/stale content. Consolidating those is a separate exercise.
- Root-level `.html` test pages (`check-frontend-auth.html`, `clear_and_login.html`, etc.).

If you decide to also move those, follow the same import-check protocol before touching anything in `public/` or sourced in any build script.
