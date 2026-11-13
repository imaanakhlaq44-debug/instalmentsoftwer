#!/bin/sh
# Prove a backup can actually be restored — without going anywhere near the
# live database.
#
# The dump is loaded into a brand-new, throwaway PostgreSQL that exists only
# for the length of this script, a few row counts are taken, and the throwaway
# copy is deleted. The live `db` service is never read from or written to.
#
#     ./deploy/restore-drill.sh                        newest deploy/backups/almas-sdm-*.sql.gz
#     ./deploy/restore-drill.sh path/to/file.sql.gz    a specific backup
#     ./deploy/restore-drill.sh --allow-empty ...      do not fail on zero dealers
#
# Exit status 0 and "RESTORE DRILL: PASS" means the file restored cleanly and
# the core tables came back. Anything else prints "RESTORE DRILL: FAIL".
#
# Where the throwaway PostgreSQL runs (DRILL_ENGINE):
#   docker  (default) a separate postgres:16-alpine container with no network,
#           labelled as a drill container, removed afterwards.
#   local   a temporary cluster from the host's own initdb/pg_ctl, listening on
#           a Unix socket in a temp directory only. For machines without Docker.
#           Must not run as root (PostgreSQL refuses).
set -eu

cd "$(dirname "$0")/.."

ALLOW_EMPTY=0
if [ "${1:-}" = "--allow-empty" ]; then ALLOW_EMPTY=1; shift; fi

ENGINE="${DRILL_ENGINE:-docker}"
IMAGE="${DRILL_IMAGE:-postgres:16-alpine}"
# The dump contains `ALTER ... OWNER TO <user>`, so the throwaway server gets a
# role of the same name. Read it from deploy/.env if present; it is only a name.
DB_USER=almas
if [ -f deploy/.env ]; then
  DB_USER=$(sed -n 's/^POSTGRES_USER=//p' deploy/.env | tail -n 1 | tr -d '"'"'"' ')
  [ -n "$DB_USER" ] || DB_USER=almas
fi
DRILL_DB=restore_drill
DRILL_NAME="almas-restore-drill-$$"
WORK=""

fail() {
  echo "ERROR: $*" >&2
  echo "RESTORE DRILL: FAIL"
  exit 1
}

# ---------------------------------------------------------------------------
# Pick the backup
# ---------------------------------------------------------------------------
FILE="${1:-}"
if [ -z "$FILE" ]; then
  # Names carry a sortable timestamp, so the last one by name is the newest.
  FILE=$(find deploy/backups -maxdepth 1 -name 'almas-sdm-*.sql.gz' -type f 2>/dev/null | sort | tail -n 1)
  [ -n "$FILE" ] || fail "no deploy/backups/almas-sdm-*.sql.gz found (run deploy/backup.sh first)"
fi
[ -f "$FILE" ] || fail "no such file: $FILE"
echo "Backup:   $FILE ($(du -h "$FILE" | cut -f1))"

gzip -t "$FILE" 2>/dev/null || fail "$FILE is not a complete gzip file (truncated or corrupt)"

# ---------------------------------------------------------------------------
# The throwaway server
# ---------------------------------------------------------------------------
# Refuse anything that looks like the live compose database. The drill only
# ever creates its own container, but this check runs before every command
# sent to it, so a typo or an edited variable cannot point it at production.
guard_container() {
  svc=$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.service" }}' "$DRILL_NAME" 2>/dev/null || true)
  mark=$(docker inspect -f '{{ index .Config.Labels "almas.restore-drill" }}' "$DRILL_NAME" 2>/dev/null || true)
  case "$DRILL_NAME" in almas-restore-drill-*) ;; *) fail "refusing: $DRILL_NAME is not a drill container" ;; esac
  [ -z "$svc" ] || fail "refusing: $DRILL_NAME belongs to compose service '$svc' — the drill never touches a compose service"
  [ "$mark" = "1" ] || fail "refusing: $DRILL_NAME is not labelled as a restore-drill container"
}

