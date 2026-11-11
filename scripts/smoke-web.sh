#!/usr/bin/env bash
# Smoke test for the one-container image: API + SSR storefront + admin SPA.
# Usage: scripts/smoke-web.sh <image-tag>
# Runs the image with throwaway, non-secret env (no database, no Redis) and always removes it.
#
# NODE_ENV=development, not production: staging/production demand a real DATABASE_URL,
# Supabase keys, JWT/TOTP secrets, https public URLs and a CORS allowlist (env.schema.ts).
# The image's own default is NODE_ENV=production; this script overrides it for the smoke only.
set -euo pipefail

IMAGE="${1:?usage: smoke-web.sh <image-tag>}"
PORT="${SMOKE_PORT:-3000}"
CURL_OPTS=(--connect-timeout 3 --max-time 10)
HEALTH_WAIT_SECONDS=60
NAME="barakah-smoke-$$"
BASE="${SMOKE_BASE_URL:-http://127.0.0.1:${PORT}}"
FAILURES=0

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1; }
trap cleanup EXIT

docker run -d --name "$NAME" -p "${PORT}:3000" \
  -e NODE_ENV=development -e PORT=3000 -e WEB_ENABLED=true -e LOG_LEVEL=warn \
  "$IMAGE" >/dev/null || { echo "FAIL: container did not start"; exit 1; }

# Prints the last 100 container log lines; used on any failure.
dump_logs() { echo "--- docker logs (last 100) ---"; docker logs --tail 100 "$NAME" 2>&1 || true; }

# Overall wait is bounded by HEALTH_WAIT_SECONDS; each curl is bounded by CURL_OPTS.
ready=0
for _ in $(seq 1 "$HEALTH_WAIT_SECONDS"); do
  code=$(curl -s "${CURL_OPTS[@]}" -o /dev/null -w '%{http_code}' "$BASE/api/v1/health" || true)
  if [ "$code" = "200" ]; then ready=1; break; fi
  if [ "$(docker inspect -f '{{.State.Running}}' "$NAME" 2>/dev/null || echo false)" != "true" ]; then break; fi
  sleep 1
done
if [ "$ready" != "1" ]; then
  echo "FAIL: health never returned 200"; dump_logs; exit 1
fi

# check <label> <path> <expected status> <expected content-type substring> [body ERE]
# Non-2xx statuses are expected for some checks, so curl runs without --fail and the status is
# captured explicitly; a transport failure yields 000 instead of aborting under set -e.
check() {
  local label="$1" path="$2" want_status="$3" want_type="$4" want_body="${5:-}"
  local hdr body status ctype
  hdr=$(mktemp); body=$(mktemp)
  status=$(curl -s "${CURL_OPTS[@]}" -D "$hdr" -o "$body" -w '%{http_code}' "$BASE$path" || true)
  [ -n "$status" ] || status=000
  ctype=$(grep -i '^content-type:' "$hdr" | tr -d '\r' | tr 'A-Z' 'a-z' || true)
  local ok=1
  [ "$status" = "$want_status" ] || ok=0
  if [ -n "$want_type" ]; then case "$ctype" in *"$want_type"*) ;; *) ok=0 ;; esac; fi
  if [ -n "$want_body" ]; then grep -Eq "$want_body" "$body" || ok=0; fi
  if [ "$ok" = "1" ]; then echo "PASS  $label  $path -> $status ${ctype#content-type: }"
  else echo "FAIL  $label  $path -> $status ${ctype} (wanted $want_status $want_type ${want_body})"; FAILURES=$((FAILURES+1)); fi
  rm -f "$hdr" "$body"
}

check "health"            /api/v1/health          200 ""
check "storefront"        /                       200 text/html "<h1[^>]*>Barakah Bazaar</h1>"
check "admin"             /admin/                 200 text/html "Barakah Bazaar Admin"
check "unknown api path"  /api/v1/does-not-exist  404 application/json
check "auth guard (R1)"   /api/v1/auth/me         401 application/json

if [ "$FAILURES" -ne 0 ]; then echo "smoke: $FAILURES check(s) failed"; dump_logs; exit 1; fi
echo "smoke: all checks passed"
