-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM (
    'PLACED', 'CONFIRMED', 'PICKING', 'DISPATCHED', 'DELIVERED', 'CANCELLED', 'REFUNDED'
);
CREATE TYPE "PaymentMethod" AS ENUM ('CASH_ON_DELIVERY', 'BKASH');
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PAID', 'REFUNDED', 'FAILED');

-- Order numbers are sequential and gap-tolerant. A sequence rather than a count(*) because
-- two simultaneous checkouts must never be handed the same number, and a unique index alone
-- would turn that race into a failed order rather than a second number.
CREATE SEQUENCE "order_number_seq" START 1;

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "order_number" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PLACED',
    "payment_method" "PaymentMethod" NOT NULL,
    "payment_status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "warehouse_id" UUID NOT NULL,
    "recipient_name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "division" TEXT NOT NULL,
    "district" TEXT NOT NULL,
    "upazila" TEXT NOT NULL,
    "area" TEXT,
    "address_line" TEXT NOT NULL,
    "post_code" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "subtotal_poysha" BIGINT NOT NULL,
    "delivery_fee_poysha" BIGINT NOT NULL DEFAULT 0,
    "discount_poysha" BIGINT NOT NULL DEFAULT 0,
    "total_poysha" BIGINT NOT NULL,
    "customer_note" TEXT,
    "placed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "delivered_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "product_name_en" TEXT NOT NULL,
    "product_name_bn" TEXT NOT NULL,
    "variant_name_en" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price_poysha" BIGINT NOT NULL,
    "line_total_poysha" BIGINT NOT NULL,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_events" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "from_status" "OrderStatus",
    "to_status" "OrderStatus" NOT NULL,
    "actor_id" UUID,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "orders_order_number_key" ON "orders"("order_number");
CREATE INDEX "orders_user_id_placed_at_idx" ON "orders"("user_id", "placed_at");
CREATE INDEX "orders_status_placed_at_idx" ON "orders"("status", "placed_at");
CREATE INDEX "orders_warehouse_id_status_idx" ON "orders"("warehouse_id", "status");
CREATE INDEX "order_items_order_id_idx" ON "order_items"("order_id");
CREATE INDEX "order_items_variant_id_idx" ON "order_items"("variant_id");
CREATE INDEX "order_events_order_id_created_at_idx" ON "order_events"("order_id", "created_at");

-- Money never goes negative, and a line is never empty.
ALTER TABLE "orders" ADD CONSTRAINT "orders_money_non_negative" CHECK (
    "subtotal_poysha" >= 0 AND "delivery_fee_poysha" >= 0
    AND "discount_poysha" >= 0 AND "total_poysha" >= 0
);
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_money_non_negative"
    CHECK ("unit_price_poysha" >= 0 AND "line_total_poysha" >= 0);

-- AddForeignKey
-- RESTRICT on user and warehouse: an order is a financial record and must stay resolvable.
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "orders" ADD CONSTRAINT "orders_warehouse_id_fkey"
    FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CASCADE from the order: lines and events have no meaning without it.
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey"
    FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variant_id_fkey"
    FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_fkey"
    FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
