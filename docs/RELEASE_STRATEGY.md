# Release strategy — the stable line and the rebuild

Steve, 2026-08-26: "is it possible to have for lack of a better word a
restore point. ie we can come back to this evenings roll out and pick
and use that but in the mean time get the stock stuff working and
tested and practised."

Yes. This file is how.

## The restore point

The tag `stable-treenet-v1` marks tonight's verified build (all of the
2026-08-26 fixes: menu bridge, CANCEL/OOPS, station locations, print
queue, decaf across channels, live waits, mid-make transfer). A tag is
permanent — it survives any amount of later work.

Restore = deploy the tag:

    git checkout stable-treenet-v1
    git checkout -b restore-stable
    git push origin restore-stable   # then point Railway at it, or:
    git push origin stable-treenet-v1:main --force-with-lease
                                     # only with Steve's explicit say-so

## The two lines

- **main** — the STABLE EVENT LINE. Until the September event is done,
  only bug fixes and event-prep merges land here. Railway production
  keeps auto-deploying it, so production is always the stable build.
- **stock-rebuild** — the recipe/menu/inventory rebuild
  (docs/MENU_ARCHITECTURE.md is its spec). All rebuild work happens
  here. It merges to main only AFTER the event, or before it only with
  Steve's explicit go and a full bench pass.

Fixes that both lines need: land on main first, then merge main into
stock-rebuild (never the other way).

## Practising the rebuild safely

Two options, in order of preference:

1. **Staging service on Railway** (Steve's dashboard step): duplicate
   the production service, set its branch to `stock-rebuild`, give it
   its OWN fresh database (never the production DATABASE_URL). Then the
   rebuild can be tested and practised on real infrastructure — real
   phones, real printers pointed at it temporarily — without touching
   the event system.
2. **Local bench** (already documented in testbench/) for everything
   that does not need the public internet.

## Data safety rules (from docs/MENU_ARCHITECTURE.md cautions)

- Rebuild migrations are ADDITIVE ONLY until cutover: new tables, no
  drops, no renames. Old code must keep running against a database the
  new code has touched — that is what makes the code restore point a
  full restore point.
- pg_dump before any cutover, and before any migration run against
  production. (Backups to a Railway volume — still pending Steve's
  volume attach.)
- Never merge or deploy while Steve is testing or during an event.
