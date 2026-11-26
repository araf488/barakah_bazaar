#!/usr/bin/env bash
# One-time (and safely re-runnable) setup of the off-site backup copies the owner's Mac pulls.
#   sudo bash setup-offsite-backup.sh <age-public-key> <path-to-pull-key.pub>
# Both keys are made on the Mac (RUNBOOK, "Off-site backups"); neither private half comes here.
#
# What it does: installs age, stores the owner's age public key, creates the outbox the nightly
# backup writes encrypted copies to, installs the updated backup script, and lets the pull key
# do exactly one thing: read that outbox through rrsync. No shell, no writes, no forwarding.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then echo "Run with sudo." >&2; exit 1; fi
AGE_RECIPIENT="${1:?usage: setup-offsite-backup.sh <age-public-key> <pull-key.pub>}"
PULL_KEY_FILE="${2:?usage: setup-offsite-backup.sh <age-public-key> <pull-key.pub>}"
DEPLOY_USER="${SUDO_USER:-arefin}"
SRC="$(cd "$(dirname "$0")" && pwd)"
OFFSITE_DIR=/var/backups/barakah-offsite

case "$AGE_RECIPIENT" in
  age1*) ;;
  *) echo "The first argument must be an age public key (age1...)." >&2; exit 1 ;;
esac
pull_key="$(cat "$PULL_KEY_FILE")"
case "$pull_key" in
  ssh-ed25519\ *) ;;
  *) echo "The pull key must be an ssh-ed25519 public key." >&2; exit 1 ;;
esac

echo "== age, and python3 for rrsync"
command -v age >/dev/null || { apt-get update; apt-get install -y age; }
# /usr/bin/rrsync is a Python script; Ubuntu server images carry python3, but make sure.
command -v python3 >/dev/null || apt-get install -y python3-minimal

echo "== owner's public key"
install -d -m 755 /etc/barakah
printf '%s\n' "$AGE_RECIPIENT" > /etc/barakah/backup-recipients.txt
chmod 644 /etc/barakah/backup-recipients.txt

echo "== outbox $OFFSITE_DIR"
install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" -m 750 "$OFFSITE_DIR"
install -m 755 "$SRC/db-backup.sh" /usr/local/bin/barakah-db-backup

echo "== read-only pull key"
auth="/home/$DEPLOY_USER/.ssh/authorized_keys"
entry="command=\"/usr/bin/rrsync -ro $OFFSITE_DIR\",restrict $pull_key"
install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" -m 700 "/home/$DEPLOY_USER/.ssh"
touch "$auth"
chown "$DEPLOY_USER:$DEPLOY_USER" "$auth"
chmod 600 "$auth"
key_body="$(printf '%s' "$pull_key" | awk '{print $2}')"
if grep -qF "$key_body" "$auth"; then
  echo "The pull key is already authorised; left as it is."
else
  printf '%s\n' "$entry" >> "$auth"
  echo "Authorised the pull key for read-only access to $OFFSITE_DIR."
fi

echo "== first encrypted backup"
systemctl start barakah-db-backup.service
ls -l "$OFFSITE_DIR"
