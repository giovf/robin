#!/usr/bin/env bash
# Runs on every container start: bring up the local PostgreSQL server and make
# sure the dev role, control-plane database and pgvector extension exist.
# Idempotent — safe to run by hand: bash .devcontainer/post-start.sh
set -euo pipefail

if ! command -v pg_ctlcluster >/dev/null 2>&1; then
  echo "→ PostgreSQL not installed in this image yet (rebuild the container) — skipping."
  exit 0
fi

PGVER="$(ls /usr/lib/postgresql | sort -n | tail -1)"

# The data directory is a named volume; Docker may hand it over root-owned.
sudo chown -R postgres:postgres /var/lib/postgresql

# Create the cluster if the volume has none for this Postgres major version.
if ! sudo test -s "/var/lib/postgresql/$PGVER/main/PG_VERSION"; then
  echo "→ Creating PostgreSQL $PGVER cluster..."
  sudo pg_dropcluster "$PGVER" main >/dev/null 2>&1 || true
  sudo pg_createcluster "$PGVER" main >/dev/null
fi

if ! pg_isready -q -h localhost; then
  echo "→ Starting PostgreSQL $PGVER..."
  sudo pg_ctlcluster "$PGVER" main start
fi

for _ in $(seq 1 60); do
  pg_isready -q -h localhost && break
  sleep 0.5
done
pg_isready -q -h localhost || { echo "✗ PostgreSQL did not start" >&2; exit 1; }

# Dev-only credentials (robin/robin). CREATEDB lets the app provision one
# database per customer. pgvector goes into template1 so every database
# created afterwards has it without needing superuser rights.
sudo runuser -u postgres -- psql -q -v ON_ERROR_STOP=1 <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'robin') THEN
    CREATE ROLE robin LOGIN CREATEDB PASSWORD 'robin';
  END IF;
END
$$;
SQL

sudo runuser -u postgres -- psql -q -v ON_ERROR_STOP=1 -d template1 \
  -c 'CREATE EXTENSION IF NOT EXISTS vector'

if ! sudo runuser -u postgres -- psql -tAc "SELECT 1 FROM pg_database WHERE datname = 'robin'" | grep -q 1; then
  sudo runuser -u postgres -- createdb -O robin robin
fi
sudo runuser -u postgres -- psql -q -v ON_ERROR_STOP=1 -d robin \
  -c 'CREATE EXTENSION IF NOT EXISTS vector'

echo "✓ PostgreSQL $PGVER ready — postgres://robin:robin@localhost:5432/robin"
