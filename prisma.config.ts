import 'dotenv/config';
import { defineConfig } from 'prisma/config';

/**
 * Prisma CLI configuration (Prisma 7+).
 *
 * Connection URLs live here rather than in schema.prisma. Migrations and
 * introspection use `DIRECT_URL` — the direct, session-mode Supabase
 * connection on port 5432 — because DDL over the Supavisor transaction pooler
 * is unreliable. The running application uses `DATABASE_URL` through a driver
 * adapter instead; see src/infra/prisma/prisma.service.ts.
 *
 * The datasource is attached only when DIRECT_URL is set, so `prisma generate`
 * works on a fresh clone with no .env — `prisma migrate` then reports the
 * missing URL itself, which is a clearer failure than one thrown while merely
 * loading this file.
 */
const directUrl = process.env.DIRECT_URL;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  ...(directUrl ? { datasource: { url: directUrl } } : {}),
});
