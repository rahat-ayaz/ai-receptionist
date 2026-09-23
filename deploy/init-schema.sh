#!/usr/bin/env bash
# Create the Prisma schema in Cloud SQL.
#
# The container build deliberately does NOT run `prisma db push` (see
# build:container), so a brand-new database has no tables until this runs.
# Connects through the Cloud SQL Auth Proxy because the instance has no
# authorized networks — IAM over TLS is the only way in.
source "$(dirname "$0")/config.sh"

PROXY_BIN="${PROXY_BIN:-$HOME/.local/bin/cloud-sql-proxy}"
PORT="${PROXY_PORT:-5433}"
[[ -x "${PROXY_BIN}" ]] || { echo "cloud-sql-proxy not found at ${PROXY_BIN}"; exit 1; }

echo "== starting Auth Proxy on 127.0.0.1:${PORT}"
"${PROXY_BIN}" --port "${PORT}" "${SQL_CONN}" >/tmp/csp.log 2>&1 &
PROXY_PID=$!
trap 'kill ${PROXY_PID} 2>/dev/null || true' EXIT

# Wait for it to actually accept connections rather than guessing at a sleep.
for _ in $(seq 1 30); do
  nc -z 127.0.0.1 "${PORT}" 2>/dev/null && break
  sleep 1
done
nc -z 127.0.0.1 "${PORT}" 2>/dev/null || { echo "proxy never came up:"; cat /tmp/csp.log; exit 1; }
echo "   up"

# The stored URL uses the unix-socket form for Cloud Run; rewrite it to TCP for
# the proxy. Password is extracted, never printed.
STORED="$(gcloud secrets versions access latest --secret=DATABASE_URL)"
PW="$(printf '%s' "${STORED}" | sed -E 's|^postgresql://[^:]+:([^@]+)@.*|\1|')"
export DATABASE_URL="postgresql://${SQL_USER}:${PW}@127.0.0.1:${PORT}/${SQL_DB}?schema=public"

echo "== applying schema"
npx prisma db push

echo
echo "== verifying"
# `prisma db execute` discards SELECT output, so it cannot confirm anything —
# it reports success even when the query returns nothing. Query directly.
node -e "
const pg = require('pg');
(async () => {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const r = await c.query(\"select tablename from pg_tables where schemaname='public' order by tablename\");
  console.log('   ' + r.rowCount + ' tables: ' + r.rows.map(x => x.tablename).join(', '));
  await c.end();
  if (r.rowCount === 0) process.exit(1);
})().catch(e => { console.error('   verification failed: ' + e.message); process.exit(1); });
"
echo "done"
