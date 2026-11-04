# Backup image (ADR 0005, ARCHITECTURE §14): pg_dump 16 + AES-256 encryption (openssl) + upload to
# an S3-compatible bucket (Alibaba OSS) with aws-cli. Cron via busybox crond. Context: repo root.
FROM postgres:16-alpine
RUN apk add --no-cache aws-cli openssl tzdata ca-certificates
COPY docker/backup/backup.sh docker/backup/restore.sh docker/backup/healthcheck.sh docker/backup/entrypoint.sh /usr/local/bin/
RUN chmod 0755 /usr/local/bin/backup.sh /usr/local/bin/restore.sh /usr/local/bin/healthcheck.sh /usr/local/bin/entrypoint.sh \
  && mkdir -p /backups && chown postgres:postgres /backups
VOLUME ["/backups"]
HEALTHCHECK --interval=5m --timeout=10s --start-period=1m CMD /usr/local/bin/healthcheck.sh
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
