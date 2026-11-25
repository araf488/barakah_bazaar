#!/usr/bin/env bash
# Swaps the running app to an image already loaded on this VM, and rolls back if it cannot
# reach its database (the readiness check). Run by CI as the deploy user: deploy.sh <image-ref>
set -euo pipefail

IMAGE="${1:?usage: deploy.sh <image-ref>}"
APP_DIR="${BARAKAH_DIR:-/opt/barakah}"
HEALTH_URL="http://127.0.0.1:${APP_HOST_PORT:-3100}/api/v1/health/ready"
HEALTH_WAIT_SECONDS="${HEALTH_WAIT_SECONDS:-120}"

cd "$APP_DIR"

current_image() { sed -n 's/^BARAKAH_IMAGE=//p' .env; }

# Rewrites .env through a temp file and a rename, so it is never left half written, and keeps
# its 600 mode (it holds the database passwords).
set_image() {
  local tmp
  tmp="$(mktemp "$APP_DIR/.env.XXXXXX")"
  grep -v '^BARAKAH_IMAGE=' .env > "$tmp" || true
  echo "BARAKAH_IMAGE=$1" >> "$tmp"
  chmod 600 "$tmp"
  mv "$tmp" .env
}

healthy() {
  for _ in $(seq 1 "$HEALTH_WAIT_SECONDS"); do
    if [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "$HEALTH_URL" || true)" = "200" ]; then
      return 0
    fi
    sleep 1
  done
  return 1
}

previous="$(current_image)"
set_image "$IMAGE"
docker compose up -d --remove-orphans

if ! healthy; then
  echo "New image did not become healthy: $IMAGE"
  docker compose logs --tail 80 app || true
  if [ -n "$previous" ] && [ "$previous" != "$IMAGE" ]; then
    echo "Rolling back to $previous"
    set_image "$previous"
    docker compose up -d app
    healthy && echo "Rolled back; the previous image is serving again." || echo "Rollback is unhealthy too."
  fi
  exit 1
fi
echo "Serving $IMAGE"

# Each image is about 1 GB. Keep the one serving and the one before it (the rollback target).
repo="${IMAGE%:*}"
docker images "$repo" --format '{{.Repository}}:{{.Tag}}' \
  | grep -vxF -e "$IMAGE" -e "${previous:-none}" \
  | xargs -r docker rmi || true
docker image prune -f >/dev/null
