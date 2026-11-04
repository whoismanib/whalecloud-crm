#!/bin/sh
# Healthy when crond is running and the last successful backup (or the container start, before the
# first run) is less than BACKUP_MAX_AGE_HOURS old (default 26 h = daily schedule + margin).
set -eu
: "${BACKUP_DIR:=/backups}"
: "${BACKUP_MAX_AGE_HOURS:=26}"
pgrep crond > /dev/null || { echo "crond not running"; exit 1; }
ref=$BACKUP_DIR/.last_success
[ -f "$ref" ] || ref=$BACKUP_DIR/.started
[ -f "$ref" ] || { echo "no backup yet"; exit 1; }
age=$(($(date +%s) - $(cat "$ref")))
if [ "$age" -gt $((BACKUP_MAX_AGE_HOURS * 3600)) ]; then
  echo "last backup is $((age / 3600)) h old"
  exit 1
fi
echo "ok (last reference $((age / 60)) min ago)"
