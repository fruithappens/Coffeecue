#!/bin/bash
#
# Daily PostgreSQL backup with rotation.
#
# Usage:
#   ./scripts/backup_db.sh              # backup with defaults
#   BACKUP_DIR=/path/to/dir ./scripts/backup_db.sh
#   RETENTION_DAYS=14    ./scripts/backup_db.sh
#   DB_NAME=expresso     ./scripts/backup_db.sh
#   S3_BUCKET=my-bucket  ./scripts/backup_db.sh   # optional S3 upload
#
# Cron example (run daily at 3am):
#   0 3 * * *  cd /Users/stevewf/expresso && ./scripts/backup_db.sh >> logs/backup.log 2>&1
#
# Defaults:
#   DB_NAME=expresso
#   BACKUP_DIR=./backups
#   RETENTION_DAYS=7
#
# Exit codes:
#   0  success
#   1  pg_dump failed
#   2  disk write failed
#   3  S3 upload failed (backup still kept locally)

set -uo pipefail

DB_NAME="${DB_NAME:-expresso}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
S3_BUCKET="${S3_BUCKET:-}"
PGUSER="${PGUSER:-$(whoami)}"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_NAME="expresso_${TIMESTAMP}.sql.gz"
BACKUP_PATH="${BACKUP_DIR}/${BACKUP_NAME}"

log() { echo "[backup_db $(date '+%H:%M:%S')] $*"; }

# Ensure the backup directory exists.
mkdir -p "$BACKUP_DIR" || { log "FATAL: cannot create $BACKUP_DIR"; exit 2; }

log "starting backup of '$DB_NAME' as user '$PGUSER' → $BACKUP_PATH"

# pg_dump with --clean so the restore drops existing objects first;
# --if-exists makes that drop tolerant when restoring to a fresh DB.
# Custom format would compress better but plain-text gzip is more
# portable + lets you `zcat | psql` to inspect/restore.
if ! pg_dump \
      -U "$PGUSER" \
      --clean --if-exists \
      --no-owner --no-privileges \
      "$DB_NAME" 2>/tmp/pg_dump.err \
    | gzip -9 > "$BACKUP_PATH"; then
    log "FAIL: pg_dump errored"
    cat /tmp/pg_dump.err
    rm -f "$BACKUP_PATH"
    exit 1
fi

# Sanity-check the file isn't empty / truncated.
size=$(stat -f%z "$BACKUP_PATH" 2>/dev/null || stat -c%s "$BACKUP_PATH" 2>/dev/null || echo 0)
if [ "$size" -lt 1024 ]; then
    log "FAIL: backup is suspiciously small ($size bytes) — DB might be empty or pg_dump partially failed"
    exit 1
fi
log "wrote $(du -h "$BACKUP_PATH" | cut -f1) backup"

# Optional S3 upload.
if [ -n "$S3_BUCKET" ]; then
    if ! command -v aws >/dev/null 2>&1; then
        log "WARN: aws CLI not installed; skipping S3 upload"
    else
        log "uploading to s3://${S3_BUCKET}/${BACKUP_NAME}"
        if ! aws s3 cp "$BACKUP_PATH" "s3://${S3_BUCKET}/${BACKUP_NAME}"; then
            log "WARN: S3 upload failed; backup kept locally"
            exit 3
        fi
        log "S3 upload OK"
    fi
fi

# Rotate: delete backups older than RETENTION_DAYS.
log "rotating: deleting backups older than ${RETENTION_DAYS} days"
find "$BACKUP_DIR" -name 'expresso_*.sql.gz' -type f -mtime "+${RETENTION_DAYS}" -print -delete

# Final summary.
remaining=$(ls -1 "$BACKUP_DIR"/expresso_*.sql.gz 2>/dev/null | wc -l | tr -d ' ')
log "done. ${remaining} backup(s) in $BACKUP_DIR"
