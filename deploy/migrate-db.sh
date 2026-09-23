#!/usr/bin/env bash
# Move the existing Postgres into Cloud SQL.
#
#   SOURCE_DATABASE_URL='postgresql://...' ./deploy/migrate-db.sh
#
# Runs pg_dump against the current database and restores into Cloud SQL through
# the Cloud SQL Auth Proxy. Writes are made to the NEW database only; the source
# is opened read-only. Take the app offline first, or accept that rows written
# after the dump starts will not be copied.
source "$(dirname "$0")/config.sh"
: "${SOURCE_DATABASE_URL:?Set SOURCE_DATABASE_URL to the database you are migrating FROM}"

DUMP="${TMPDIR:-/tmp}/airecept-$(date +%Y%m%d-%H%M%S).dump"

command -v pg_dump >/dev/null || { echo "pg_dump not found — brew install libpq"; exit 1; }
command -v cloud-sql-proxy >/dev/null || { echo "cloud-sql-proxy not found — brew install cloud-sql-proxy"; exit 1; }

echo "== dumping source -> ${DUMP}"
# Custom format so the restore can run in parallel and skip ownership.
pg_dump --format=custom --no-owner --no-privileges \
        --file="${DUMP}" "${SOURCE_DATABASE_URL}"
echo "   $(du -h "${DUMP}" | cut -f1)"

echo "== starting Cloud SQL Auth Proxy on 127.0.0.1:5433"
cloud-sql-proxy --port 5433 "${SQL_CONN}" &
PROXY_PID=$!
trap 'kill ${PROXY_PID} 2>/dev/null || true' EXIT
sleep 6

TARGET_URL="$(gcloud secrets versions access latest --secret=DATABASE_URL)"
# Rewrite the socket form into a TCP URL for the proxy.
PW="$(printf '%s' "${TARGET_URL}" | sed -E 's|postgresql://[^:]+:([^@]+)@.*|\1|')"
RESTORE_URL="postgresql://${SQL_USER}:${PW}@127.0.0.1:5433/${SQL_DB}"

echo "== restoring into Cloud SQL"
pg_restore --no-owner --no-privileges --clean --if-exists \
           --dbname="${RESTORE_URL}" --jobs=4 "${DUMP}"

echo "== row counts (new database)"
psql "${RESTORE_URL}" -c "
  SELECT relname AS table, n_live_tup AS approx_rows
  FROM pg_stat_user_tables ORDER BY n_live_tup DESC LIMIT 15;"

echo
echo "Dump kept at ${DUMP} — delete it once you have verified the migration."
echo "It contains every tenant's data."
