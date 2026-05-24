#!/bin/bash
#
# Restore a backup created by backup_db.sh.
#
# Usage:
#   ./scripts/restore_db.sh backups/expresso_20260525_030000.sql.gz
#   ./scripts/restore_db.sh backups/expresso_20260525_030000.sql.gz expresso_test
#
# Args:
#   $1 — path to a .sql.gz backup
#   $2 — target DB name (default: $DB_NAME or 'expresso')
#
# Safety:
#   - Refuses to restore over a non-empty DB without --force
#   - Confirms before doing anything destructive
#
# Test it on a scratch DB first:
#   createdb expresso_test
#   ./scripts/restore_db.sh backups/<latest>.sql.gz expresso_test
#   psql expresso_test -c "SELECT COUNT(*) FROM orders;"
#   dropdb expresso_test
#
# To restore to the live DB:
#   1. Stop the backend (lsof -ti:5001 | xargs kill -9)
#   2. ./scripts/restore_db.sh backups/<picked>.sql.gz expresso
#   3. Restart backend

set -uo pipefail

BACKUP_FILE="${1:-}"
TARGET_DB="${2:-${DB_NAME:-expresso}}"
PGUSER="${PGUSER:-$(whoami)}"
FORCE="${FORCE:-0}"

log() { echo "[restore_db $(date '+%H:%M:%S')] $*"; }

if [ -z "$BACKUP_FILE" ] || [ ! -f "$BACKUP_FILE" ]; then
    echo "Usage: $0 <backup.sql.gz> [target_db]"
    echo "  $BACKUP_FILE not found" >&2
    exit 1
fi

# Refuse to restore over a live DB without an explicit "yes I mean it".
if [ "$FORCE" != "1" ]; then
    # Count rows in a key table — if non-zero, treat as live.
    existing=$(psql -U "$PGUSER" -d "$TARGET_DB" -tA -c \
        "SELECT COALESCE((SELECT COUNT(*) FROM orders), 0)" 2>/dev/null || echo 0)
    if [ "$existing" != "0" ]; then
        echo "WARN: target DB '$TARGET_DB' has $existing rows in 'orders'."
        read -r -p "Drop and restore anyway? Type 'YES' to confirm: " confirm
        if [ "$confirm" != "YES" ]; then
            log "aborted"
            exit 0
        fi
    fi
fi

log "restoring $BACKUP_FILE → $TARGET_DB"
if gunzip -c "$BACKUP_FILE" | psql -U "$PGUSER" -d "$TARGET_DB" -v ON_ERROR_STOP=1 > /tmp/restore.log 2>&1; then
    log "restore OK"
    rowcount=$(psql -U "$PGUSER" -d "$TARGET_DB" -tA -c "SELECT COUNT(*) FROM orders" 2>/dev/null || echo "?")
    log "post-restore: 'orders' has $rowcount row(s)"
else
    log "FAIL: restore errored"
    tail -30 /tmp/restore.log
    exit 1
fi
