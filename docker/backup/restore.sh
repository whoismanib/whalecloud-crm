#!/bin/sh
# Restore helper (docs/release/RUNBOOK-BACKUP-RESTORE.md). Never restores over the live database:
# it restores into a NEW database, which the runbook then validates and swaps in.
#
#   restore.sh list                         # local files and offsite objects
#   restore.sh fetch <file>                 # download <file> and its .sha256 from the bucket
#   restore.sh restore <file> <target-db>   # verify sha256, decrypt, create <target-db>, pg_restore
#   restore.sh verify <db>                  # row counts + audit_log_verify() on <db>
set -eu

: "${BACKUP_DIR:=/backups}"
: "${BACKUP_S3_PREFIX:=backups/}"
export AWS_REQUEST_CHECKSUM_CALCULATION=when_required AWS_RESPONSE_CHECKSUM_VALIDATION=when_required
s3() {
  aws configure set default.s3.addressing_style "${BACKUP_S3_ADDRESSING_STYLE:-virtual}"
  aws ${BACKUP_S3_ENDPOINT:+--endpoint-url "$BACKUP_S3_ENDPOINT"} ${BACKUP_S3_REGION:+--region "$BACKUP_S3_REGION"} s3 "$@"
}
die() { echo "restore: $*" >&2; exit 1; }

cmd=${1:-}
case "$cmd" in
  list)
    echo "# local ($BACKUP_DIR)"
    ls -l "$BACKUP_DIR" | grep '\.dump\.enc$' || true
    if [ -n "${BACKUP_S3_BUCKET:-}" ]; then
      echo "# offsite (s3://$BACKUP_S3_BUCKET/$BACKUP_S3_PREFIX)"
      s3 ls "s3://$BACKUP_S3_BUCKET/$BACKUP_S3_PREFIX" | grep '\.dump\.enc$' || true
    fi
    ;;
  fetch)
    f=${2:?usage: restore.sh fetch <file>}
    [ -n "${BACKUP_S3_BUCKET:-}" ] || die "BACKUP_S3_BUCKET is empty"
    s3 cp --only-show-errors "s3://$BACKUP_S3_BUCKET/$BACKUP_S3_PREFIX$f" "$BACKUP_DIR/$f"
    s3 cp --only-show-errors "s3://$BACKUP_S3_BUCKET/$BACKUP_S3_PREFIX$f.sha256" "$BACKUP_DIR/$f.sha256"
    echo "fetched $BACKUP_DIR/$f"
    ;;
  restore)
    f=${2:?usage: restore.sh restore <file> <target-db>}
    target=${3:?usage: restore.sh restore <file> <target-db>}
    : "${BACKUP_ENCRYPTION_KEY:?BACKUP_ENCRYPTION_KEY is required}"
    export BACKUP_ENCRYPTION_KEY
    case "$target" in *[!a-z0-9_]* | '') die "invalid database name: $target" ;; esac
    [ "$target" != "${PGDATABASE:-wcrm}" ] || die "refusing to restore over the live database ($target)"
    path="$BACKUP_DIR/$(basename "$f")"
    [ -f "$path" ] || die "not found: $path"
    if [ -f "$path.sha256" ]; then
      (cd "$BACKUP_DIR" && sha256sum -c "$(basename "$path").sha256") || die "checksum mismatch"
    else
      echo "restore: WARNING no .sha256 next to $path"
    fi
    exists=$(psql -tA -d postgres -c "SELECT 1 FROM pg_database WHERE datname = '$target'")
    [ "$exists" != "1" ] || die "database $target already exists (drop it or pick another name)"
    psql -v ON_ERROR_STOP=1 -d postgres -c "CREATE DATABASE $target"
    if ! openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_ENCRYPTION_KEY -in "$path" \
      | pg_restore --no-owner --exit-on-error -d "$target"; then
      die "restore failed (wrong BACKUP_ENCRYPTION_KEY or corrupt file); drop the partial database: DROP DATABASE $target"
    fi
    echo "restored $path into $target"
    ;;
  verify)
    db=${2:?usage: restore.sh verify <db>}
    psql -v ON_ERROR_STOP=1 -d "$db" <<-'SQL'
	SELECT 'users' AS t, count(*) FROM users
	UNION ALL SELECT 'accounts', count(*) FROM accounts
	UNION ALL SELECT 'opportunities', count(*) FROM opportunities
	UNION ALL SELECT 'invoices', count(*) FROM invoices
	UNION ALL SELECT 'audit_log', count(*) FROM audit_log;
	SELECT * FROM audit_log_verify();
SQL
    ;;
  *)
    sed -n '2,9p' "$0"
    exit 2
    ;;
esac
