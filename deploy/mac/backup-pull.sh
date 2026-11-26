#!/usr/bin/env bash
# Pulls the encrypted nightly database backups of barakahstore.org from the VM to this Mac.
# Run daily by launchd (install-backup-pull.sh). The files are age-encrypted on the VM to the
# owner's key; this script never decrypts them. See deploy/vm/RUNBOOK.md, "Off-site backups".
set -euo pipefail

HOST="${BARAKAH_BACKUP_HOST:-arefin@149.28.157.20}"
PORT="${BARAKAH_BACKUP_PORT:-22}"
KEY="${BARAKAH_BACKUP_KEY:-$HOME/.ssh/barakah_backup}"
# Extra ssh options, for a rehearsal against a throwaway host; empty in normal use.
SSH_OPTS="${BARAKAH_BACKUP_SSH_OPTS:-}"
DEST="${BARAKAH_BACKUP_DIR:-$HOME/Backups/barakahstore}"
KEEP_DAYS=60
# The VM makes one backup a night; a newest copy older than this means it stopped.
STALE_DAYS=2

RSYNC=rsync
[ -x /opt/homebrew/bin/rsync ] && RSYNC=/opt/homebrew/bin/rsync

log() { printf '%s %s\n' "$(date '+%F %T')" "$*"; }
notify() {
  osascript -e "display notification \"$1\" with title \"Barakah backup\"" >/dev/null 2>&1 || true
}

mkdir -p "$DEST"
chmod 700 "$DEST"

# The server side is rrsync -ro on the outbox, so "HOST:" is the outbox itself.
if ! "$RSYNC" -rt --ignore-existing \
  -e "ssh -i $KEY -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=20 -p $PORT $SSH_OPTS" \
  "$HOST:" "$DEST/"; then
  log "pull failed"
  notify "Could not pull the backups from the server. It will try again at the next run."
  exit 1
fi

find "$DEST" -name 'barakah-*.dump.age' -mtime +"$KEEP_DAYS" -delete

newest="$(ls -t "$DEST"/barakah-*.dump.age 2>/dev/null | head -1 || true)"
if [ -z "$newest" ]; then
  log "no backups on the server yet"
  notify "No backups on the server yet."
  exit 1
fi

# rsync -t keeps the server's file time, so this is when the VM made the backup.
age_days=$(( ($(date +%s) - $(stat -f %m "$newest")) / 86400 ))
if [ "$age_days" -gt "$STALE_DAYS" ]; then
  log "newest backup is $age_days days old: $(basename "$newest")"
  notify "The server has not made a backup for $age_days days."
  exit 1
fi

log "ok: $(ls "$DEST"/barakah-*.dump.age | wc -l | tr -d ' ') copies, newest $(basename "$newest")"
