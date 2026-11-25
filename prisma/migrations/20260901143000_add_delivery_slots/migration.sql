-- CreateTable
CREATE TABLE "delivery_slots" (
    "id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "label_en" TEXT NOT NULL,
    "label_bn" TEXT,
    "start_minute" INTEGER NOT NULL,
    "end_minute" INTEGER NOT NULL,
    "days_of_week" INTEGER[],
    "capacity" INTEGER NOT NULL,
    "cutoff_minutes" INTEGER NOT NULL DEFAULT 0,
    "supports_perishable" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_slots_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "delivery_slots_window_within_day" CHECK ("start_minute" >= 0 AND "end_minute" <= 1440),
    CONSTRAINT "delivery_slots_window_ordered" CHECK ("end_minute" > "start_minute"),
    CONSTRAINT "delivery_slots_capacity_positive" CHECK ("capacity" > 0),
    CONSTRAINT "delivery_slots_cutoff_not_negative" CHECK ("cutoff_minutes" >= 0),
    CONSTRAINT "delivery_slots_runs_some_day" CHECK (array_length("days_of_week", 1) >= 1)
);

-- CreateIndex
CREATE INDEX "delivery_slots_warehouse_id_is_active_idx" ON "delivery_slots"("warehouse_id", "is_active");

-- AddForeignKey
ALTER TABLE "delivery_slots" ADD CONSTRAINT "delivery_slots_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN "delivery_slot_id" UUID,
                     ADD COLUMN "delivery_date" DATE;

-- CreateIndex
CREATE INDEX "orders_delivery_slot_id_delivery_date_idx" ON "orders"("delivery_slot_id", "delivery_date");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_delivery_slot_id_fkey" FOREIGN KEY ("delivery_slot_id") REFERENCES "delivery_slots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
