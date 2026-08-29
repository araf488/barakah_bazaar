# Ad-hoc SQL

`local/` is gitignored. Put scratch queries, one-off backfills and local
experiments there — nothing in it reaches the repo or any environment.

Anything that changes the schema is **not** ad-hoc: it belongs in a Prisma
migration (`npm run db:migrate`), because CI applies schema changes with
`prisma migrate deploy` from the committed migration files. Row-level security
policies live in `prisma/rls/` and are re-applied with `npm run db:rls` after
any migration that adds a table.
