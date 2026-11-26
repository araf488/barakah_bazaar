#!/usr/bin/env bash
# Nightly logical backup of the shop database, kept for 14 days. Installed as
# /usr/local/bin/barakah-db-backup and run by barakah-db-backup.timer.
#
# The plain dumps in /var/backups/barakah stay on the VM (root only): they guard against a bad
# migration or a mistaken delete. Once setup-offsite-backup.sh has run, each dump is also
# encrypted with age to the owner's public key into an outbox the owner's Mac pulls every day.
# Only the owner's private key, which never comes to this VM, can open those copies.
set -euo pipefail

DIR=/var/backups/barakah
KEEP_DAYS=14
OFFSITE_DIR=/var/backups/barakah-offsite
RECIPIENTS=/etc/barakah/backup-recipients.txt

install -d -m 700 "$DIR"
name="barakah-$(date +%F).dump"
file="$DIR/$name"
docker exec barakah-postgres pg_dump -U barakah_admin -Fc barakah > "$file.tmp"
mv "$file.tmp" "$file"
chmod 600 "$file"
find "$DIR" -name 'barakah-*.dump' -mtime +"$KEEP_DAYS" -delete

# Off-site copy: only when the owner's key and the outbox exist (setup-offsite-backup.sh).
if [ -s "$RECIPIENTS" ] && [ -d "$OFFSITE_DIR" ] && command -v age >/dev/null; then
  owner="$(stat -c %U "$OFFSITE_DIR")"
  out="$OFFSITE_DIR/$name.age"
  age -R "$RECIPIENTS" -o "$out.tmp" "$file"
  chown "$owner:$owner" "$out.tmp"
  chmod 640 "$out.tmp"
  mv "$out.tmp" "$out"
  find "$OFFSITE_DIR" -name 'barakah-*.dump.age' -mtime +"$KEEP_DAYS" -delete
fi