cleanup() {
  if [ "$ENGINE" = "docker" ]; then
    docker rm -f "$DRILL_NAME" >/dev/null 2>&1 || true
  elif [ -n "$WORK" ]; then
    pg_ctl -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true
    rm -rf "$WORK"
  fi
}
trap cleanup EXIT
trap 'exit 1' INT TERM

case "$ENGINE" in
docker)
  command -v docker >/dev/null || fail "docker not found (or set DRILL_ENGINE=local)"
  echo "Starting throwaway container $DRILL_NAME ($IMAGE, no network)..."
  # No published port, no network, no volume shared with the live database.
  # A random password that is thrown away with the container.
  docker run -d --rm --name "$DRILL_NAME" --network none \
    --label almas.restore-drill=1 \
    -e POSTGRES_USER="$DB_USER" \
    -e POSTGRES_PASSWORD="drill-$$-$(date +%s)" \
    -e POSTGRES_DB="$DRILL_DB" \
    -e POSTGRES_INITDB_ARGS="--encoding=UTF8 --locale=C" \
    "$IMAGE" >/dev/null || fail "could not start $IMAGE"
  run_psql() {
    guard_container
    docker exec -i "$DRILL_NAME" psql -X -q -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DRILL_DB" "$@"
  }
  i=0
  # The image's entrypoint starts a temporary server during init and restarts
  # it; wait for the final one by also requiring a successful query.
  until docker exec "$DRILL_NAME" pg_isready -q -U "$DB_USER" -d "$DRILL_DB" -h 127.0.0.1 2>/dev/null \
      && run_psql -c 'select 1' >/dev/null 2>&1; do
    i=$((i + 1)); [ "$i" -lt 60 ] || fail "throwaway PostgreSQL did not become ready"
    sleep 1
  done
  ;;
local)
  [ "$(id -u)" != "0" ] || fail "DRILL_ENGINE=local cannot run as root; run it as a normal user"
  for d in /usr/lib/postgresql/*/bin; do [ -x "$d/initdb" ] && PATH="$d:$PATH"; done
  command -v initdb >/dev/null || fail "initdb not found (install postgresql, or use DRILL_ENGINE=docker)"
  WORK=$(mktemp -d "${TMPDIR:-/tmp}/almas-restore-drill.XXXXXX")
  echo "Starting throwaway local cluster in $WORK (Unix socket only)..."
  initdb -D "$WORK/data" -U "$DB_USER" --auth=trust --encoding=UTF8 --locale=C >/dev/null \
    || fail "initdb failed"
  pg_ctl -D "$WORK/data" -w -l "$WORK/log" \
    -o "-c listen_addresses='' -c unix_socket_directories='$WORK' -c fsync=off" start >/dev/null \
    || fail "throwaway cluster did not start (see $WORK/log)"
  createdb -h "$WORK" -U "$DB_USER" "$DRILL_DB" || fail "createdb failed"
  run_psql() {
    psql -X -q -v ON_ERROR_STOP=1 -h "$WORK" -U "$DB_USER" -d "$DRILL_DB" "$@"
  }
  ;;
*) fail "DRILL_ENGINE must be docker or local, not '$ENGINE'" ;;
esac

# ---------------------------------------------------------------------------
# Restore and count
# ---------------------------------------------------------------------------
echo "Restoring..."
gunzip -c "$FILE" | run_psql >/dev/null || fail "the dump did not restore cleanly (first error above)"

echo "Row counts in the restored copy:"
status=PASS
for t in dealers customers devices payments; do
  n=$(run_psql -A -t -c "select count(*) from \"$t\"" 2>/dev/null) || { echo "  $t: MISSING"; status=FAIL; continue; }
  printf '  %-10s %s\n' "$t" "$n"
  if [ "$t" = dealers ] && [ "$n" = 0 ] && [ "$ALLOW_EMPTY" = 0 ]; then
    echo "  (no dealers at all — a live system always has some; pass --allow-empty for a fresh install)"
    status=FAIL
  fi
done

echo "RESTORE DRILL: $status"
[ "$status" = PASS ]
