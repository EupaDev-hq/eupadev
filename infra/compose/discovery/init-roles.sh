#!/bin/sh
# Discovery mode (ADR-028): the engine's PostgreSQL accounts, created by the
# image's first-start hook (docker-entrypoint-initdb.d, superuser, local
# socket) from the production file orchestrator/sql/roles.sql, mounted at
# /eupadev/roles.sql. Passwords come from the container's environment (the
# .env file written by the installer), as psql variables: never in a file.
# Run once, when the data volume is empty; a later start does nothing.
set -eu
psql -v ON_ERROR_STOP=1 -v owner_password="$ORCH_OWNER_PASSWORD" -v engine_password="$ORCH_ENGINE_PASSWORD" \
  --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -f /eupadev/roles.sql
