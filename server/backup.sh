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

# Delete a database's aged-out dumps ONLY when this cycle produced a fresh one.
#
# Retention used to run unconditionally after both dumps, while every failure was
# swallowed with `|| true`. A dump that kept failing therefore deleted its own
# last good backup after RETENTION_DAYS, silently. The nastiest shape is the
# partial failure: if the umami dump succeeds and the naapurustot (user data) one
# does not, `ls -lh backups/` still shows fresh files — which is exactly the
# manual check server/README.md tells the operator to run — while the only copies
# of every account, favourite, shortlist and note age out behind it.
#
# Scoping the prune per database and gating it on this cycle's result means a
# failing dump can only ever stop making new backups, never destroy old ones.
prune() {
  db_name="$1"
  ok="$2"
  if [ "$ok" != "1" ]; then
    echo "  retention SKIPPED for $db_name — no fresh dump this cycle"
    return 0
  fi
  find "$BACKUP_DIR" -name "${db_name}-*.sql.gz" -mtime "+${RETENTION_DAYS}" -delete
}

# A machine-readable heartbeat so a failure is discoverable without reading logs.
# Deliberately written next to the dumps rather than exposed on the public
# /health endpoint: "last good backup was N days ago" tells anyone who asks that
# the operator is currently blind.
write_status() {
  cat > "$BACKUP_DIR/status.json" <<EOF
{"checked_at":"$(date -Iseconds)","umami_ok":$1,"naapurustot_ok":$2,"retention_days":${RETENTION_DAYS}}
EOF
}

while true; do
  ts="$(date +%Y%m%d-%H%M%S)"
  echo "[$(date -Iseconds)] backup start"

  umami_ok=0
  api_ok=0
  if dump umami umami "$POSTGRES_PASSWORD" "$ts"; then umami_ok=1; fi
  if dump naapurustot naapurustot_api "$API_DB_PASSWORD" "$ts"; then api_ok=1; fi

  prune umami "$umami_ok"
  prune naapurustot "$api_ok"
  write_status "$umami_ok" "$api_ok"

  if [ "$umami_ok" != "1" ] || [ "$api_ok" != "1" ]; then
    echo "[$(date -Iseconds)] backup FAILED (umami=$umami_ok naapurustot=$api_ok)"
  fi

  echo "[$(date -Iseconds)] backup done, sleeping 24h"
  sleep 86400
done
