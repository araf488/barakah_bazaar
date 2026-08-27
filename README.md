# Barakah Bazaar — API

**Halal. Wholesome. Home-delivered.**

The backend for Barakah Bazaar, Bangladesh's halal-first multi-category commerce
platform. This one API serves all three clients:

| Client                              | Repo     | Talks to                          |
| ----------------------------------- | -------- | --------------------------------- |
| Public storefront (Next.js)         | separate | this API + Supabase Auth/Realtime |
| Admin portal (React + Vite)         | separate | this API + Supabase Auth/Storage  |
| Mobile app (Flutter, Android + iOS) | separate | this API + `supabase_flutter`     |

**Categories:** Dry Fruits · Doi · Rosmalai · Fresh Fruit · Grocery · Health &
Beauty (Baby / Men / Women)

**Stack:** NestJS 11 (TypeScript) · Supabase (Postgres + Auth + Storage +
Realtime) · Prisma 7 · Redis/BullMQ · pino

---

## Status

This is a **walking skeleton**: the cross-cutting machinery is built and tested,
and one feature module (Catalog) is implemented end to end as the pattern every
other module copies.

| Built                                                                                                                                                                                                                                                                     | Planned                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Config + fail-fast env validation, structured logging, correlation ids, global error contract, CORS policy, Supabase JWT auth guard, role guard, Prisma + driver adapter, RLS policies, health/readiness probes, money (poysha) primitives, Swagger, **Catalog** read API | User, Inventory, Cart, Order, Payment, Delivery, Promotion, Notification, Review, Admin, Search, Storage — each has a folder with a README stating its responsibility, owned tables and phase |

245 tests pass (233 unit across 20 suites + 12 end-to-end). The end-to-end suite boots the whole
app with **no** Supabase project, **no** database and **no** Redis, and asserts
it still serves probes, keeps public routes public and protected routes
protected — so `git clone && npm install && npm start` works on day one.

---

## Architecture

```
        ┌──────────────────────┐   ┌──────────────────────┐   ┌──────────────────────┐
        │  Public Storefront   │   │    Admin Portal      │   │   Flutter App        │
        │  (Next.js, SSR/SEO)  │   │  (React + Vite SPA)  │   │  (Android + iOS)     │
        └──────────┬───────────┘   └──────────┬───────────┘   └──────────┬───────────┘
                   │                          │                          │
                   │  REST /api/v1  (Supabase access token as Bearer)    │
                   └──────────────┬───────────┴──────────────┬───────────┘
                                  ▼                          │
                  ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓           │ Supabase SDK direct:
                  ┃      THIS REPO — NestJS      ┃           │ auth session, Realtime
                  ┃                              ┃           │ order tracking, Storage
                  ┃  Guards → Controller         ┃           │ reads
                  ┃      → Service (rules)       ┃           │
                  ┃      → Repository (Prisma)   ┃           │
                  ┃                              ┃           │
                  ┃  Verifies JWTs locally.      ┃           │
                  ┃  Owns every business write.  ┃           │
                  ┗━━━━━━━━━━┳━━━━━━━━━━━━┳━━━━━━┛           │
                             │            │                  │
              service_role   │            │ BullMQ           │
              (bypasses RLS) │            ▼                  │
                             │      ┌───────────┐            │
                             │      │   Redis   │            │
                             │      └───────────┘            │
                             ▼                               ▼
                  ┌────────────────────────────────────────────────────┐
                  │  SUPABASE (Singapore region)                       │
                  │  Postgres + RLS · Auth · Storage · Realtime        │
                  └────────────────────────────────────────────────────┘
```

### What Supabase owns vs. what this API owns

The central rule: **Supabase may make a client write possible; that does not
make it allowed.** Reads of public data can go direct. Anything involving money,
stock or order state goes through this API.

