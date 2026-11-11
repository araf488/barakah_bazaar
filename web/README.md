# Barakah Bazaar — Web Frontend

> **Halal. Wholesome. Home-delivered.**
> Bangladesh's halal-first multi-category marketplace — the _tayyib_ standard:
> not just halal, but genuinely good and pure.

The `web/` workspace holds both web applications that sit in front of the Barakah Bazaar
API: the **public storefront** and the **staff admin portal**.

---

## Status

`web/` is a set of npm workspaces of the `barakah_bazaar` repository, which also
holds the NestJS API at its root. There is one `package-lock.json`, at the root,
and one pipeline. The shared packages (`config`, `tokens`, `ui`) exist, and each
app is a minimal page that proves routing, SSR and the build. The rest of what
is described below is planned: treat `web/packages/api-client`, `web/contracts/`
and every feature mentioned as not yet built.

## What lives here

| Path                  | Application                     | Port                           | Audience                             |
| --------------------- | ------------------------------- | ------------------------------ | ------------------------------------ |
| `web/apps/storefront` | Next.js (App Router), SSR + SEO | 3001 (dev)                     | customers, Bangla-first with English |
| `web/apps/admin`      | React + Vite SPA                | 3002 (dev), served at `/admin` | staff, role-gated, English chrome    |

Shared packages:

| Package                   | Responsibility                                                                                                                                                    |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `web/packages/tokens`     | Brand primitives — colour, type scale, spacing. Framework-free; emits CSS custom properties, a TS object and JSON so the Flutter app can consume the same values. |
| `web/packages/ui`         | MUI theme built from the tokens, plus the handful of primitives that encode business rules (money, localized names, perishability, cutoff clock).                 |
| `web/packages/api-client` | Generated API client, TanStack Query hooks, MSW mock handlers, auth wiring (model to be decided, see Stack), error mapping.                                       |
| `web/packages/config`     | Shared TypeScript, ESLint and Prettier configuration, including the import-boundary rules that keep the two apps separate.                                        |
| `web/contracts/`          | The API's OpenAPI snapshot plus hand-authored fragments for endpoints the backend has not built yet.                                                              |

In production there is no separate deploy target. The root `Dockerfile` builds
both apps into the one image, and the API process serves them: `/admin/**` is the
admin SPA's static build, everything outside `/api/**` goes to the storefront's
Next handler, all on one origin. See "One process, three surfaces" in the root
README. The storefront stays a self-contained workspace app, so it can be split
out later if it ever has to scale on its own.

---

## Stack

- **Storefront** — Next.js App Router, locale-prefixed routes (`/bn` default,
  `/en`), server-rendered catalog pages with ISR.
- **Admin** — React + Vite SPA, MUI `DataGrid`, MFA (auth model to be decided, see Auth below).
- **UI** — MUI (Material) in both apps, themed from `web/packages/tokens`.
- **Data** — TanStack Query over a generated client; MSW for endpoints the
  backend has not shipped.
- **Auth** — _planned: Supabase (`supabase-js`) owns the session and the API
  verifies the JWT._ **This conflicts with the API as built.** The API is its own
  identity provider with device-bound sessions (`X-Device-Id`, refresh rotation;
  see `src/modules/auth/README.md` at the repo root). Decide which model the web
  clients use at the first storefront auth task; until then, do not build on the
  Supabase-session assumption.
- **Tests** — Vitest + React Testing Library, MSW for the network, Playwright for
  end-to-end.
- **Package manager** — npm workspaces. Node `>=22.22.2` (see the root `.nvmrc`).

---

## API contract — the rules every client obeys

These come from the API and are not negotiable at the frontend layer:

- **Money is integer poysha.** Use `pricePoysha` / `fromPricePoysha` for anything
  computational. `priceFormatted` (`৳1,250.00`) is display only. **The client
  never computes a final price** — the server recomputes at checkout.
- **Content is bilingual at the API level** — `nameEn` / `nameBn`,
  `descriptionEn` / `descriptionBn`. Language selection for product content is a
  field choice, not a translation lookup. Only UI _labels_ live in message files.
- **Perishability ships on every product** as `handling: { isPerishable,
storageType, shelfLifeHours, maxDeliveryDistanceKm }`. The frontend uses it to
  _group and explain_, never to decide a price or a delivery promise.
- **Lists** return `{ items, meta: { page, limit, totalItems, totalPages,
hasNextPage } }` — `limit` defaults to 20, capped at 100.
- **Errors** return `{ statusCode, message, errors?, path, method }`, where
  `errors` is one string per failed validation constraint.
- **Never** place `SUPABASE_SERVICE_ROLE_KEY` or `DATABASE_URL` under `web/`.
  Only the three `NEXT_PUBLIC_*` values below belong in a browser bundle. The
  storefront's server code runs inside the API process, whose environment holds
  every server secret, so `web:lint` (a CI step) fails on any `process.env` read
  outside the allowlist: `NEXT_PUBLIC_*`, `VITE_*`, `NODE_ENV`,
  `WEB_INTERNAL_API_BASE_URL` and `NEXT_RUNTIME`. Dotted, bracketed and
  destructured reads are all checked, as is `process.env` used whole.

---

## What is real and what is mocked

The API is a modular monolith with fifteen modules, of which three are wired up.
Everything else is served locally by MSW against a hand-authored contract.

**Real endpoints** (`GET`, under `/api/v1`):

`health` · `health/ready` · `auth/me` · `catalog/categories` ·
`catalog/products` · `catalog/products/:slug`

