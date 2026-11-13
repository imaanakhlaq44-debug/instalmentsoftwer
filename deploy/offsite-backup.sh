#!/bin/sh
# Copy the local backups off this machine, and keep the last N days there.
#
# A dump on the same disk as the database survives a mistake, not a dead
# server or a lost provider account. This sends deploy/backups/almas-sdm-*.sql.gz
# to somewhere else:
#
#   1. rclone, if OFFSITE_RCLONE_REMOTE is set — any remote you configured with
#      `rclone config` (Google Drive, Backblaze B2, S3, Dropbox, ...).
#   2. rsync over SSH, if OFFSITE_RSYNC_TARGET is set — used when rclone is not
#      configured, not installed, or fails.
#
# Settings live in deploy/.env (see deploy/.env.example). Credentials stay in
# rclone's own config (~/.config/rclone/rclone.conf) or your SSH key, never in
# this repository.
#
#     ./deploy/offsite-backup.sh
set -eu

cd "$(dirname "$0")/.."

# shellcheck disable=SC1091
[ -f deploy/.env ] && . deploy/.env

RCLONE_REMOTE="${OFFSITE_RCLONE_REMOTE:-}"
RSYNC_TARGET="${OFFSITE_RSYNC_TARGET:-}"
SSH_PORT="${OFFSITE_SSH_PORT:-22}"
SSH_KEY="${OFFSITE_SSH_KEY:-}"
KEEP_DAYS="${OFFSITE_KEEP_DAYS:-30}"
SRC=deploy/backups
PATTERN='almas-sdm-*.sql.gz'

case "$KEEP_DAYS" in ''|*[!0-9]*) echo "OFFSITE_KEEP_DAYS must be a whole number" >&2; exit 1 ;; esac

if [ -z "$RCLONE_REMOTE" ] && [ -z "$RSYNC_TARGET" ]; then
  echo "Nothing configured: set OFFSITE_RCLONE_REMOTE or OFFSITE_RSYNC_TARGET in deploy/.env" >&2
  exit 1
fi

if [ -z "$(find "$SRC" -maxdepth 1 -name "$PATTERN" -type f 2>/dev/null | head -n 1)" ]; then
  echo "No $SRC/$PATTERN to copy — run deploy/backup.sh first" >&2
  exit 1
fi

with_rclone() {
  command -v rclone >/dev/null || { echo "rclone is not installed"; return 1; }
  echo "rclone: copying to $RCLONE_REMOTE"
  # copy (not sync): a backup deleted locally by mistake is not deleted remotely.
  rclone copy "$SRC" "$RCLONE_REMOTE" --include "$PATTERN" || return 1
  # Read it back: every local file must exist remotely with the same size/hash.
  rclone check "$SRC" "$RCLONE_REMOTE" --include "$PATTERN" --one-way || return 1
  echo "rclone: removing remote backups older than ${KEEP_DAYS} days"
  rclone delete "$RCLONE_REMOTE" --include "$PATTERN" --min-age "${KEEP_DAYS}d" || return 1
}

with_rsync() {
  command -v rsync >/dev/null || { echo "rsync is not installed"; return 1; }
  host="${RSYNC_TARGET%%:*}"
  dir="${RSYNC_TARGET#*:}"
  if [ "$host" = "$RSYNC_TARGET" ] || [ -z "$dir" ]; then
    echo "OFFSITE_RSYNC_TARGET must look like user@host:/path/to/dir"; return 1
  fi
  case "$dir" in *"'"*) echo "OFFSITE_RSYNC_TARGET path must not contain a quote"; return 1 ;; esac
  ssh_cmd="ssh -p $SSH_PORT -o BatchMode=yes"
  [ -n "$SSH_KEY" ] && ssh_cmd="$ssh_cmd -i $SSH_KEY"
  echo "rsync: copying to $RSYNC_TARGET"
  # shellcheck disable=SC2086
  $ssh_cmd "$host" "mkdir -p '$dir'" || return 1
  # -t keeps modification times, which the retention below relies on.
  rsync -rt --chmod=F600 -e "$ssh_cmd" --include "$PATTERN" --exclude '*' "$SRC/" "$RSYNC_TARGET/" || return 1
  echo "rsync: removing remote backups older than ${KEEP_DAYS} days"
  # shellcheck disable=SC2086
  $ssh_cmd "$host" "find '$dir' -maxdepth 1 -type f -name '$PATTERN' -mtime +$KEEP_DAYS -delete" || return 1
}

if [ -n "$RCLONE_REMOTE" ]; then
  if with_rclone; then echo "OFFSITE: OK (rclone)"; exit 0; fi
  echo "rclone failed${RSYNC_TARGET:+; falling back to rsync}" >&2
fi
if [ -n "$RSYNC_TARGET" ]; then
  if with_rsync; then echo "OFFSITE: OK (rsync)"; exit 0; fi
fi
echo "OFFSITE: FAILED — backups are only on this machine" >&2
exit 1