| Concern                                | Owner                 | Why                                                                                                   |
| -------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------- |
| Postgres hosting, backups, PITR        | Supabase              | Managed; no database to operate                                                                       |
| Authentication, sessions, JWT issuance | Supabase Auth         | Saves weeks vs. hand-rolling refresh tokens                                                           |
| Product / review image storage         | Supabase Storage      | S3-compatible with a CDN; clients upload via signed URL, never through this process                   |
| Live order status, live stock          | Supabase Realtime     | Clients subscribe to filtered row changes; no custom WebSocket layer needed                           |
| Catalog reads                          | **Either**            | Direct via RLS, or through this API for caching and search. This API is the recommended path at scale |
| Cart, checkout, pricing, order state   | **This API only**     | Needs server-authoritative price recalculation and stock locking                                      |
| Payment initiation, webhooks, refunds  | **This API only**     | Signature verification, idempotency and reconciliation do not belong in RLS policies                  |
| Inventory writes                       | **This API only**     | Must be transactional with orders, or you oversell                                                    |
| Scheduled and async work               | **This API** (BullMQ) | Retries and observability; Supabase has no job queue                                                  |

RLS is a **second** line of defence, not the business-logic layer. `orders`,
`payments` and `inventory` will have **no** policy for `anon`/`authenticated` at
all — absence of a policy is a denial.

---

## Quick start

**Prerequisites:** Node 20.11+ (developed on 26), npm 10+. Docker only if you
want local Redis. A Supabase project is _not_ required to boot.

```bash
git clone <this-repo> && cd barakah_bazaar
npm install                 # postinstall runs `prisma generate`
cp .env.example .env         # works as-is; fill in Supabase when you have it
npm run start:dev
```

Then:

```bash
curl http://localhost:3000/api/v1/health          # 200, status "degraded"
curl http://localhost:3000/api/v1/catalog/categories
open  http://localhost:3000/api/docs              # Swagger (SWAGGER_ENABLED=true)
```

With no credentials configured the app reports itself **degraded** rather than
crashing: `checks.database` is `down`, and unconfigured optional dependencies
read `disabled`. That is the intended fresh-clone state.

### Connecting a Supabase project

1. Create the project in the **Singapore** region (closest to Bangladesh).
2. Copy `DATABASE_URL` / `DIRECT_URL` from _Project Settings → Database_, and the
   keys from _Project Settings → API_, into `.env`.
3. Push the schema and the RLS policies:

   ```bash
   npm run db:migrate       # prisma migrate dev — creates tables
   npm run db:rls           # applies prisma/rls/001_enable_rls.sql (idempotent)
   ```

4. Create the Storage buckets: `product-images` (public), `review-images`
   (public, moderated), `vendor-documents` (private).

`npm run db:rls` is a **separate step on purpose** — Prisma cannot express RLS,
so policies live in SQL and must be re-applied after any migration that adds a
table. See [prisma/rls/001_enable_rls.sql](prisma/rls/001_enable_rls.sql).

---

## Environment

Full annotated list in [.env.example](.env.example). Validation runs at boot and
fails with every problem at once, so a bad deploy is diagnosed in one pass.

| Variable                     | Required          | Notes                                                                          |
| ---------------------------- | ----------------- | ------------------------------------------------------------------------------ |
| `NODE_ENV`                   | no                | `development` \| `test` \| `staging` \| `production`                           |
| `PORT`                       | no                | Default `3000`                                                                 |
| `API_PREFIX` / `API_VERSION` | no                | Routes mount at `/{prefix}/{version}` → `/api/v1`                              |
| `LOG_LEVEL`                  | no                | pino level; `silent` in tests                                                  |
| `CORS_ALLOWED_ORIGINS`       | **in production** | Comma-separated. Empty = no cross-origin browser call allowed                  |
| `SWAGGER_ENABLED`            | no                | Rejected in production                                                         |
| `DATABASE_URL`               | **in production** | Used by the running app. Direct connection (5432) suits a long-lived container |
| `DIRECT_URL`                 | for migrations    | Direct/session-mode connection. DDL over the Supavisor pooler is unreliable    |
| `SUPABASE_URL`               | **in production** | Also used to derive the JWKS URL                                               |
| `SUPABASE_ANON_KEY`          | no                | Client-safe                                                                    |
| `SUPABASE_SERVICE_ROLE_KEY`  | **in production** | **Bypasses RLS. Server-side only — never in a client bundle**                  |
| `SUPABASE_JWKS_URL`          | no                | Explicit key set; wins over everything else                                    |
| `SUPABASE_JWT_SECRET`        | no                | Legacy HS256 secret; wins over a URL-derived key set                           |
| `SUPABASE_JWT_AUDIENCE`      | no                | Default `authenticated`                                                        |
| `QUEUE_ENABLED`, `REDIS_*`   | no                | BullMQ is off unless enabled                                                   |
| `SMS_PROVIDER`, `SMS_*`      | no                | `noop` by default, so tests spend no SMS credits                               |

