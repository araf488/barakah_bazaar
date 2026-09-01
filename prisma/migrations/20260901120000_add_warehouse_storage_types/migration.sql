-- AlterTable
ALTER TABLE "warehouses" ADD COLUMN "storage_types" "StorageType"[] DEFAULT ARRAY['AMBIENT']::"StorageType"[];

-- Existing hubs are backfilled to AMBIENT by the default above. Narrow on purpose: a hub is a
-- dry room until someone says it has a chiller, and the safe default refuses frozen stock
-- rather than silently accepting it.
UPDATE "warehouses" SET "storage_types" = ARRAY['AMBIENT']::"StorageType"[] WHERE "storage_types" IS NULL;

ALTER TABLE "warehouses" ALTER COLUMN "storage_types" SET NOT NULL;

-- A hub that can hold nothing can receive nothing, which is a warehouse that is not a
-- warehouse. Almost certainly an empty array sent by mistake.
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_storage_types_not_empty"
    CHECK (array_length("storage_types", 1) >= 1);
