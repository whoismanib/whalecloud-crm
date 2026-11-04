#!/bin/sh
# Daily encrypted backup (docs/release/RUNBOOK-BACKUP-RESTORE.md).
#   pg_dump -Fc  →  openssl AES-256-CBC (PBKDF2)  →  /backups  →  S3-compatible bucket (Alibaba OSS)
# Local and remote retention: BACKUP_RETENTION_DAYS (default 14).
# Env: PGHOST PGPORT PGDATABASE PGUSER PGPASSWORD, BACKUP_ENCRYPTION_KEY (required),
#      BACKUP_DIR (/backups), BACKUP_S3_BUCKET, BACKUP_S3_PREFIX, BACKUP_S3_ENDPOINT,
#      BACKUP_S3_REGION, BACKUP_S3_ADDRESSING_STYLE (virtual), AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY.
set -eu

: "${BACKUP_DIR:=/backups}"
: "${BACKUP_RETENTION_DAYS:=14}"
: "${BACKUP_S3_PREFIX:=backups/}"
: "${PGDATABASE:=wcrm}"
: "${BACKUP_ENCRYPTION_KEY:?BACKUP_ENCRYPTION_KEY is required}"
export BACKUP_ENCRYPTION_KEY
# OSS rejects the newer default integrity headers of aws-cli v2; only send them when required.
export AWS_REQUEST_CHECKSUM_CALCULATION=when_required AWS_RESPONSE_CHECKSUM_VALIDATION=when_required

log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) backup: $*"; }
s3() {
  if [ -n "${BACKUP_S3_ADDRESSING_STYLE:-virtual}" ]; then
    aws configure set default.s3.addressing_style "${BACKUP_S3_ADDRESSING_STYLE:-virtual}"
  fi
  aws ${BACKUP_S3_ENDPOINT:+--endpoint-url "$BACKUP_S3_ENDPOINT"} ${BACKUP_S3_REGION:+--region "$BACKUP_S3_REGION"} s3 "$@"
}

mkdir -p "$BACKUP_DIR"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
name="${PGDATABASE}_${stamp}.dump.enc"
tmp="$BACKUP_DIR/.${name}.partial"
trap 'rm -f "$tmp"' EXIT

log "dumping $PGDATABASE from ${PGHOST:-local}"
# set -o pipefail is not POSIX: check pg_dump's status through a marker file instead.
rm -f "$BACKUP_DIR/.dump_failed"
{ pg_dump -Fc --no-password "$PGDATABASE" || touch "$BACKUP_DIR/.dump_failed"; } \
  | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_ENCRYPTION_KEY -out "$tmp"
if [ -e "$BACKUP_DIR/.dump_failed" ]; then
  rm -f "$BACKUP_DIR/.dump_failed"
  log "ERROR pg_dump failed"
  exit 1
fi
mv "$tmp" "$BACKUP_DIR/$name"
(cd "$BACKUP_DIR" && sha256sum "$name" > "$name.sha256")
size=$(wc -c < "$BACKUP_DIR/$name" | tr -d ' ')
log "wrote $name ($size bytes)"

if [ -n "${BACKUP_S3_BUCKET:-}" ]; then
  dest="s3://$BACKUP_S3_BUCKET/$BACKUP_S3_PREFIX"
  s3 cp --only-show-errors "$BACKUP_DIR/$name" "$dest$name"
  s3 cp --only-show-errors "$BACKUP_DIR/$name.sha256" "$dest$name.sha256"
  log "uploaded to $dest$name"
else
  log "WARNING BACKUP_S3_BUCKET is empty: offsite copy skipped"
fi

# Retention (local): files older than BACKUP_RETENTION_DAYS days.
find "$BACKUP_DIR" -maxdepth 1 -type f -name "${PGDATABASE}_*.dump.enc*" -mtime "+$((BACKUP_RETENTION_DAYS - 1))" -print -delete \
  | sed 's/^/pruned local: /'

# Retention (remote): by the UTC date in the object name. An OSS lifecycle rule on the prefix is
# recommended as a second safety net (RUNBOOK-BACKUP-RESTORE.md §2).
if [ -n "${BACKUP_S3_BUCKET:-}" ]; then
  cutoff=$(date -u -d "@$(($(date +%s) - BACKUP_RETENTION_DAYS * 86400))" +%Y%m%d)
  s3 ls "s3://$BACKUP_S3_BUCKET/$BACKUP_S3_PREFIX" | awk '{print $4}' | while read -r obj; do
    d=$(echo "$obj" | sed -n "s/^${PGDATABASE}_\([0-9]\{8\}\)T.*/\1/p")
    if [ -n "$d" ] && [ "$d" -lt "$cutoff" ]; then
      s3 rm --only-show-errors "s3://$BACKUP_S3_BUCKET/$BACKUP_S3_PREFIX$obj"
      log "pruned remote: $obj"
    fi
  done
fi

date +%s > "$BACKUP_DIR/.last_success"
log "OK"
