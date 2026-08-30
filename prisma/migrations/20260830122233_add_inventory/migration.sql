-- CreateEnum
CREATE TYPE "StockMovementReason" AS ENUM (
    'RECEIPT', 'SALE', 'RESERVED', 'RELEASED', 'ADJUSTMENT',
    'DAMAGE', 'EXPIRY', 'RETURN', 'TRANSFER_IN', 'TRANSFER_OUT'
);

-- CreateTable
CREATE TABLE "warehouses" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_bn" TEXT,
    "division" TEXT NOT NULL,
    "district" TEXT NOT NULL,
    "upazila" TEXT NOT NULL,
    "area" TEXT,
    "address_line" TEXT NOT NULL,
    "post_code" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "service_radius_km" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory" (
    "id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "quantity_on_hand" INTEGER NOT NULL DEFAULT 0,
    "quantity_reserved" INTEGER NOT NULL DEFAULT 0,
    "reorder_level" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_batches" (
    "id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "batch_code" TEXT,
    "quantity" INTEGER NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3),
    "unit_cost_poysha" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "batch_id" UUID,
    "delta" INTEGER NOT NULL,
    "reason" "StockMovementReason" NOT NULL,
    "note" TEXT,
    "actor_id" UUID,
    "reference_type" TEXT,
    "reference_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_reservations" (
    "id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "reference_type" TEXT NOT NULL,
    "reference_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "released_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_code_key" ON "warehouses"("code");
CREATE INDEX "warehouses_is_active_idx" ON "warehouses"("is_active");

-- One stock row per variant per warehouse. The unique index is what makes an upsert on
-- receipt safe under concurrency.
CREATE UNIQUE INDEX "inventory_warehouse_id_variant_id_key" ON "inventory"("warehouse_id", "variant_id");
CREATE INDEX "inventory_variant_id_idx" ON "inventory"("variant_id");

-- First-expiry-first-out picking reads straight off this.
CREATE INDEX "inventory_batches_warehouse_id_variant_id_expires_at_idx"
    ON "inventory_batches"("warehouse_id", "variant_id", "expires_at");
CREATE INDEX "inventory_batches_expires_at_idx" ON "inventory_batches"("expires_at");

CREATE INDEX "stock_movements_warehouse_id_variant_id_created_at_idx"
    ON "stock_movements"("warehouse_id", "variant_id", "created_at");
CREATE INDEX "stock_movements_reference_type_reference_id_idx"
    ON "stock_movements"("reference_type", "reference_id");
CREATE INDEX "stock_movements_created_at_idx" ON "stock_movements"("created_at");

-- The sweep index: live holds past their expiry.
CREATE INDEX "stock_reservations_released_at_expires_at_idx"
    ON "stock_reservations"("released_at", "expires_at");
CREATE INDEX "stock_reservations_reference_type_reference_id_idx"
    ON "stock_reservations"("reference_type", "reference_id");
CREATE INDEX "stock_reservations_warehouse_id_variant_id_idx"
    ON "stock_reservations"("warehouse_id", "variant_id");

-- Quantities may never go negative. Enforced by Postgres because an oversell that only the
-- application prevents is one forgotten code path away from happening.
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_quantities_non_negative"
    CHECK ("quantity_on_hand" >= 0 AND "quantity_reserved" >= 0);
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_reserved_not_over_hand"
    CHECK ("quantity_reserved" <= "quantity_on_hand");
ALTER TABLE "inventory_batches" ADD CONSTRAINT "inventory_batches_quantity_non_negative"
    CHECK ("quantity" >= 0);
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_quantity_positive"
    CHECK ("quantity" > 0);

-- AddForeignKey
-- RESTRICT throughout: stock history must stay resolvable. A warehouse or variant that ever
-- held stock is deactivated, never deleted.
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_warehouse_id_fkey"
    FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_variant_id_fkey"
    FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inventory_batches" ADD CONSTRAINT "inventory_batches_warehouse_id_fkey"
    FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_batches" ADD CONSTRAINT "inventory_batches_variant_id_fkey"
    FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_warehouse_id_fkey"
    FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_variant_id_fkey"
    FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- SET NULL, not RESTRICT: a written-off batch may be purged while its ledger entry remains.
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_batch_id_fkey"
    FOREIGN KEY ("batch_id") REFERENCES "inventory_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_warehouse_id_fkey"
    FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_variant_id_fkey"
    FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
