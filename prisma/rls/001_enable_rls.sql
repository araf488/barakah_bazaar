-- ─────────────────────────────────────────────────────────────────────────────
-- Barakah Bazaar — Row Level Security
--
-- Run with:  npm run db:rls          (after every migration that adds a table)
--
-- Policy model (see plan §2.1 / §9):
--   * RLS is ENABLED on every table, with no exceptions.
--   * `service_role` — the key held only by this NestJS API — bypasses RLS by
--     design, so all business writes keep working.
--   * `anon` / `authenticated` get READ-ONLY access to published catalog data,
--     plus owner-scoped reads of their own user row and addresses.
--   * Anything money- or stock-related (orders, payments, inventory) gets NO
--     policy for anon/authenticated at all. Absence of a policy is a deny.
--
-- This file is idempotent: safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Enable RLS everywhere ────────────────────────────────────────────────
ALTER TABLE public.users            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.addresses        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_images   ENABLE ROW LEVEL SECURITY;

-- Force RLS even for the table owner, so a mistaken owner-role connection from
-- a client cannot read past the policies.
ALTER TABLE public.users     FORCE ROW LEVEL SECURITY;
ALTER TABLE public.addresses FORCE ROW LEVEL SECURITY;

-- ── 2. Public catalog reads ─────────────────────────────────────────────────
-- Storefront and Flutter app may read active catalog rows directly via the
-- Supabase client. Everything else about the catalog (writes) is service_role.

DROP POLICY IF EXISTS categories_public_read ON public.categories;
CREATE POLICY categories_public_read
  ON public.categories FOR SELECT
  TO anon, authenticated
  USING (is_active = true);

DROP POLICY IF EXISTS products_public_read ON public.products;
CREATE POLICY products_public_read
  ON public.products FOR SELECT
  TO anon, authenticated
  USING (is_active = true AND published_at IS NOT NULL AND published_at <= now());

DROP POLICY IF EXISTS product_variants_public_read ON public.product_variants;
CREATE POLICY product_variants_public_read
  ON public.product_variants FOR SELECT
  TO anon, authenticated
  USING (
    is_active = true
    AND EXISTS (
      SELECT 1 FROM public.products p
      WHERE p.id = product_variants.product_id
        AND p.is_active = true
        AND p.published_at IS NOT NULL
        AND p.published_at <= now()
    )
  );

DROP POLICY IF EXISTS product_images_public_read ON public.product_images;
CREATE POLICY product_images_public_read
  ON public.product_images FOR SELECT
  TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.products p
      WHERE p.id = product_images.product_id
        AND p.is_active = true
        AND p.published_at IS NOT NULL
        AND p.published_at <= now()
    )
  );

-- ── 3. Owner-scoped reads ───────────────────────────────────────────────────
-- A signed-in user may read their own profile row and their own addresses.
-- Writes still go through the API so validation and audit logging happen.

DROP POLICY IF EXISTS users_read_own ON public.users;
CREATE POLICY users_read_own
  ON public.users FOR SELECT
  TO authenticated
  USING (supabase_user_id = auth.uid());

DROP POLICY IF EXISTS addresses_read_own ON public.addresses;
CREATE POLICY addresses_read_own
  ON public.addresses FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = addresses.user_id
        AND u.supabase_user_id = auth.uid()
    )
  );

-- ── 4. Revoke default grants ────────────────────────────────────────────────
-- Supabase grants anon/authenticated broad table privileges by default. RLS
-- would still block reads, but revoking write privileges outright means a
-- future forgotten policy cannot become a write hole.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public
  FROM anon, authenticated;

-- ── 5. New tables inherit the deny-by-default posture ───────────────────────
-- Reminder for whoever adds the next table (orders, payments, inventory…):
--   1. ALTER TABLE ... ENABLE ROW LEVEL SECURITY;
--   2. Add a policy ONLY if a client legitimately needs to read those rows.
--   3. Money and stock tables get no anon/authenticated policy. Ever.
