#!/bin/sh
#
# Restic backup script for FieldRestore. PRD §13.
#
# Backs up two things:
#   1. A pg_dump of the Postgres database (consistent snapshot at the
#      `pg_dump` start time).
#   2. The MinIO data directory (mounted read-only at /data/minio).
#
# Restic deduplicates against the named repository in $RESTIC_REPOSITORY.
# Use any of:
#   - sftp:user@host:/path
#   - s3:s3.amazonaws.com/<bucket>/<prefix>     (also works for R2/B2)
#   - rest:https://restic-server.example/repo/  (rest-server)
#
# Run on the host or inside the Compose `restic` profile:
#   docker compose --profile backup run --rm restic
#
# Schedule via cron on the host:
#   0 2 * * *  /usr/bin/docker compose -f /opt/fieldrestore/docker-compose.yml --profile backup run --rm restic
#
# Restore drill (PRD §11 DR target: <2h RTO):
#   1. `restic snapshots` — pick the snapshot id to restore from
#   2. `restic restore <id> --target /tmp/dr/`
#   3. Stop app + worker:    `docker compose stop app worker`
#   4. Restore Postgres:     `psql $DATABASE_URL < /tmp/dr/postgres-dump.sql`
#   5. Restore MinIO:        `rsync -a /tmp/dr/minio/ ./minio_data/`
#   6. Start the stack:      `docker compose up -d`
#   7. Verify /api/health returns ok and a smoke-test job opens correctly.

set -eu

: "${RESTIC_REPOSITORY:?RESTIC_REPOSITORY is required}"
: "${RESTIC_PASSWORD:?RESTIC_PASSWORD is required}"
: "${PG_DSN:?PG_DSN is required}"

DUMP_PATH="/tmp/postgres-dump.sql"

echo "[restic] init repo (no-op if already exists)…"
restic init >/dev/null 2>&1 || true

echo "[restic] dumping postgres…"
# postgres image ships pg_dump; this script is run inside the
# instrumentisto/restic image which carries postgres-client too.
PGPASSWORD="${PGPASSWORD:-}" pg_dump --no-owner --clean --if-exists \
  --dbname="${PG_DSN}" \
  > "${DUMP_PATH}"

echo "[restic] backing up postgres + minio…"
restic backup \
  --tag "fieldrestore" \
  --tag "$(date -u +%Y%m%d)" \
  "${DUMP_PATH}" \
  /data/minio

echo "[restic] pruning to retention policy (7d / 4w / 12m)…"
restic forget --prune \
  --keep-daily 7 \
  --keep-weekly 4 \
  --keep-monthly 12

echo "[restic] verifying repo integrity…"
restic check --read-data-subset=5%

rm -f "${DUMP_PATH}"
echo "[restic] done."
