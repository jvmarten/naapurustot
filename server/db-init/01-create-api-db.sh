#!/bin/bash
set -e

# Create the naapurustot database and user for the API
# This runs only on first init (when postgres_data volume is empty)
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE DATABASE naapurustot;
    CREATE USER naapurustot_api WITH PASSWORD '${API_DB_PASSWORD}';
    GRANT ALL PRIVILEGES ON DATABASE naapurustot TO naapurustot_api;
    \c naapurustot
    GRANT ALL ON SCHEMA public TO naapurustot_api;
EOSQL