**Mocked** — cart, checkout, order, tracking, delivery slots and cutoff, account,
phone OTP login, and every admin write. Each mocked path is marked
`x-barakah-status: mocked` in `contracts/fragments/`, and
`npm run contract:status` prints the current list. When the backend ships a
module, its fragment is deleted and the generated client picks up the real shape.

---

## Environments and branches

Three environments, each owned by exactly one branch — matching the API repo's
topology. Merges are **forward-only**: `dev` → `stg` → `main`.

| Branch | Environment | `APP_ENV`     | Purpose                          |
| ------ | ----------- | ------------- | -------------------------------- |
| `dev`  | dev         | `development` | day-to-day development           |
| `stg`  | stage       | `staging`     | QA and client acceptance testing |
| `main` | prod        | `production`  | customers                        |

### The environment discriminator

The API uses `NODE_ENV` as its single discriminator and deliberately refuses a
second one — two answers to "which environment am I" is how stage ends up
behaving like production in one code path and like development in another.

**This repository cannot follow that rule**, because both bundlers own
`NODE_ENV`: `next build` and `vite build` force it to `production` regardless of
which environment is being built, so stage and prod would be indistinguishable at
runtime. Applying the API's rule here would cause the exact bug the rule exists to
prevent.

The discriminator is therefore an explicit `APP_ENV`, exposed under each bundler's
required public prefix:

| App        | Variable              |
| ---------- | --------------------- |
| storefront | `NEXT_PUBLIC_APP_ENV` |
| admin      | `VITE_APP_ENV`        |

`NODE_ENV` keeps its framework meaning — build optimisation — and is **never** read
to decide behaviour. `APP_ENV` is the only source of truth, validated at startup
against `development | staging | production`, so a missing or misspelled value
fails the boot instead of silently falling through to production behaviour.

### Environment matrix

Following the API's convention, **no `.env.staging` or `.env.production` files
live in this repository** — near-identical templates drift apart within a month.
There is one `.env.example`; the per-environment values are documented here and
injected by the host or CI.

| Variable              | development                    | stage                        | prod                        |
| --------------------- | ------------------------------ | ---------------------------- | --------------------------- |
| `*_APP_ENV`           | `development`                  | `staging`                    | `production`                |
| `*_API_BASE_URL`      | `http://localhost:3000/api/v1` | stage API origin + `/api/v1` | prod API origin + `/api/v1` |
| `*_SUPABASE_URL`      | local `supabase start`         | free project #1              | free project #2             |
| `*_SUPABASE_ANON_KEY` | required                       | required                     | required                    |
| mock layer (MSW)      | on                             | on, with banner              | **off, absent from bundle** |
| source maps           | on                             | on                           | off                         |

Never present under `web/` in any environment:
`SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `DIRECT_URL`. `web:lint` fails on
any string literal naming them, and on any `process.env` read outside the
allowlist above.

### Mocked endpoints per environment

Endpoints the API has not built yet are served locally by MSW, which makes
"which environment may show fake data" a safety question rather than a
convenience one.

- **development** — MSW on, unrestricted. Fake data is expected.
- **stage** — MSW on, because the client cannot review a journey that does not
  render. Any page relying on a mocked endpoint shows a persistent
  **demo data** banner, so a mocked price is never mistaken for a real one during
  acceptance testing.
- **prod** — MSW is excluded from the bundle entirely, and routes that depend
  only on mocked endpoints are unreachable behind a feature flag. A mock handler
  serving a fake price to a customer is the worst failure this system can have, so
  a test asserts its absence from the production build rather than trusting
  configuration.

Local ports: API `3000`, storefront `3001`, admin `3002`. `next dev` and `vite`
do not default to those (Next takes 3000, Vite 5173), so pass them, as shown
under Getting started. Both origins are already in the `CORS_ALLOWED_ORIGINS`
value in the root `.env.example` (the schema itself defaults it to empty). In the deployed image the web apps are same-origin with
the API, so CORS never applies to them.

---

## Getting started

Run everything from the repository root; there is one `package-lock.json`.

```bash
nvm use                       # Node >=22.22.2 (root .nvmrc)
npm install                   # installs the API and every web workspace

npm run web:lint              # ESLint with web/eslint.config.mjs over web/
npm run web:typecheck         # tsc -p web/tsconfig.json --noEmit
npm run web:test              # Vitest across the web workspaces
npm run web:build             # storefront (.next), then admin (dist)

npm run start:dev                               # the API, http://localhost:3000
npm run dev -w @barakah/storefront -- -p 3001   # storefront dev server
npm run dev -w @barakah/admin -- --port 3002    # admin dev server, at /admin/
```

The dev servers run on their own and are not mounted in Nest. The admin dev
server proxies `/api` to `http://localhost:3000`. The storefront reads
`WEB_INTERNAL_API_BASE_URL` for its server-side fetches (default: the API on
`127.0.0.1:3000`).

The root `eslint.config.mjs` ignores `web/**`, and `web/` has its own flat
config, so a bare `eslint .` never lints one side with the other's rules.
Versions in `web/` package manifests are pinned exactly (no `^`/`~`).

Client environment variables — three public values only (planned for the real
clients; the current placeholder pages read none of them):

```
NEXT_PUBLIC_API_BASE_URL=http://localhost:3000/api/v1
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

---

## Related repositories

| Repository           | Role                                                                                   |
| -------------------- | -------------------------------------------------------------------------------------- |
| `barakah_bazaar`     | NestJS API at the repo root, plus this `web/` workspace.                               |
| `barakah_bazaar_app` | Flutter customer app (Android + iOS). Consumes the same API and the same brand tokens. |
