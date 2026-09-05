# Barakah Bazaar — API

**Halal. Wholesome. Home-delivered.**

The backend for Barakah Bazaar, Bangladesh's halal-first multi-category commerce
platform. This one API serves all three clients:

| Client                              | Repo     | Talks to                      |
| ----------------------------------- | -------- | ----------------------------- |
| Public storefront (Next.js)         | separate | this API + Supabase Realtime  |
| Admin portal (React + Vite)         | separate | this API + Supabase Storage   |
| Mobile app (Flutter, Android + iOS) | separate | this API + `supabase_flutter` |

Every client signs in against **this API** — see [Authentication](#authentication).
The Supabase SDK is used only for Realtime subscriptions, Storage and direct
catalog reads, never for identity.

**Categories:** Dry Fruits · Doi · Rosmalai · Fresh Fruit · Grocery · Health &
Beauty (Baby / Men / Women)

**Stack:** NestJS 11 (TypeScript) · Supabase (Postgres + Storage + Realtime) ·
Prisma 7 · Redis/BullMQ · pino

---

## Status

This is a **walking skeleton**: the cross-cutting machinery is built and tested,
and one feature module (Catalog) is implemented end to end as the pattern every
other module copies.

| Built                                                                                                                                                                                                                                                                                                                                   | Planned                                                                                                                                                                                 |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Config + fail-fast env validation, structured logging, correlation ids, global error contract, CORS policy, Supabase JWT auth guard, role guard, Prisma + driver adapter, RLS policies, health/readiness probes, money (poysha) primitives, Swagger, **Catalog** read API, **Geo** reference geography, **User** profile + address book | Inventory, Cart, Order, Payment, Delivery, Promotion, Notification, Review, Admin, Search, Storage — each has a folder with a README stating its responsibility, owned tables and phase |

909 tests pass (879 unit across 53 suites + 30 end-to-end). The end-to-end suite boots the whole
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
                   │  REST /api/v1  (this API's access token as Bearer)  │
                   └──────────────┬───────────┴──────────────┬───────────┘
                                  ▼                          │
                  ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓           │ Supabase SDK direct:
                  ┃      THIS REPO — NestJS      ┃           │ Realtime order
                  ┃                              ┃           │ tracking, Storage,
                  ┃  Guards → Controller         ┃           │ catalog reads
                  ┃      → Service (rules)       ┃           │
                  ┃      → Repository (Prisma)   ┃           │
                  ┃                              ┃           │
                  ┃  Issues and verifies its own ┃           │
                  ┃  tokens. Owns every write.   ┃           │
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
                  │  Postgres + RLS · Storage · Realtime               │
                  └────────────────────────────────────────────────────┘
```

### What Supabase owns vs. what this API owns

The central rule: **Supabase may make a client write possible; that does not
make it allowed.** Reads of public data can go direct. Anything involving money,
stock or order state goes through this API.

| Concern                                | Owner                 | Why                                                                                                   |
| -------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------- |
| Postgres hosting, backups, PITR        | Supabase              | Managed; no database to operate                                                                       |
| Authentication, sessions, JWT issuance | **This API only**     | Every access decision reads this API's own tables; no third party is consulted or trusted             |
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

| Variable                     | Required                    | Notes                                                                          |
| ---------------------------- | --------------------------- | ------------------------------------------------------------------------------ |
| `NODE_ENV`                   | no                          | `development` \| `test` \| `staging` \| `production`                           |
| `PORT`                       | no                          | Default `3000`                                                                 |
| `API_PREFIX` / `API_VERSION` | no                          | Routes mount at `/{prefix}/{version}` → `/api/v1`                              |
| `LOG_LEVEL`                  | no                          | pino level; `silent` in tests                                                  |
| `CORS_ALLOWED_ORIGINS`       | **in staging & production** | Comma-separated. Empty = no cross-origin browser call allowed                  |
| `SWAGGER_ENABLED`            | no                          | Rejected in production                                                         |
| `DATABASE_URL`               | **in staging & production** | Used by the running app. Direct connection (5432) suits a long-lived container |
| `DIRECT_URL`                 | for migrations              | Direct/session-mode connection. DDL over the Supavisor pooler is unreliable    |
| `SUPABASE_URL`               | **in staging & production** | Storage only — signing upload URLs                                             |
| `SUPABASE_SERVICE_ROLE_KEY`  | **in staging & production** | **Bypasses RLS. Server-side only — never in a client bundle**                  |
| `JWT_SECRET`                 | **in staging & production** | HS256, ≥32 chars. Unset, each process signs with its own random key            |
| `TOTP_ENCRYPTION_KEY`        | **in staging & production** | base64, 32 bytes. Unset, no staff member with MFA can sign in                  |
| `APP_PUBLIC_BASE_URL`        | **https in staging & prod** | Base for verification and reset links, which carry a credential                |
| `QUEUE_ENABLED`, `REDIS_*`   | no                          | BullMQ is off unless enabled                                                   |
| `SMS_PROVIDER`, `SMS_*`      | no                          | `noop` by default, so tests spend no SMS credits                               |

In any deployed environment (`staging` or `production`) the app additionally
refuses to start if the CORS allowlist is empty or `APP_PUBLIC_BASE_URL` is not
https. In production it also refuses to start if Swagger is enabled.

### Environment matrix

Every deployed environment must set `NODE_ENV` explicitly. The container image
defaults to `production`, so an unset `NODE_ENV` on the stage host makes the app
boot with production rules and crash-loop on `SWAGGER_ENABLED` — loudly, by
design, rather than serving QA under the wrong configuration.

| Variable                             | dev (local)                                   | stage                            | prod                                  |
| ------------------------------------ | --------------------------------------------- | -------------------------------- | ------------------------------------- |
| `NODE_ENV`                           | `development`                                 | `staging`                        | `production`                          |
| `LOG_LEVEL`                          | `debug`                                       | `debug`                          | `info`                                |
| `SWAGGER_ENABLED`                    | `true`                                        | `true`                           | `false` (enforced)                    |
| `CORS_ALLOWED_ORIGINS`               | `http://localhost:3001,http://localhost:3002` | stage storefront + admin origins | production storefront + admin origins |
| `QUEUE_ENABLED`                      | `false`                                       | `false`                          | `false` until Phase 1                 |
| `DATABASE_URL` / `DIRECT_URL`        | local Supabase                                | stage Supabase project           | production Supabase project           |
| `SUPABASE_URL`                       | local                                         | stage project                    | production project                    |
| `SUPABASE_SERVICE_ROLE_KEY`          | local                                         | stage project                    | production project                    |
| `JWT_SECRET` / `TOTP_ENCRYPTION_KEY` | unset (per-boot key)                          | stage secrets                    | production secrets                    |

`staging` and `production` are both **deployed environments** and share the same
required-key checks: `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`JWT_SECRET`, `TOTP_ENCRYPTION_KEY`, a non-empty CORS allowlist, and an https
`APP_PUBLIC_BASE_URL`. Only the Swagger rule is production-only, because QA and
the client need the docs page.

In CI these values live in **GitHub Environments** (`dev`, `stage`, `prod`) as
environment-scoped entries, never repository-scoped: secrets are `DATABASE_URL`,
`DIRECT_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `JWT_SECRET` and
`TOTP_ENCRYPTION_KEY`; everything else in the table above is a non-secret
variable. Every one of those five is a secret in every environment without
exception — the two identity keys sign and decrypt live credentials.

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
    guards/                  SessionAuthGuard, RolesGuard, throttler guards
    money/                   poysha integer arithmetic + BigInt JSON safety net
    types/                   AuthenticatedUser, ServiceResponse
  infra/
    prisma/                  PrismaService (pg driver adapter), generated-client barrel
    supabase/                service_role client — Storage signing only
    redis/                   BullMQ registration, gated by QUEUE_ENABLED
  modules/
    health/       ✅  liveness + readiness with per-dependency detail
    auth/         ✅  login, MFA, sessions, tokens, GET /auth/me, SMS/OTP ports
    catalog/      ✅  reference vertical slice — copy this one
    geo/          ✅  vendored geography + map-search proxy (noop/Photon/Geoapify)
    user/         ✅  profile + delivery address book
    admin/        ✅  audit trail, catalog write-side, staff/customer management
    inventory/    ✅  warehouses, stock, batches with expiry, stock ledger
    cart/         ✅  basket with live pricing and stock warnings
    order/        ✅  checkout, lifecycle state machine, stock settlement
    payment/ delivery/
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

| Method   | Route                                               | Auth   | Notes                                       |
| -------- | --------------------------------------------------- | ------ | ------------------------------------------- |
| `GET`    | `/api/v1/health`                                    | public | Always 200 while the process lives          |
| `GET`    | `/api/v1/health/ready`                              | public | 503 when the database is unreachable        |
| `GET`    | `/api/v1/auth/me`                                   | Bearer | Provisions the local user row on first call |
| `GET`    | `/api/v1/catalog/categories`                        | public | Category tree                               |
| `GET`    | `/api/v1/catalog/products`                          | public | Paged, filterable, searchable               |
| `GET`    | `/api/v1/catalog/products/:slug`                    | public | Product detail                              |
| `GET`    | `/api/v1/geo/divisions`                             | public | All eight divisions, bilingual              |
| `GET`    | `/api/v1/geo/divisions/:division/districts`         | public | Districts of one division                   |
| `GET`    | `/api/v1/geo/districts/:district/units`             | public | Upazilas, city thanas and circles           |
| `GET`    | `/api/v1/geo/districts/:district/units/:unit/areas` | public | Unions and post-office areas                |
| `PATCH`  | `/api/v1/users/me`                                  | Bearer | Update the display name                     |
| `GET`    | `/api/v1/users/me/addresses`                        | Bearer | List addresses, default first               |
| `POST`   | `/api/v1/users/me/addresses`                        | Bearer | Save an address (max 20)                    |
| `GET`    | `/api/v1/users/me/addresses/:id`                    | Bearer | One address                                 |
| `PATCH`  | `/api/v1/users/me/addresses/:id`                    | Bearer | Edit an address                             |
| `DELETE` | `/api/v1/users/me/addresses/:id`                    | Bearer | Soft-delete an address                      |
| `PUT`    | `/api/v1/users/me/addresses/:id/default`            | Bearer | Promote to default (idempotent)             |

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

This API is its own identity provider. It issues the tokens, stores the
credentials, and decides every access question from its own tables. No third
party takes part — Supabase is storage, and nothing it issues is trusted here.

- `SessionAuthGuard` is registered **globally** — every route requires a valid
  session unless marked `@Public()`. Forgetting the decorator fails closed.
- Two stages, cheap one first. Stage 1 verifies the access token's signature,
  `exp`, `iss`, `aud`, `typ` and its device-binding claim against the presented
  `X-Device-Id` — CPU only, so a forged or expired token never reaches Postgres.
  Stage 2 is one indexed lookup of the session row joined to its user.
- **The role comes from the row, not the token.** A demotion or a disabled
  account therefore takes effect on the caller's very next request, with no
  waiting for a token to expire. That is why stage 2 exists at all.
- Both stages answer 401 with the same message, so a response never reveals
  whether a well-formed token matched a real session. Every 401 from the guard
  carries `WWW-Authenticate: Bearer`.
- Sessions are visible and revocable: `GET /auth/sessions` lists the caller's
  own live sessions with a truncated IP and no token material of any kind, and
  `DELETE /auth/sessions/:id` ends one. Someone else's session id answers 404,
  never 403, so the endpoint cannot be used to discover that an id is real.

Client authors: read [`src/modules/auth/README.md`](src/modules/auth/README.md)
before writing a request interceptor. It carries the refresh rules that keep a
client out of an infinite loop or a spurious logout, and they are recorded
nowhere else in this codebase.

### Phone OTP — the Bangladesh gotcha

The hosted phone providers on offer (Twilio, MessageBird, Vonage, TextLocal)
cover **none** of the local gateways — Alpha SMS, SSL Wireless, operator
aggregators — which are cheaper and more reliable for BD numbers.

So phone login is a **custom flow in this API**: generate and verify the OTP
here, send it through a local gateway, and create or sign in the user against
this API's own `users` table, exactly as password login already does. The seams
exist — [`ports/sms-gateway.port.ts`](src/modules/auth/ports/sms-gateway.port.ts)
and [`ports/otp.port.ts`](src/modules/auth/ports/otp.port.ts) — with
`NoopSmsGateway` wired up for development. `OtpService` is deliberately
**unimplemented**: it needs a chosen gateway plus Redis-backed challenge
storage, both decisions for the phone-login sub-project.

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

## Environments and branching

Three environments, each owned by exactly one branch.

| Branch | Environment | `NODE_ENV`    | Audience                         |
| ------ | ----------- | ------------- | -------------------------------- |
| `dev`  | dev         | `development` | developers                       |
| `stg`  | stage       | `staging`     | QA and client acceptance testing |
| `main` | prod        | `production`  | customers                        |

```
feature/*  ──PR──▶  dev  ──PR──▶  stg  ──PR──▶  main
hotfix/*   ─────────────PR───────────────────────▶  main
                              then back-merge main ─▶ stg ─▶ dev
```

**Merges are forward-only.** Never cherry-pick between environment branches: the
moment `stg` holds something `main` will not receive, "tested on stage" stops
carrying information.

**Merge method differs by hop, deliberately.** Squash `feature/*` into `dev` for
readable history. Use a **merge commit** for `dev` → `stg` and `stg` → `main`, so
commit SHAs survive and the commit QA signed off on is the commit that ships.

**Hotfixes** branch from `main` and are back-merged `main` → `stg` → `dev` in the
same session. This is the only exception to forward-only flow — an un-back-merged
hotfix is silently reverted by the next promotion.

### Repository setup (one-time)

None of this is committed, so a maintainer performs it by hand before the
pipeline in `.github/workflows/ci.yml` can turn green. **The order matters:**

1. **Run the initial migration first.** `npm run db:migrate -- --name init`
   against the dev database, then commit `prisma/migrations/`. This has to
   happen before anything else: without a migration, `db:deploy` applies
   nothing, and `db:rls` then fails on
   `ALTER TABLE public.users ENABLE ROW LEVEL SECURITY` because no tables
   exist yet.
2. **Create the two Supabase projects** — stage now, production at launch.
   Enable **Point-in-Time Recovery** on production before launch.
3. **Create the three GitHub Environments**, named exactly `dev`, `stage` and
   `prod`, and populate each with environment-scoped (never
   repository-scoped) secrets and variables per the Environment matrix table
   above. Add a **required reviewer** to `prod`.
4. **Create the `stg` branch from `dev`** and push it.
5. **Create a branch ruleset** targeting `dev`, `stg` and `main`: require a
   pull request, require the status check named **`Verify`** (the job's
   _display name_ — that's what GitHub matches on, not the job id `verify`),
   and block force pushes. Do **not** require linear history: it conflicts
   with the promotion merge commits above. A status check cannot be selected
   in a ruleset until it has run at least once, so this step comes after CI
   has already run at least once on `dev`.
6. **Enable secret scanning and push protection.** Both are free on public
   repositories.

The `prod` required-reviewer gate from step 3 is a **repository setting**, not
something configured in `ci.yml` — don't go looking for it in the workflow.

### Migrations

| Environment | Who runs migrations                                                                                       |
| ----------- | --------------------------------------------------------------------------------------------------------- |
| dev         | you, locally: `npm run db:migrate` generates the migration and you commit it. CI never runs `migrate dev` |
| stage       | automatically, on push to `stg`                                                                           |
| prod        | on push to `main`, behind the `prod` environment's required reviewer                                      |

Three things to know before an incident:

1. **`prisma migrate deploy` is forward-only.** There is no down-migration.
   Reverting a schema change means writing a new forward migration.
2. **A paused Supabase free project fails the migration step** with a connection
   error. Any activity unpauses it.
3. `prisma/rls/001_enable_rls.sql` is idempotent — every `CREATE POLICY` is
   preceded by `DROP POLICY IF EXISTS` — so `npm run db:rls` runs on every
   deploy, always after `db:deploy`.

---

## Deployment

Supabase hosts Postgres, Auth, Storage and Realtime. This API deploys separately
as a container. CI publishes one portable image per push to
`ghcr.io/araf488/barakah_bazaar`, tagged immutably as `sha-<short-sha>` plus a
moving `dev` / `stg` / `prod` tag for convenience. Deployments reference the
immutable tag only — a moving tag forfeits the ability to say what is running.

**No application host is chosen yet**, deliberately. Because the image is
portable and already published, adopting one is a change to a single workflow
step. While pre-launch: dev runs locally, stage runs on a free-tier service, and
production is created at launch — with Fly.io the current recommendation for
production, since its Singapore region is the closest low-latency option to
Bangladesh.

```bash
docker build -t barakah-bazaar-api .
docker compose up -d redis          # local Redis only; Postgres lives in Supabase
```

> The `Dockerfile` is built by the `verify` job on every pull request, so a
> broken build fails in review. `docker-compose.yml` (local Redis) is still
> unverified by CI.

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
this repo. `docs/` is gitignored, so a copy kept there stays local to your
machine and is never published — deliberate, since this repository is public.

---

## Contributing

Conventional Commits, enforced by commitlint. `lint-staged` runs ESLint and
Prettier on staged files.

**Committing from an IDE or a GUI git client?** Those launch git without a login
shell, so `node` is not on `PATH` and every hook fails with
`npx: command not found (code 127)` — while the identical commit works from a
terminal, which is what makes it confusing. `.husky/path.sh` prepends the usual
install locations and honours nvm/fnm; both hooks source it first. If your node
lives somewhere unusual, add it there rather than deleting the hook.

Before opening a PR:

```bash
npm run lint && npm test && npm run test:e2e && npm run build
```

New module? Copy `src/modules/catalog` and read the target module's README
first — it already lists the responsibility, owned tables and the traps.
