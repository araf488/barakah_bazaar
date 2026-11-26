#!/usr/bin/env bash
# Installs the daily backup pull on this Mac as a launchd agent (no sudo). Safe to re-run.
#   bash deploy/mac/install-backup-pull.sh
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
LABEL=org.barakahstore.backup-pull
BIN_DIR="$HOME/Library/Application Support/BarakahBackup"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/barakah-backup-pull.log"

mkdir -p "$BIN_DIR" "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
install -m 755 "$SRC/backup-pull.sh" "$BIN_DIR/backup-pull.sh"

# Daily at 10:00, after the VM's 03:30 backup; also at login. A run missed while the Mac
# slept happens when it wakes.
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$BIN_DIR/backup-pull.sh</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>10</integer>
    <key>Minute</key>
    <integer>0</integer>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>StandardOutPath</key>
  <string>$LOG</string>
  <key>StandardErrorPath</key>
  <string>$LOG</string>
</dict>
</plist>
PLIST

plutil -lint "$PLIST"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Installed $LABEL. It runs now and daily at 10:00. Log: $LOG"
