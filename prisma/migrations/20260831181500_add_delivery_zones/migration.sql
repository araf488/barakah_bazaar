-- CreateTable
CREATE TABLE "delivery_zones" (
    "id" UUID NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_bn" TEXT,
    "fee_poysha" BIGINT NOT NULL,
    "free_above_poysha" BIGINT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_zones_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "delivery_zones_fee_non_negative" CHECK ("fee_poysha" >= 0),
    CONSTRAINT "delivery_zones_free_above_positive" CHECK ("free_above_poysha" IS NULL OR "free_above_poysha" > 0)
);

-- CreateTable
CREATE TABLE "delivery_zone_rules" (
    "id" UUID NOT NULL,
    "zone_id" UUID NOT NULL,
    "division" TEXT NOT NULL,
    "district" TEXT,
    "unit" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_zone_rules_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "delivery_zone_rules_unit_needs_district" CHECK ("unit" IS NULL OR "district" IS NOT NULL)
);

-- CreateIndex
CREATE INDEX "delivery_zones_is_active_sort_order_idx" ON "delivery_zones"("is_active", "sort_order");

-- CreateIndex
-- NULLS NOT DISTINCT is load-bearing, not a nicety. Postgres treats NULLs as distinct in a
-- unique index by default, so without it ('Dhaka', NULL, NULL) could be inserted twice and
-- two zones would claim the whole division — which is the most common kind of rule there is.
-- Requires Postgres 15 or newer.
CREATE UNIQUE INDEX "delivery_zone_rules_division_district_unit_key" ON "delivery_zone_rules"("division", "district", "unit") NULLS NOT DISTINCT;

-- CreateIndex
CREATE INDEX "delivery_zone_rules_zone_id_idx" ON "delivery_zone_rules"("zone_id");

-- AddForeignKey
ALTER TABLE "delivery_zone_rules" ADD CONSTRAINT "delivery_zone_rules_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "delivery_zones"("id") ON DELETE CASCADE ON UPDATE CASCADE;
