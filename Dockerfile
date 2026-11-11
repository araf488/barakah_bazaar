# One image serves the API, the SSR storefront and the admin SPA (WEB_ENABLED=true).
# Layout must match src/web/web.constants.ts: web/apps/storefront/.next and web/apps/admin/dist
# resolved from the directory above dist/.

# ─── deps stage: one root install across the workspaces, one lockfile ────────
FROM node:22-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY web/apps/storefront/package.json ./web/apps/storefront/package.json
COPY web/apps/admin/package.json ./web/apps/admin/package.json
COPY web/packages/config/package.json ./web/packages/config/package.json
COPY web/packages/tokens/package.json ./web/packages/tokens/package.json
COPY web/packages/ui/package.json ./web/packages/ui/package.json
# postinstall runs prisma generate, which needs the schema copied above.
RUN npm ci

# ─── build stage ──────────────────────────────────────────────────────────────
FROM deps AS builder
COPY tsconfig*.json nest-cli.json ./
COPY src ./src
COPY web ./web
RUN npx prisma generate && npm run build && npm run web:build \
 && rm -rf web/apps/storefront/.next/cache \
 && find web/apps/storefront/.next -name '*.map' -delete \
 && npm prune --omit=dev

# ─── runtime stage ────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV WEB_ENABLED=true
# Node defaults libuv's threadpool to 4, and crypto.scrypt — which every password check runs —
# executes on it, sharing those four threads with all filesystem and DNS work. At the default,
# four concurrent logins stall unrelated requests across the whole app. Not cargo cult: read by
# the Node runtime at startup, so it cannot be set from application code.
ENV UV_THREADPOOL_SIZE=16

RUN addgroup -S nodejs && adduser -S nestjs -G nodejs

# Production-only node_modules, pruned in the build stage (includes next, react, react-dom and
# the workspace symlinks, which point into web/).
COPY --from=builder --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nestjs:nodejs /app/dist ./dist
COPY --from=builder --chown=nestjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nestjs:nodejs /app/web/packages ./web/packages
COPY --from=builder --chown=nestjs:nodejs /app/web/apps/storefront/.next ./web/apps/storefront/.next
COPY --from=builder --chown=nestjs:nodejs /app/web/apps/storefront/public ./web/apps/storefront/public
COPY --from=builder --chown=nestjs:nodejs /app/web/apps/storefront/package.json /app/web/apps/storefront/next.config.mjs ./web/apps/storefront/
COPY --from=builder --chown=nestjs:nodejs /app/web/apps/admin/dist ./web/apps/admin/dist
COPY --chown=nestjs:nodejs package.json ./

USER nestjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main"]
