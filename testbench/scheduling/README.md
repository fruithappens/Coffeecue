# Scheduled production backups

Your in-app backup system does not run — production reports the
`data_backups` table does not exist — so until now the only backups were
the ones taken by hand.

## Install

```bash
cp testbench/scheduling/com.coffeecue.backup.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.coffeecue.backup.plist
```

Check it is alive:

```bash
launchctl list | grep coffeecue     # second column is the last exit code; 0 is good
```

Stop it:

```bash
launchctl unload ~/Library/LaunchAgents/com.coffeecue.backup.plist
```

## Why hourly

Hourly sounds like a lot and isn't, because it only **writes when the
data has changed**. Those two things together give the right answer in
both situations, which no fixed interval does:

- **Between events** almost nothing changes, so it writes about one file
  a day and the folder stays readable.
- **On an event morning** it writes every hour — and an hour is the
  right granularity there. Losing an hour of orders is something you can
  reconstruct from the cups on the bench. Losing a day is not.

"Changed" means the data: order count, customer count, newest order.
Not the clock — the export stamps itself every run, so hashing the whole
file would make every snapshot look different and defeat the point.

It also runs the moment the Mac wakes, so a laptop shut overnight takes
one as soon as it is opened rather than waiting for the next whole hour.

## Retention

- everything from the last **7 days**
- one per day for **8 weeks**
- one per week beyond that

An event you ran in March stays recoverable, without keeping 800 copies
of a quiet Tuesday. Snapshots are ~240 KB each.

## Credentials

Never in this repository. `~/.coffeecue_backup.env`, mode 600:

```
COFFEECUE_URL=https://web-production-4cc9c.up.railway.app
COFFEECUE_USER=...
COFFEECUE_PASS=...
```

## The limitation worth knowing

This runs on **your Mac**. If it is shut, no backup is taken — it
catches up on wake, but a Mac that is off for a week means a week with
no snapshots.

That is a deliberate trade rather than an oversight. Railway's
filesystem is ephemeral, so a backup written *there* disappears on the
next deploy, which is the moment you would most want it. Backing up to
the machine you actually keep is the honest version. If it ever needs to
survive your laptop, the next step is object storage (S3/R2) rather than
anything on Railway.

## Restoring

```bash
python testbench/dbsnapshot.py list
gunzip -c testbench/snapshots/auto-YYYYMMDD-HHMMSS.json.gz > /tmp/restore.json
```

The file is an `/api/event-data/export` snapshot, so it goes back
through `POST /api/event-data/import`. That deliberately never restores
old orders — they are historical and must not land in a live queue — so
it brings back customers and, with `include_config`, settings.
