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
--
-- Wrapped in a transaction: Postgres DDL is transactional, so the whole file
-- applies or none of it does. Without this, an interrupted run could leave a
-- table with RLS enabled and zero policies — which in Postgres means deny-all
-- for every non-owner role, an outage rather than a safe failure.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1. Enable RLS everywhere ────────────────────────────────────────────────
ALTER TABLE public.users            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.addresses        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_images   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_audit_log  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouses         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_batches  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.carts              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cart_items         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_events       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_invitations    ENABLE ROW LEVEL SECURITY;

-- Force RLS even for the table owner, so a mistaken owner-role connection from
-- a client cannot read past the policies.
ALTER TABLE public.users     FORCE ROW LEVEL SECURITY;
ALTER TABLE public.addresses FORCE ROW LEVEL SECURITY;

-- The audit log is forced too: it records who did what to money and stock, so not even a
-- mistaken owner-role connection from a client may read it. It gets NO anon/authenticated
-- policy at all — absence of a policy is a deny — and only service_role, held by this API,
-- can reach it.
ALTER TABLE public.admin_audit_log FORCE ROW LEVEL SECURITY;

-- Stock is forced too. Section 5 already says money and stock tables get NO anon or
-- authenticated policy, ever: knowing exactly how many units remain is competitive
-- information, and a client that can read reservations can infer another customer's basket.
-- Sellable quantity reaches the storefront through this API, never by direct table read.
ALTER TABLE public.warehouses         FORCE ROW LEVEL SECURITY;
ALTER TABLE public.inventory          FORCE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_batches  FORCE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements    FORCE ROW LEVEL SECURITY;
ALTER TABLE public.stock_reservations FORCE ROW LEVEL SECURITY;

-- A basket is the customer's own, so it is forced like their profile and addresses. It gets
-- an owner-scoped READ policy below; writes stay with this API so pricing and availability
-- are checked on every change.
ALTER TABLE public.carts      FORCE ROW LEVEL SECURITY;
ALTER TABLE public.cart_items FORCE ROW LEVEL SECURITY;

-- Orders are money. Forced, and a customer may read only their own — never another's, and
-- never the event ledger, which records which staff member touched what.
ALTER TABLE public.orders       FORCE ROW LEVEL SECURITY;
ALTER TABLE public.order_items  FORCE ROW LEVEL SECURITY;
ALTER TABLE public.order_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.notifications FORCE ROW LEVEL SECURITY;
ALTER TABLE public.payment_transactions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.staff_invitations FORCE ROW LEVEL SECURITY;

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
    addresses.deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = addresses.user_id
        AND u.supabase_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS carts_read_own ON public.carts;
CREATE POLICY carts_read_own
  ON public.carts FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = carts.user_id
        AND u.supabase_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS cart_items_read_own ON public.cart_items;
CREATE POLICY cart_items_read_own
  ON public.cart_items FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.carts c
      JOIN public.users u ON u.id = c.user_id
      WHERE c.id = cart_items.cart_id
        AND u.supabase_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS orders_read_own ON public.orders;
CREATE POLICY orders_read_own
  ON public.orders FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = orders.user_id AND u.supabase_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS order_items_read_own ON public.order_items;
CREATE POLICY order_items_read_own
  ON public.order_items FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.orders o
      JOIN public.users u ON u.id = o.user_id
      WHERE o.id = order_items.order_id AND u.supabase_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS notifications_read_own ON public.notifications;
CREATE POLICY notifications_read_own
  ON public.notifications FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = notifications.user_id AND u.supabase_user_id = auth.uid()
    )
  );

-- Note what this policy does NOT expose: last_error and attempts are readable columns on a
-- row a customer owns. That is acceptable because neither carries a credential — the body is
-- never stored — but the API withholds them anyway, so a direct PostgREST read is the only
-- way to see them.

-- staff_invitations deliberately gets NO policy. Every row is a pending permission grant,
-- and token_hash is the stored half of a live credential: a client that could read this table
-- could enumerate open invitations, and one that could write could grant itself a role.

-- payment_transactions deliberately gets NO policy. It is the money ledger: it names the
-- staff member who took the cash, carries gateway references usable in a dispute, and a
-- forged row here is a forged receipt. Customers see what they paid through this API's
-- order endpoints, not by reading the books.

-- order_events deliberately gets NO policy: it names the staff member who moved an order,
-- which is internal. Customers see status through this API, not the ledger behind it.

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

COMMIT;
