#!/bin/sh
# Starts busybox crond with the daily backup (BACKUP_CRON, default 02:00 in TZ=America/Santiago).
# `docker compose run --rm backup backup.sh` / `restore.sh ...` run a single command instead.
set -eu
if [ "$#" -gt 0 ]; then exec "$@"; fi
: "${BACKUP_CRON:=0 2 * * *}"
mkdir -p /etc/crontabs "${BACKUP_DIR:-/backups}"
date +%s > "${BACKUP_DIR:-/backups}/.started"
# Cron jobs must not depend on crond passing the container environment: snapshot it (0600).
(umask 077 && export -p > /etc/backup.env)
echo "$BACKUP_CRON . /etc/backup.env; /usr/local/bin/backup.sh >> /proc/1/fd/1 2>&1" > /etc/crontabs/root
echo "backup: schedule '$BACKUP_CRON' (TZ=${TZ:-UTC}), retention ${BACKUP_RETENTION_DAYS:-14} days"
exec crond -f -l 8 -c /etc/crontabs
