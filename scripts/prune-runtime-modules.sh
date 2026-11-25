#!/bin/sh
# Removes packages that `npm prune --omit=dev` keeps but the runtime image never loads.
# Usage: prune-runtime-modules.sh <app dir containing node_modules>
#
# Why prune leaves them: @prisma/client declares `prisma` and `typescript` as optional peer
# dependencies. The root package installs both (as devDependencies), so the lockfile records
# them as reachable from a production package and --omit=dev keeps them, together with
# everything the Prisma CLI pulls in (about 400 MB). Nothing in the image runs that CLI:
# migrations run on the CI runner in the deploy job, and the app reaches Postgres through
# @prisma/adapter-pg and the client generated into dist/.
#
# Names are explicit on purpose. A stale name is a harmless no-op (the image is only bigger);
# a wildcard could delete something the runtime needs. After deleting, the script fails the
# build if a module the runtime does load no longer resolves.
# `scripts/smoke-web.sh` with SMOKE_DATABASE_URL set proves the pruned image still queries.
set -eu

APP_DIR="${1:?usage: prune-runtime-modules.sh <app dir containing node_modules>}"
MODULES="$APP_DIR/node_modules"
if [ ! -d "$MODULES/@prisma/client" ]; then
  echo "prune-runtime-modules: $MODULES/@prisma/client not found; refusing to prune" >&2
  exit 1
fi
cd "$MODULES"

# The Prisma CLI (migrate, generate, studio).
rm -rf prisma
# Optional peer of @prisma/client for generated types only; nothing compiles at runtime.
rm -rf typescript
# Type declarations; Node never loads them.
rm -rf @types
# Prisma CLI internals: local dev server, Studio, config loader, engine download and
# platform detection, and the query-plan executor the CLI's local server uses.
rm -rf @prisma/dev @prisma/studio-core @prisma/config @prisma/engines @prisma/engines-version
rm -rf @prisma/fetch-engine @prisma/get-platform @prisma/streams-local @prisma/query-plan-executor
# Reached only through the packages above: effect and fast-check (@prisma/config),
# @electric-sql/* (@prisma/dev), @visx and elkjs (@prisma/studio-core).
rm -rf effect fast-check @electric-sql @visx elkjs
# sharp's WebAssembly fallback; npm marks it extraneous and the native build is used.
rm -rf @img/sharp-wasm32

# Query compilers for database providers this app does not use (prisma/schema.prisma is
# postgresql). Each provider ships a fast and a small variant, as CJS and ESM, each with a
# loader and an inlined base64 wasm module.
for provider in cockroachdb mysql sqlite sqlserver; do
  for variant in fast small; do
    stem="@prisma/client/runtime/query_compiler_${variant}_bg.${provider}"
    rm -f "$stem.js" "$stem.mjs" "$stem.wasm-base64.js" "$stem.wasm-base64.mjs"
  done
done

# Fail the build, not the first request, if anything the runtime loads went with the rest.
cd "$APP_DIR"
node -e "
for (const name of [
  '@prisma/client/runtime/client',
  '@prisma/client/runtime/query_compiler_fast_bg.postgresql.js',
  '@prisma/client/runtime/query_compiler_fast_bg.postgresql.wasm-base64.js',
  '@prisma/adapter-pg',
  'next',
  'react',
  'react-dom',
]) require.resolve(name);
"
echo "prune-runtime-modules: done"