In production the app additionally refuses to start if Swagger is enabled, the
CORS allowlist is empty, or no JWT verification method is configured.

---

## Scripts

| Command                     | Does                                                        |
| --------------------------- | ----------------------------------------------------------- |
| `npm run start:dev`         | Watch-mode dev server                                       |
| `npm run build`             | Compile to `dist/` (entry `dist/main.js`)                   |
| `npm run start:prod`        | Run the compiled build                                      |
| `npm test`                  | Unit tests                                                  |
| `npm run test:e2e`          | End-to-end degraded-boot suite                              |
| `npm run test:cov`          | Coverage                                                    |
| `npm run lint` / `lint:fix` | ESLint (includes the quality gates below)                   |
| `npm run format`            | Prettier                                                    |
| `npm run prisma:generate`   | Regenerate the Prisma client                                |
| `npm run db:migrate`        | `prisma migrate dev`                                        |
| `npm run db:deploy`         | `prisma migrate deploy` (CI/production)                     |
| `npm run db:rls`            | Apply RLS policies — run after every table-adding migration |
| `npm run db:studio`         | Prisma Studio                                               |

---

## Layout

```
src/
  main.ts                    bootstrap: pipes, CORS, Swagger, shutdown hooks
  app.module.ts              modular-monolith root; global guards and filter
  swagger.ts                 OpenAPI document — the contract all 3 clients share
  config/                    env schema (zod), validation, logger params
  common/
    constants/               app-wide constants and the user-facing message contract
    cors/                    CorsPolicyConfigurator (allowlist, wildcard subdomains)
    decorators/              @Public, @Roles, @CurrentUser
    dto/                     pagination query + paginated envelope
    filters/                 GlobalExceptionFilter — the single error shape
    guards/                  SupabaseAuthGuard, RolesGuard
    money/                   poysha integer arithmetic + BigInt JSON safety net
    types/                   AuthenticatedUser, ServiceResponse
  infra/
    prisma/                  PrismaService (pg driver adapter), generated-client barrel
    supabase/                JWT verifier, service_role admin client
    redis/                   BullMQ registration, gated by QUEUE_ENABLED
  modules/
    health/       ✅  liveness + readiness with per-dependency detail
    auth/         ✅  local user mirror, GET /auth/me, SMS/OTP ports
    catalog/      ✅  reference vertical slice — copy this one
    user/ inventory/ cart/ order/ payment/ delivery/
    promotion/ notification/ review/ admin/ search/ storage/
                  🚧  folder + README (responsibility, owned tables, phase)
  generated/prisma/          Prisma output — untracked, rebuilt on install
prisma/
  schema.prisma              single source of truth for schema
  rls/001_enable_rls.sql     Row Level Security, applied by `npm run db:rls`
prisma.config.ts             Prisma 7 CLI config (connection URLs live here)
test/
  degraded-boot.e2e-spec.ts  proves a fresh clone runs
  support/                   shared mocks and fixtures
```

### API surface today

| Method | Route                            | Auth   | Notes                                       |
| ------ | -------------------------------- | ------ | ------------------------------------------- |
| `GET`  | `/api/v1/health`                 | public | Always 200 while the process lives          |
| `GET`  | `/api/v1/health/ready`           | public | 503 when the database is unreachable        |
| `GET`  | `/api/v1/auth/me`                | Bearer | Provisions the local user row on first call |
| `GET`  | `/api/v1/catalog/categories`     | public | Category tree                               |
| `GET`  | `/api/v1/catalog/products`       | public | Paged, filterable, searchable               |
| `GET`  | `/api/v1/catalog/products/:slug` | public | Product detail                              |

---

## Conventions

These are enforced, not aspirational. `npm run lint` fails the build on most of
them; the rest are covered by tests.

