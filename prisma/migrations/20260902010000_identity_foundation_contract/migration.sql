-- Identity foundation, CONTRACT half: remove the Supabase Auth linkage.
-- DESTRUCTIVE and irreversible. Safe only while public.users is empty, and only after the
-- code reading these columns has been deleted — which the same change does.
--
-- The seven owner-scoped RLS policies dropped below compared users.supabase_user_id to
-- auth.uid(). Both halves are gone: no client holds a Supabase JWT, so auth.uid() is always
-- null, and the column itself goes in this migration. They are dropped here as well as in
-- prisma/rls/001_enable_rls.sql because a policy depending on the column would make the
-- DROP COLUMN fail outright, and this file must apply on a database whose RLS has not been
-- re-run yet. Both are idempotent, so the order the two are applied in does not matter.

DROP POLICY IF EXISTS "users_read_own" ON "public"."users";
DROP POLICY IF EXISTS "addresses_read_own" ON "public"."addresses";
DROP POLICY IF EXISTS "carts_read_own" ON "public"."carts";
DROP POLICY IF EXISTS "cart_items_read_own" ON "public"."cart_items";
DROP POLICY IF EXISTS "orders_read_own" ON "public"."orders";
DROP POLICY IF EXISTS "order_items_read_own" ON "public"."order_items";
DROP POLICY IF EXISTS "notifications_read_own" ON "public"."notifications";

ALTER TABLE "public"."users" DROP CONSTRAINT IF EXISTS "users_supabase_user_id_key";
DROP INDEX IF EXISTS "public"."users_supabase_user_id_key";
ALTER TABLE "public"."users" DROP COLUMN IF EXISTS "supabase_user_id";

-- Fails loudly rather than silently discarding rows if any account has no email. That is the
-- intended behaviour: an account with no login credential cannot exist under the new model,
-- and a table that still holds one needs a human, not a default.
ALTER TABLE "public"."users" ALTER COLUMN "email" SET NOT NULL;
