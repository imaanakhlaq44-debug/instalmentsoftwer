#!/bin/sh
# A dump of the database, kept for thirty days.
#
# This is not the same thing as the VPS provider's snapshots, and it is not
# optional. Snapshots restore a whole machine to a moment; they will not give
# you one customer's ledger back after somebody deletes the wrong record, and
# they are held by the same provider whose account you might one day lose.
#
# What is in this file: every customer's name, CNIC, address and phone, every
# handset's IMEI, and every payment. Treat a backup copy exactly as carefully as
# the database it came from.
#
# Install it as a daily cron job — see deploy/DEPLOY.md.
#
#     ./deploy/backup.sh                  writes deploy/backups/almas-sdm-<date>.sql.gz
#
set -eu

cd "$(dirname "$0")/.."

COMPOSE="docker compose -f deploy/docker-compose.yml --env-file deploy/.env"
STAMP=$(date +%Y-%m-%d-%H%M)
OUT="/backups/almas-sdm-${STAMP}.sql.gz"
KEEP_DAYS=30

# shellcheck disable=SC1091
. deploy/.env

# pg_dump runs inside the database container, so no PostgreSQL client is needed
# on the host and the password never appears in a host process list.
$COMPOSE exec -T db sh -c \
  "pg_dump -U '${POSTGRES_USER}' -d '${POSTGRES_DB}' --clean --if-exists | gzip -9 > '${OUT}'"

echo "Wrote deploy/backups/almas-sdm-${STAMP}.sql.gz"

# A dump that cannot be read is not a backup. gzip -t costs a second and catches
# a truncated write — which is what a full disk produces, silently.
$COMPOSE exec -T db sh -c "gzip -t '${OUT}'"

find deploy/backups -name 'almas-sdm-*.sql.gz' -type f -mtime "+${KEEP_DAYS}" -delete

echo "Kept: $(find deploy/backups -name 'almas-sdm-*.sql.gz' -type f | wc -l) file(s)"
