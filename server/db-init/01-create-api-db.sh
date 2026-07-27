#!/bin/bash
set -e

# Create the naapurustot database and user for the API
# This runs only on first init (when postgres_data volume is empty)
# The API user must OWN the database, not merely hold grants on it. Since
# PostgreSQL 15 the public schema is owned by pg_database_owner and PUBLIC no
# longer has CREATE on it, so a non-owner needs an explicit in-schema grant —
# and that grant does not survive the DROP/CREATE in the recovery runbook
# (server/README.md), which recreated the database as the bootstrap superuser.
# The restore then failed on every CREATE TABLE with "permission denied for
# schema public". Owning the database makes the API user the public-schema owner
# implicitly, so a restore works without re-granting anything.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE USER naapurustot_api WITH PASSWORD '${API_DB_PASSWORD}';
    CREATE DATABASE naapurustot OWNER naapurustot_api;
    GRANT ALL PRIVILEGES ON DATABASE naapurustot TO naapurustot_api;
    \c naapurustot
    GRANT ALL ON SCHEMA public TO naapurustot_api;
EOSQL
