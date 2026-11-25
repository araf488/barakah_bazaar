#!/bin/sh
# Runs once, when the data volume is first created (docker-entrypoint-initdb.d).
#
# barakah_app: the login the API and the CI migrations use. It owns the database so Prisma can
# migrate it, and has BYPASSRLS because prisma/rls/001_enable_rls.sql FORCEs row level security
# on money and stock tables: on Supabase the API's role bypasses RLS the same way.
#
# anon, authenticated, service_role: NOLOGIN roles the RLS script grants policies to. Nobody
# connects as them here (there is no PostgREST), but the script names them and would fail
# without them.
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v app_password="$APP_DB_PASSWORD" <<'SQL'
CREATE ROLE barakah_app LOGIN BYPASSRLS PASSWORD :'app_password';
ALTER DATABASE barakah OWNER TO barakah_app;
ALTER SCHEMA public OWNER TO barakah_app;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
SQL
