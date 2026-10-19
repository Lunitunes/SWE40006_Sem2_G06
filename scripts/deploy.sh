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

# compose.production.yaml requires IMAGE_TAG for every command (logs, exec...), not just `up`;
# start_stack overrides it per call when rolling back
export IMAGE_TAG="$NEW_TAG"

# Restarting the backend during a deploy is expected, not an incident, so its alerts are muted
# while the stack is replaced (brief: > 99% actionable alerts). The trap unmutes on every exit, so
# if the release (and any rollback) ends up unhealthy, the alerts fire as normal.
SILENCE_ID=""
mute_alerts() {
  SILENCE_ID="$("${COMPOSE[@]}" exec -T alertmanager amtool silence add 'job="backend"' \
    --duration=15m --author=deploy.sh --comment="deploying $NEW_TAG" \
    --alertmanager.url=http://localhost:9093 2>/dev/null || true)"
  if [[ -n "$SILENCE_ID" ]]; then log "backend alerts muted during deploy"; else log "alerts not muted (Alertmanager not running yet)"; fi
}
unmute_alerts() {
  [[ -n "$SILENCE_ID" ]] || return 0
  "${COMPOSE[@]}" exec -T alertmanager amtool silence expire "$SILENCE_ID" \
    --alertmanager.url=http://localhost:9093 >/dev/null 2>&1 && log "backend alerts unmuted" || log "WARNING: could not unmute alerts (silence $SILENCE_ID)"
  SILENCE_ID=""
}
trap unmute_alerts EXIT

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
mute_alerts
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

  # HTTPS through Caddy, when a hostname is configured. Only a warning: the release itself is
  # healthy, and the first certificate can take a little while (or ports 80/443 may not be open yet)
  site="$(grep -E '^SITE_ADDRESS=' .env 2>/dev/null | cut -d= -f2- || true)"
  if [[ -n "$site" && "$site" != :* ]]; then
    for _ in $(seq 1 15); do
      if curl -fsS -o /dev/null --max-time 10 "https://$site/"; then
        log "HTTPS ok: https://$site"
        break
      fi
      sleep 4
    done || true
    curl -fsS -o /dev/null --max-time 10 "https://$site/" ||
      log "WARNING: https://$site is not answering yet; check inbound ports 80/443 and 'docker logs photo-repo-caddy-1'"
    # Grafana's /api/health needs no login
    curl -fsS -o /dev/null --max-time 10 "https://grafana.$site/api/health" &&
      log "HTTPS ok: https://grafana.$site" ||
      log "WARNING: https://grafana.$site is not answering yet (its certificate may still be issuing)"
  fi
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
