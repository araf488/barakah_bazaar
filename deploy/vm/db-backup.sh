#!/usr/bin/env bash
# Nightly logical backup of the shop database, kept for 14 days. Installed as
# /usr/local/bin/barakah-db-backup and run by barakah-db-backup.timer.
# These copies live on the same VM: they guard against a bad migration or a mistaken delete,
# not against losing the VM. Copy them off the machine as well.
set -euo pipefail

DIR=/var/backups/barakah
KEEP_DAYS=14

install -d -m 700 "$DIR"
file="$DIR/barakah-$(date +%F).dump"
docker exec barakah-postgres pg_dump -U barakah_admin -Fc barakah > "$file.tmp"
mv "$file.tmp" "$file"
chmod 600 "$file"
find "$DIR" -name 'barakah-*.dump' -mtime +"$KEEP_DAYS" -delete
