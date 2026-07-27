#!/usr/bin/env bash
# Restore a database from the newest dump in ./backups (or a dump you name).
#
# Written because the runbook this replaces produced a silently EMPTY database.
# It recreated the API database as the bootstrap superuser and then piped the
# dump in as naapurustot_api; since PostgreSQL 15 the public schema is owned by
# pg_database_owner and PUBLIC has no CREATE on it, so every CREATE TABLE failed
# with "permission denied for schema public" — and without ON_ERROR_STOP psql
# reported success anyway. An operator following it during an outage would have
# restarted the API against an empty database and concluded the backups were bad.
#
# This script therefore: recreates the database with the right OWNER, restores
# with ON_ERROR_STOP=1 so a failure is loud, and asserts afterwards that the
# data is actually there.
#
# Usage (run from /opt/naapurustot/server):
#   ./restore.sh naapurustot            # newest naapurustot-*.sql.gz
#   ./restore.sh umami                  # newest umami-*.sql.gz
#   ./restore.sh naapurustot backups/naapurustot-20260727-030000.sql.gz
set -euo pipefail

DB="${1:-}"
DUMP="${2:-}"
BACKUP_DIR="${BACKUP_DIR:-backups}"

case "$DB" in
  naapurustot) DB_OWNER=naapurustot_api; SENTINEL_TABLE=users ;;
  umami)       DB_OWNER=umami;           SENTINEL_TABLE=website ;;
  *) echo "usage: $0 {naapurustot|umami} [dump.sql.gz]" >&2; exit 2 ;;
esac

if [ -z "$DUMP" ]; then
  DUMP="$(ls -t "$BACKUP_DIR/${DB}"-*.sql.gz 2>/dev/null | head -1 || true)"
fi
if [ -z "$DUMP" ] || [ ! -s "$DUMP" ]; then
  echo "No usable dump found for $DB in $BACKUP_DIR" >&2
  exit 1
fi

echo "Restoring $DB from $DUMP"
echo "This DISCARDS the current $DB database. Ctrl-C within 10s to abort."
sleep 10

# Take a safety dump of what is there now, so a bad restore is not terminal.
SAFETY="$BACKUP_DIR/${DB}-pre-restore-$(date +%Y%m%d-%H%M%S).sql.gz"
echo "Safety dump -> $SAFETY"
if ! docker compose exec -T db pg_dump -U "$DB_OWNER" "$DB" 2>/dev/null | gzip > "$SAFETY"; then
  echo "  (could not dump the current $DB — continuing; it may not exist yet)"
  rm -f "$SAFETY"
fi

echo "Stopping consumers"
docker compose stop umami api

# Recreate with the correct owner. Owning the database makes the restoring role
# the implicit owner of the public schema, which is what the old runbook lost.
# The cluster's bootstrap superuser (docker-compose.yml POSTGRES_USER) — `umami`
# for historical reasons; it is the only role that can drop/create databases.
SUPERUSER="${POSTGRES_USER:-umami}"
docker compose exec -T db psql -v ON_ERROR_STOP=1 -U "$SUPERUSER" -d postgres <<SQL
DROP DATABASE IF EXISTS ${DB};
CREATE DATABASE ${DB} OWNER ${DB_OWNER};
GRANT ALL PRIVILEGES ON DATABASE ${DB} TO ${DB_OWNER};
SQL

echo "Restoring…"
gunzip -c "$DUMP" | docker compose exec -T db psql -v ON_ERROR_STOP=1 -U "$DB_OWNER" "$DB" >/dev/null

# A restore that "succeeds" into an empty database is the failure mode this
# script exists to prevent, so prove the data is there before declaring victory.
count="$(docker compose exec -T db psql -tAX -U "$DB_OWNER" -d "$DB" \
  -c "SELECT count(*) FROM ${SENTINEL_TABLE};" 2>/dev/null || echo 0)"
count="$(echo "$count" | tr -d '[:space:]')"
if [ -z "$count" ] || [ "$count" = "0" ]; then
  echo "RESTORE FAILED: ${SENTINEL_TABLE} is empty or missing after restore." >&2
  echo "The pre-restore state is in $SAFETY" >&2
  docker compose start umami api
  exit 1
fi

echo "Restored $DB — ${SENTINEL_TABLE}: ${count} rows"
docker compose start umami api
echo "Done. Verify: docker compose ps && curl -sf https://api.naapurustot.fi/health"