### 1. Money is integer poysha, never a float

1 BDT = 100 poysha. Every monetary column is `BigInt`; every monetary field on
the wire is an integer number of poysha. The only float boundary is
`Money.fromTaka`, which rounds once at the edge.

```ts
Money.fromTaka(12.345); // 1235n
Money.forWeight(80_000n, 500); // 40000n — half a kilo, rounded half-up
Money.multiply(12_550n, 3); // 37650n
```

Weight-priced products (fresh fruit, dry fruit) are computed server-side with
`Money.forWeight`. A client-supplied price is ignored, always.

### 2. Four layers, one direction

`Controller → Service → Repository → Prisma`, with a mapper owning the wire
shape. A service never touches Prisma; a repository never decides an HTTP status.

### 3. Nothing throws across a layer boundary

Services return `ServiceResponse<T>` — `{ ok: true, data }` or
`{ ok: false, status, message }`. Repositories return `null` (or an empty list)
on failure. The controller is the only place that turns a failure into an HTTP
error, via `unwrapOrThrow`. Every public method on all three layers wraps its
body in `try`/`catch`.

```ts
// service
if (page === null) {
  return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
}

// controller
return unwrapOrThrow(await this.catalogService.listProducts(query));
```

Guards are the exception: they are the HTTP authentication boundary and throw
the matching `HttpException` directly.

### 4. Structured logging, exception object first

```ts
this.logger.error({ err: error, slug }, 'Exception occurred in CatalogService.getProductBySlug');
```

The message stays a compile-time literal; context goes in the object. Never log
a credential, token, OTP or card number — `logger.config.ts` redacts the
Authorization header, cookies and common secret body fields, and the noop SMS
gateway logs message _length_, never the body.

### 5. No magic strings

