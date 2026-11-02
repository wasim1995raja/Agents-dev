#!/usr/bin/env bash
# Idempotently creates the local autodev role and database.
# Requires the ability to run psql as the postgres superuser.
set -euo pipefail

ROLE="${AUTODEV_DB_ROLE:-autodev}"
PASSWORD="${AUTODEV_DB_PASSWORD:-autodev}"
DATABASE="${AUTODEV_DB_NAME:-autodev}"

run_psql() {
  if [ "$(id -u)" -eq 0 ]; then
    psql -v ON_ERROR_STOP=1 -U postgres "$@"
  elif sudo -n true 2>/dev/null; then
    sudo -n -u postgres psql -v ON_ERROR_STOP=1 "$@"
  else
    psql -v ON_ERROR_STOP=1 "$@"
  fi
}

echo "[bootstrap-db] ensuring role ${ROLE}"
if [ "$(run_psql -tAc "select 1 from pg_roles where rolname='${ROLE}'")" != "1" ]; then
  run_psql -c "create role ${ROLE} with login password '${PASSWORD}'"
else
  run_psql -c "alter role ${ROLE} with login password '${PASSWORD}'"
fi

echo "[bootstrap-db] ensuring database ${DATABASE}"
if [ "$(run_psql -tAc "select 1 from pg_database where datname='${DATABASE}'")" != "1" ]; then
  run_psql -c "create database ${DATABASE} owner ${ROLE}"
fi

run_psql -d "${DATABASE}" -c "grant all on schema public to ${ROLE}"
echo "[bootstrap-db] done"
