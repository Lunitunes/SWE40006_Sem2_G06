#!/usr/bin/env bash
# Runs ON the EC2 instance, from the deploy folder (~/photo-repo). Called by .github/workflows/deploy.yaml
# after it has copied the images, compose files, monitoring config and .env over.
#
#   scripts/deploy.sh <image-tag>
#
# 1. Loads the new images and starts the stack (app + monitoring) with that tag.
# 2. Checks the backend, database and frontend are actually serving.
# 3. If not, rolls back to the last tag that passed (brief: rollback to stable build in < 120 s)
#    and exits non-zero, so the workflow run is marked failed.
set -euo pipefail

NEW_TAG="${1:?usage: scripts/deploy.sh <image-tag>}"
cd "$(dirname "$0")/.."

COMPOSE=(docker compose -p photo-repo -f compose.production.yaml -f compose.monitoring.yaml)
# Lets the stack be test-deployed on Docker Desktop (adds compose.desktop.yaml); unset on EC2
if [[ -n "${DEPLOY_EXTRA_COMPOSE:-}" ]]; then COMPOSE+=(-f "$DEPLOY_EXTRA_COMPOSE"); fi

STATE_FILE=.deployed-tag # last tag that passed the health checks
PREVIOUS_TAG="$(cat "$STATE_FILE" 2>/dev/null || true)"
HEALTH_TIMEOUT_SECONDS="${HEALTH_TIMEOUT_SECONDS:-60}"

log() { echo "[deploy $(date -u +%H:%M:%S)] $*"; }

start_stack() {
  IMAGE_TAG="$1" "${COMPOSE[@]}" up -d --no-build --pull never --remove-orphans
}

healthy() {
  local deadline=$((SECONDS + HEALTH_TIMEOUT_SECONDS))
  while ((SECONDS < deadline)); do
    # Backend up AND database reachable (503 otherwise), and the frontend serving pages
    if curl -fsS -o /dev/null http://localhost:3001/health/ready && curl -fsS -o /dev/null http://localhost:3000/; then
      return 0
    fi
    sleep 2
  done
  return 1
}

# Keep the current and previous images for rollback; delete older ones so the disk doesn't fill up
prune_images() {
  local keep=("$NEW_TAG" "$PREVIOUS_TAG")
  for repo in photo-backend photo-frontend; do
    docker image ls "$repo" --format '{{.Tag}}' | while read -r tag; do
      [[ " ${keep[*]} " == *" $tag "* ]] || docker image rm -f "$repo:$tag" >/dev/null 2>&1 || true
    done
  done
}

if [[ -f images.tar.gz ]]; then
  log "loading images"
  docker load -i images.tar.gz
fi

log "deploying $NEW_TAG (previous stable: ${PREVIOUS_TAG:-none})"
start_stack "$NEW_TAG"

if healthy; then
  echo "$NEW_TAG" >"$STATE_FILE"
  # Config files are bind-mounted, so changed alert rules / Alertmanager settings from this
  # release are only picked up after a reload (a running container isn't recreated for them)
  curl -fsS -X POST http://localhost:9090/-/reload >/dev/null && log "prometheus config reloaded" || log "prometheus reload skipped"
  curl -fsS -X POST http://localhost:9093/-/reload >/dev/null && log "alertmanager config reloaded" || log "alertmanager reload skipped"
  prune_images
  rm -f images.tar.gz
  log "deployment successful: $NEW_TAG is live"
  exit 0
fi

log "health checks failed for $NEW_TAG; recent logs:"
"${COMPOSE[@]}" logs --tail=40 backend frontend || true

if [[ -z "$PREVIOUS_TAG" || "$PREVIOUS_TAG" == "$NEW_TAG" ]]; then
  log "no previous stable release to roll back to"
  exit 1
fi

rollback_started=$SECONDS
log "rolling back to $PREVIOUS_TAG"
start_stack "$PREVIOUS_TAG"
if healthy; then
  log "ROLLED BACK to $PREVIOUS_TAG in $((SECONDS - rollback_started))s; $NEW_TAG was not kept"
else
  log "rollback to $PREVIOUS_TAG is also unhealthy; manual intervention needed"
fi
exit 1