User-facing messages live in `ErrorMessages`; domain values live in the module's
own `<module>.constants.ts`. Structured log templates stay inline at the call
site (hoisting them breaks the logger's template contract), and tests assert the
**literal** expected string rather than the production constant — asserting
against the constant cannot fail when the message changes.

### 6. Cognitive complexity ≤ 15

Machine-checked by `sonarjs/cognitive-complexity`. Also on: nested conditionals,
identical functions, commented-out code, unused imports, `max-params: 7`.

### 7. Tests for every layer you touch, in the same commit

Controller, service, repository, mapper, guard, validator — not just the
interesting one. Assert on observable output (status code, body, the payload
handed to a collaborator) over mock call counts where a real assertion exists.

### 8. RLS in the same commit as the table

A new table means `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` in
`prisma/rls/`, plus a policy **only** if a client legitimately needs to read
those rows. Money and stock tables get no `anon`/`authenticated` policy. Ever.

---

## Authentication

Supabase Auth issues tokens; this API verifies them locally and never calls out
per request.

- `SupabaseAuthGuard` is registered **globally** — every route requires a
  verified token unless marked `@Public()`. Forgetting the decorator fails
  closed.
- Verification uses a remote JWKS (cached, auto-rotating) or the legacy HS256
  secret. Precedence: explicit `SUPABASE_JWKS_URL` → `SUPABASE_JWT_SECRET` →
  JWKS derived from `SUPABASE_URL`. Checking the secret before the derived URL is
  what keeps older HS256 projects working when both are set.
- With nothing configured the verifier reports `disabled` and protected routes
  answer **503** instead of the app refusing to boot.
- `app_metadata.role` drives `@Roles(...)`. An absent or unrecognised claim is
  treated as `CUSTOMER` — privilege is never inferred from an unexpected value.
- Supabase `app_metadata.role` is the **source of truth**; `users.role` mirrors
  it on every authenticated request. Role changes go through the Supabase Admin
  API (Admin module), not a direct column write.

### Phone OTP — the Bangladesh gotcha

Supabase Auth's built-in phone provider supports only Twilio, MessageBird,
Vonage and TextLocal — **none** of the local gateways (Alpha SMS, SSL Wireless,
operator aggregators), which are cheaper and more reliable for BD numbers.

So phone login is a **custom flow in this API**: generate and verify the OTP
here, send it through a local gateway, then create/sign in the user via the
Supabase Admin API. The seams already exist —
[`ports/sms-gateway.port.ts`](src/modules/auth/ports/sms-gateway.port.ts) and
[`ports/otp.port.ts`](src/modules/auth/ports/otp.port.ts) — with
`NoopSmsGateway` wired up for development. `OtpService` is deliberately
**unimplemented**: it needs a chosen gateway plus Redis-backed challenge
storage, both Phase 1 decisions.

---

## Database

Prisma owns the schema. **Do not edit tables in the Supabase dashboard** once a
migration exists — the two will drift.

Prisma 7 specifics worth knowing before your first migration:

- Connection URLs live in [prisma.config.ts](prisma.config.ts), **not** in
  `schema.prisma`.
- The runtime client takes a **driver adapter** (`@prisma/adapter-pg`) rather
  than a URL — see [prisma.service.ts](src/infra/prisma/prisma.service.ts).
- The client is generated as TypeScript into `src/generated/prisma`, which is
  untracked and rebuilt by `postinstall`. Import Prisma types through
  [`prisma-client.ts`](src/infra/prisma/prisma-client.ts), never from the
  generated path directly.

Phase 0 covers `users`, `addresses`, `categories`, `products`,
`product_variants` and `product_images`, including the perishable fields that
drive delivery rules: `isPerishable`, `shelfLifeHours`, `storageType`,
`maxDeliveryDistanceKm`.

---

## Testing

```bash
npm test                                    # 233 unit tests, 20 suites
npm run test:e2e                            # 12 end-to-end tests
npm test -- catalog                         # one feature (path pattern)
```

The end-to-end suite is the one to keep green above all others: it configures
the environment **before** importing `AppModule` (because
`ConfigModule.forRoot()` validates eagerly at import time) and asserts the app
boots with nothing configured. It has already caught one dependency-injection
bug that every unit test missed.

---

## Deployment

Supabase hosts Postgres, Auth, Storage and Realtime. This API deploys separately
as a container — Fly.io, Railway, Render or ECS.

```bash
docker build -t barakah-bazaar-api .
docker compose up -d redis          # local Redis only; Postgres lives in Supabase
```

> The `Dockerfile` and `docker-compose.yml` are written but **unverified** —
> Docker is not installed on the machine this repo was scaffolded on. Build them
> once before relying on them in CI.

Production checklist:

- `NODE_ENV=production`, `SWAGGER_ENABLED=false` (the app enforces this)
- `CORS_ALLOWED_ORIGINS` listing the storefront and admin origins explicitly
- Enable **Point-in-Time Recovery** on Supabase before launch; the free tier's
  retention is not enough for a live store
- `npm run db:deploy && npm run db:rls` as an ordered CI step
- Point the deployment gate at `/api/v1/health/ready`, not `/api/v1/health`

---

## Roadmap

| Phase  | Scope                                                                                            | State         |
| ------ | ------------------------------------------------------------------------------------------------ | ------------- |
| 0      | Foundation: repo, CI, Supabase project, core schema                                              | this scaffold |
| 1      | Auth, User, Catalog, Inventory, Cart, Order, first payment (bKash + COD)                         | next          |
| 2 / 2B | Storefront and Admin portal (separate repos)                                                     |               |
| 3      | Flutter app                                                                                      |               |
| 4      | Perishable logistics: slot cutoffs, cold chain, hub radius, own-fleet dispatch                   |               |
| 5      | Remaining gateways (Nagad, Rocket, SSLCommerz), couriers (Pathao/RedX/Steadfast), SMS end to end |               |
| 6      | Search upgrade, reviews, promotions, subscriptions, multi-vendor, loyalty                        |               |
| 7      | Load testing, security audit, Digital Commerce Guideline compliance, soft launch                 |               |

Each stub module's README names its phase. The full product plan lives outside
this repo — keep a copy in `docs/` so it stays alongside the code it describes.

---

## Contributing

Conventional Commits, enforced by commitlint. `lint-staged` runs ESLint and
Prettier on staged files. Before opening a PR:

```bash
npm run lint && npm test && npm run test:e2e && npm run build
```

New module? Copy `src/modules/catalog` and read the target module's README
first — it already lists the responsibility, owned tables and the traps.
