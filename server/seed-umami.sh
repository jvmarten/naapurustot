#!/bin/bash
# Seed the Umami website entry after a fresh database init.
# Runs inside the db container; safe to re-run (uses ON CONFLICT DO NOTHING).
#
# Usage:  docker compose exec db bash /seed-umami.sh
# Or:     docker compose cp seed-umami.sh db:/seed-umami.sh && docker compose exec db bash /seed-umami.sh

set -euo pipefail

WEBSITE_ID="4ff13f8a-d93f-45bb-9121-ae9a899a6da6"
WEBSITE_NAME="naapurustot.fi"
WEBSITE_DOMAIN="naapurustot.fi"
ADMIN_USER_ID="41e2b680-648e-4b09-bcd7-3e2b10c06264"

# Wait for Umami's tables to exist (created by Umami on first start)
echo "Waiting for Umami schema..."
for i in $(seq 1 30); do
  if psql -U umami -d umami -c "SELECT 1 FROM website LIMIT 0" &>/dev/null; then
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "Error: website table not found after 30s. Is Umami running?"
    exit 1
  fi
  sleep 1
done

psql -U umami -d umami <<EOSQL
INSERT INTO website (website_id, name, domain, user_id, created_at, updated_at)
VALUES (
  '${WEBSITE_ID}'::uuid,
  '${WEBSITE_NAME}',
  '${WEBSITE_DOMAIN}',
  '${ADMIN_USER_ID}'::uuid,
  now(),
  now()
)
ON CONFLICT (website_id) DO NOTHING;
EOSQL

echo "Done. Website '${WEBSITE_NAME}' seeded with ID ${WEBSITE_ID}."
