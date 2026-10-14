# Going back to an earlier version (and forward again)

Roadmap S1-5. When a change that just went live breaks something, put the
previous version back first and fix it afterwards.

## The quick way (about a minute)

1. See what's live and what came before:
   ```bash
   python scripts/rollback.py --copy live
   ```
   It lists the recent versions, newest first, with the change each one
   brought in (the same words as docs/RELEASES.md) and marks the one serving
   now.
2. Pick the version before the bad one and switch to it:
   ```bash
   python scripts/rollback.py --copy live --to <its id> --yes
   ```
   Railway runs that version's saved build again (no rebuild), and the
   script waits until cupq.app reports that version.
3. To go forward again, do the same with the newest id.

`--copy demo` does the same for demo.cupq.app. Without `--yes` it only
says what it would do.

## Things to know

- **It doesn't change the code on GitHub.** The next merge to main
  deploys as usual and replaces the rolled-back version. Fix the problem
  (or revert the PR on GitHub) before merging anything else.
- **Database changes stay.** Migrations only ever add (new columns and
  tables), so an older version runs fine on a newer database: it just
  doesn't use the new parts.
- **During an event** the freeze (Runner > Settings) stops new changes, but
  a rollback is always allowed. It's the fix, not a change.
- The Railway dashboard can do the same: the web service > Deployments >
  the version's menu > Rollback.

## Tested

On demo.cupq.app, 15 Oct 2026, with scripts/rollback.py:

| Step | Result |
|---|---|
| Back from 32f911e (ledger) to f34e082 (event freeze) | A new successful deployment of f34e082 within about 2 minutes; demo served f34e082's build afterwards |
| Forward to 32f911e | Done in 35 s, health 200 |

Found on the way: after a rollback, /api/app-version said `commit: null`,
because Railway only sets RAILWAY_GIT_COMMIT_SHA on a normal deploy. The
build now writes its commit into the image (BUILD_COMMIT), so versions
built from now on report themselves correctly even when rolled back to.
The script confirms the switch from Railway's own record plus a health
check, so it works with older builds too.
