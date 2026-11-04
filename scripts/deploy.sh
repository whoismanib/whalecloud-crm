#!/bin/sh
# Host-side deploy helper (runs on the ECS host, in the app directory). Used by deploy.yml and by
# the runbooks (docs/release/RUNBOOK-DEPLOY.md, RUNBOOK-ROLLBACK.md).
#
#   sh scripts/deploy.sh migrate <image-tag>   # set IMAGE_TAG, pull, start db, backup, run migrate
#   sh scripts/deploy.sh rollout               # up -d api worker web backup, wait for healthchecks
#   sh scripts/deploy.sh rollback              # go back to the previous IMAGE_TAG (no migrations)
#   sh scripts/deploy.sh status                # current/previous tag and container health
#   sh scripts/deploy.sh smoke                 # curl https://$DOMAIN/api/health
set -eu

ENV_FILE=${ENV_FILE:-.env.prod}
COMPOSE_FILE=${COMPOSE_FILE:-docker-compose.prod.yml}
[ -f "$ENV_FILE" ] || { echo "missing $ENV_FILE (copy .env.prod.example and fill it)" >&2; exit 1; }
dc() { docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"; }
env_value() { grep -E "^$1=" "$ENV_FILE" | tail -n1 | cut -d= -f2-; }

set_tag() {
  new=$1
  case "$new" in *[!A-Za-z0-9._-]* | '') echo "invalid image tag: $new" >&2; exit 1 ;; esac
  current=$(env_value IMAGE_TAG || true)
  if [ -n "$current" ] && [ "$current" != "$new" ]; then echo "$current" > .previous_image_tag; fi
  if grep -qE '^IMAGE_TAG=' "$ENV_FILE"; then
    sed -i.bak "s/^IMAGE_TAG=.*/IMAGE_TAG=$new/" "$ENV_FILE" && rm -f "$ENV_FILE.bak"
  else
    echo "IMAGE_TAG=$new" >> "$ENV_FILE"
  fi
  echo "IMAGE_TAG: ${current:-<none>} -> $new"
}

wait_healthy() {
  for svc in "$@"; do
    id=$(dc ps -q "$svc")
    [ -n "$id" ] || { echo "$svc is not running" >&2; exit 1; }
    i=0
    while :; do
      st=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id")
      [ "$st" = "healthy" ] && { echo "$svc healthy"; break; }
      i=$((i + 1))
      if [ "$i" -ge 36 ]; then echo "$svc not healthy after 180 s (status: $st)" >&2; dc logs --tail 50 "$svc" >&2; exit 1; fi
      sleep 5
    done
  done
}

cmd=${1:-}
case "$cmd" in
  migrate)
    set_tag "${2:?usage: deploy.sh migrate <image-tag>}"
    dc pull
    dc up -d db
    wait_healthy db
    # Pre-migration backup: the restore point for RUNBOOK-ROLLBACK.md §3 (SKIP_PREDEPLOY_BACKUP=1 skips it).
    if [ "${SKIP_PREDEPLOY_BACKUP:-0}" != "1" ]; then dc run --rm --no-deps backup backup.sh; fi
    dc run --rm migrate
    ;;
  rollout)
    dc up -d --no-deps --remove-orphans api worker web backup
    wait_healthy api worker web backup
    ;;
  rollback)
    [ -s .previous_image_tag ] || { echo "no .previous_image_tag recorded" >&2; exit 1; }
    set_tag "$(cat .previous_image_tag)"
    dc pull api worker web backup
    dc up -d --no-deps api worker web backup
    wait_healthy api worker web backup
    ;;
  status)
    echo "IMAGE_TAG=$(env_value IMAGE_TAG)  previous=$(cat .previous_image_tag 2>/dev/null || echo '-')"
    dc ps
    ;;
  smoke)
    curl -fsS --max-time 10 "https://$(env_value DOMAIN)/api/health" && echo
    ;;
  *)
    sed -n '2,10p' "$0"
    exit 2
    ;;
esac
