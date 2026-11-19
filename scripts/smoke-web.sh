#!/usr/bin/env bash
# Smoke test for the one-container image: API + SSR storefront + admin SPA.
# Usage: scripts/smoke-web.sh <image-tag>
# Runs the image once, in a deployed mode, with throwaway values, and always removes it.
#
# Mode: SMOKE_NODE_ENV, `production` (the image's own default) or `staging`. Both are the modes
# that ship, so the smoke exercises the same config rules (env.schema.ts) and the same Next
# runtime a host will. Staging also turns Swagger on, as the stage environment does for QA.
# The values those modes require are generated per run and are never secrets: a random
# JWT_SECRET and TOTP_ENCRYPTION_KEY, and the RFC 2606 `.invalid` origin for the public URLs,
# the CORS allowlist and SUPABASE_URL (nothing is ever sent there during the smoke).
#
# Database: an unreachable placeholder by default, so the app boots degraded and the database
# checks are skipped. Set SMOKE_DATABASE_URL to a migrated, THROWAWAY Postgres (the e2e
# container, never a shared database) to also prove the image can query it: readiness runs
# $queryRaw through @prisma/adapter-pg, and the public product list runs findMany/count through
# the generated client's query compiler. Those are what scripts/prune-runtime-modules.sh could
# break. A database on the host is reached as host.docker.internal, e.g.
#   SMOKE_DATABASE_URL=postgresql://barakah:barakah@host.docker.internal:5433/barakah_test?schema=public
set -euo pipefail

IMAGE="${1:?usage: smoke-web.sh <image-tag>}"
MODE="${SMOKE_NODE_ENV:-production}"
PORT="${SMOKE_PORT:-3000}"
CURL_OPTS=(--connect-timeout 3 --max-time 10)
HEALTH_WAIT_SECONDS=60
NAME="barakah-smoke-$$"
BASE="${SMOKE_BASE_URL:-http://127.0.0.1:${PORT}}"
FAILURES=0
PLACEHOLDER_ORIGIN="https://smoke.invalid"
# Port 1 inside the container: refused at once, so boot reports the database down without waiting.
PLACEHOLDER_DATABASE_URL="postgresql://smoke:smoke@127.0.0.1:1/smoke"
DATABASE_URL_FOR_SMOKE="${SMOKE_DATABASE_URL:-}"

case "$MODE" in
  production) SWAGGER="false" ;;
  staging) SWAGGER="true" ;;
  *) echo "SMOKE_NODE_ENV must be production or staging (got: $MODE)"; exit 2 ;;
esac
command -v openssl >/dev/null || { echo "FAIL: openssl is required to generate throwaway keys"; exit 2; }

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1; }
trap cleanup EXIT

# Values travel through the environment (`-e NAME` with no value), never on docker's command
# line, and are never printed. host-gateway makes host.docker.internal resolve on Linux runners
# too (Docker Desktop and OrbStack already define it).
if [ -n "$DATABASE_URL_FOR_SMOKE" ]; then DB_LABEL="provided"; else DB_LABEL="placeholder"; fi
echo "smoke: NODE_ENV=$MODE, database $DB_LABEL"
NODE_ENV="$MODE" \
  SWAGGER_ENABLED="$SWAGGER" \
  DATABASE_URL="${DATABASE_URL_FOR_SMOKE:-$PLACEHOLDER_DATABASE_URL}" \
  JWT_SECRET="$(openssl rand -hex 32)" \
  TOTP_ENCRYPTION_KEY="$(openssl rand -base64 32)" \
  APP_PUBLIC_BASE_URL="$PLACEHOLDER_ORIGIN" \
  CORS_ALLOWED_ORIGINS="$PLACEHOLDER_ORIGIN" \
  SUPABASE_URL="$PLACEHOLDER_ORIGIN" \
  SUPABASE_SERVICE_ROLE_KEY="smoke-placeholder" \
  docker run -d --name "$NAME" -p "${PORT}:3000" --add-host=host.docker.internal:host-gateway \
  -e PORT=3000 -e WEB_ENABLED=true -e LOG_LEVEL=warn \
  -e NODE_ENV -e SWAGGER_ENABLED -e DATABASE_URL -e JWT_SECRET -e TOTP_ENCRYPTION_KEY \
  -e APP_PUBLIC_BASE_URL -e CORS_ALLOWED_ORIGINS -e SUPABASE_URL -e SUPABASE_SERVICE_ROLE_KEY \
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

# The environment field proves the mode actually applied, not just that something booted.
check "health"            /api/v1/health          200 application/json "\"environment\":\"$MODE\""
check "storefront root"   /                       307 ""
check "storefront (bn)"   /bn                     200 text/html "<html lang=\"bn\""
check "storefront (en)"   /en                     200 text/html "<html lang=\"en\""
check "admin"             /admin/                 200 text/html "Barakah Bazaar Admin"
check "unknown api path"  /api/v1/does-not-exist  404 application/json
check "auth guard (R1)"   /api/v1/auth/me         401 application/json

# /api/docs sits outside /api/v1, so these also prove the web mount hands the whole /api prefix
# to Nest: in production Nest answers its JSON 404, never a Next page.
if [ "$MODE" = "staging" ]; then
  check "swagger (staging)"     /api/docs  200 text/html "<title>Swagger UI"
else
  check "no docs (production)"  /api/docs  404 application/json
fi

if [ -n "$DATABASE_URL_FOR_SMOKE" ]; then
  check "db readiness"    /api/v1/health/ready      200 application/json '"database":"up"'
  check "db query"        /api/v1/catalog/products  200 application/json '"items":\['
else
  echo "SKIP  database checks (SMOKE_DATABASE_URL not set)"
fi

if [ "$FAILURES" -ne 0 ]; then echo "smoke: $FAILURES check(s) failed"; dump_logs; exit 1; fi
echo "smoke: all checks passed"
