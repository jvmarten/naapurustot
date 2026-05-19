#!/bin/sh
# Daily pg_dump of both databases into /backups, with retention.
# Files land on the host at server/backups/ so DigitalOcean droplet snapshots
# capture them as part of the regular backup.
set -eu

BACKUP_DIR=/backups
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"

mkdir -p "$BACKUP_DIR"

dump() {
  db_name="$1"
  db_user="$2"
  db_password="$3"
  ts="$4"

  out="$BACKUP_DIR/${db_name}-${ts}.sql.gz"
  tmp="${out}.tmp"

  if PGPASSWORD="$db_password" pg_dump -h db -U "$db_user" "$db_name" | gzip > "$tmp"; then
    mv "$tmp" "$out"
    echo "  ok: $out ($(wc -c < "$out") bytes)"
  else
    echo "  FAILED: $db_name"
    rm -f "$tmp"
    return 1
  fi
}

while true; do
  ts="$(date +%Y%m%d-%H%M%S)"
  echo "[$(date -Iseconds)] backup start"

  dump umami umami "$POSTGRES_PASSWORD" "$ts" || true
  dump naapurustot naapurustot_api "$API_DB_PASSWORD" "$ts" || true

  find "$BACKUP_DIR" -name '*.sql.gz' -mtime "+${RETENTION_DAYS}" -delete

  echo "[$(date -Iseconds)] backup done, sleeping 24h"
  sleep 86400
done
