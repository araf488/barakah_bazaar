-- ─────────────────────────────────────────────────────────────────────────────
-- Barakah Bazaar — take the demo catalogue off the shelves
--
-- Unpublishes every product with a DEMO- SKU (from demo-catalogue.sql) and
-- deactivates those sizes, so shoppers can no longer see or buy them. Nothing is
-- deleted: orders already placed keep pointing at their products, and the stock
-- ledger keeps its history. The demo warehouse, zones and windows stay; edit or
-- deactivate them separately once the real ones exist.
--
--   docker exec -i barakah-postgres psql -U barakah_admin -d barakah -v ON_ERROR_STOP=1 \
--     < unpublish-demo-catalogue.sql
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

UPDATE products p
SET published_at = NULL, is_active = false, updated_at = now()
WHERE EXISTS (
  SELECT 1 FROM product_variants pv WHERE pv.product_id = p.id AND pv.sku LIKE 'DEMO-%'
);

UPDATE product_variants
SET is_active = false, updated_at = now()
WHERE sku LIKE 'DEMO-%';

COMMIT;
