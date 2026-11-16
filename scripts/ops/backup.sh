#!/usr/bin/env bash
# Logical backup of the ShadowTrix database (custom format, restorable with restore.sh or pg_restore).
#   DB_NAME=shadowtrix BACKUP_DIR=/var/backups/shadowtrix ./scripts/ops/backup.sh
# Connection settings come from the standard PG* environment variables (PGHOST, PGPORT, PGUSER, PGPASSWORD) or ~/.pgpass.
# To run pg_dump inside a container, set PG_DUMP_CMD, for example:  PG_DUMP_CMD="docker exec -i shadowtrix-db-1 pg_dump -U shadowtrix"
# Uploaded files are NOT in the database: back up STORAGE_LOCAL_DIR separately (see docs/operations/deployment.md).
set -euo pipefail
: "${DB_NAME:?set DB_NAME}"
: "${BACKUP_DIR:?set BACKUP_DIR}"
PG_DUMP_CMD="${PG_DUMP_CMD:-pg_dump}"
mkdir -p "$BACKUP_DIR"
umask 077                                   # backups contain personal data: owner-only
out="$BACKUP_DIR/shadowtrix-$(date -u +%Y%m%dT%H%M%SZ).dump"
$PG_DUMP_CMD --format=custom --no-owner --no-acl "$DB_NAME" > "$out"
( cd "$BACKUP_DIR" && sha256sum "$(basename "$out")" > "$(basename "$out").sha256" )
echo "$out"
