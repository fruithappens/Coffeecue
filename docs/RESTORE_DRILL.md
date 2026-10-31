# Backups and restoring them

## How cupq.app is backed up

| What | When | Kept | Where |
|---|---|---|---|
| Full database dump | every night at 3:00 | newest 14 | `~/expresso/backups/` |
| Dump if anything changed | every hour | newest 48 | `~/expresso/backups/hourly/` |

Both are `scripts/backup_prod.py`, installed to `~/cupq-backup/` and run by
two launchd jobs on Steve's Mac (`python3 scripts/backup_prod.py install`
sets them up; `python3 ~/cupq-backup/backup_prod.py status` shows the
newest files). Each run reads the database address from Railway, dumps
with up to 3 tries, and **checks the file** by listing the tables inside
it. It needs no app login.

After each good dump the Mac checks in with cupq.app. If none checks in for
26 hours, cupq.app texts the admin alert number and whoever is on call, and
Runner > Live > Readiness shows "A backup in the last day" in red. A failed
run also shows a notification on the Mac. Log: `~/expresso/backups/backup.log`.

Railway's own backups (point-in-time restore) come with the Pro plan
(roadmap C3-14) and would be a second, independent copy.

## Restore drill: 15 Oct 2026, passed

1. Fresh dump of cupq.app: 42 tables, 14.8 MB, 76 s, verified.
2. Restored into a scratch database on the Mac: under a second, no errors.
3. Row counts, live vs restored: orders 978 = 978, users 5 = 5, stock
   items 18 = 18, texts 329 = 329, printers 3 = 3, enquiries 1 = 1,
   settings 67 vs 66 (the one removed on purpose in step 4).
4. Made the copy harmless before starting it: EventsAir switched off,
   admin alerts removed, texts off (TESTING_MODE).
5. Started CupQ on it (port 5002): health 200, the menu, the status page
   and the event ("Treenet 2026", with its branding) all served from the
   restored data.
6. Dropped the scratch database and deleted the test dump (they hold
   attendee details).

## Restoring for real

If cupq.app's database is lost or damaged:

1. Pick the dump: `python3 ~/cupq-backup/backup_prod.py status` (newest
   first; an hourly one is at most an hour old during an event).
2. In Railway, add a new Postgres to the Coffee Cue project (or use the
   damaged one after emptying it), and copy its `DATABASE_PUBLIC_URL`.
3. Restore:
   ```bash
   /opt/homebrew/opt/postgresql@16/bin/pg_restore --no-owner --no-acl -j 4 -d "<DATABASE_PUBLIC_URL>" ~/expresso/backups/<name>.dumpdir
   ```
   Since 31 Oct 2026 a backup is a FOLDER (`.dumpdir`, made 4 tables at a
   time because Railway's proxy cuts long connections); `pg_restore` reads
   it as is. Older backups are single `.dump` files: same command, without
   `-j 4`.
4. Point the web service's `DATABASE_URL` at it (`${{Postgres.DATABASE_URL}}`
   reference) and redeploy. Check Readiness and place a test order.

Repeat the drill (steps 1-6 above) every few months and after any change
to the database's version.
