#!/usr/bin/env bash
# Restores a backup made by backup.sh into a NEW, EMPTY database. It refuses to touch a database that already has tables, so a
# restore can never overwrite live data by accident. To replace a database, restore into a new one, verify, then switch over.
#   DUMP=/var/backups/shadowtrix/shadowtrix-20261120T020000Z.dump TARGET_DB=shadowtrix_restored ./scripts/ops/restore.sh
# Container use:  PG_RESTORE_CMD="docker exec -i shadowtrix-db-1 pg_restore -U shadowtrix"  PSQL_CMD="docker exec -i shadowtrix-db-1 psql -U shadowtrix"
set -euo pipefail
: "${DUMP:?set DUMP}"
: "${TARGET_DB:?set TARGET_DB}"
PG_RESTORE_CMD="${PG_RESTORE_CMD:-pg_restore}"
PSQL_CMD="${PSQL_CMD:-psql}"
( cd "$(dirname "$DUMP")" && sha256sum --check --quiet "$(basename "$DUMP").sha256" ) || { echo "checksum mismatch: the backup is damaged" >&2; exit 2; }
tables=$($PSQL_CMD -d "$TARGET_DB" -tAc "select count(*) from information_schema.tables where table_schema = 'public'")
if [ "${tables//[[:space:]]/}" != "0" ]; then echo "refusing: $TARGET_DB already contains $tables tables" >&2; exit 3; fi
$PG_RESTORE_CMD --no-owner --no-acl --exit-on-error -d "$TARGET_DB" < "$DUMP"
echo "restored into $TARGET_DB"
