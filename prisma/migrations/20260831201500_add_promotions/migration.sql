-- CreateEnum
CREATE TYPE "PromotionType" AS ENUM ('PERCENTAGE', 'FIXED_AMOUNT', 'FREE_DELIVERY');

-- CreateTable
CREATE TABLE "promotions" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_bn" TEXT,
    "type" "PromotionType" NOT NULL,
    "value" BIGINT NOT NULL,
    "min_subtotal_poysha" BIGINT NOT NULL DEFAULT 0,
    "max_discount_poysha" BIGINT,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3),
    "usage_limit" INTEGER,
    "per_customer_limit" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promotions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "promotions_code_uppercase" CHECK ("code" = upper("code")),
    CONSTRAINT "promotions_percentage_in_range" CHECK ("type" <> 'PERCENTAGE' OR ("value" BETWEEN 1 AND 100)),
    CONSTRAINT "promotions_cap_only_for_percentage" CHECK ("max_discount_poysha" IS NULL OR "type" = 'PERCENTAGE'),
    CONSTRAINT "promotions_window_ordered" CHECK ("ends_at" IS NULL OR "ends_at" > "starts_at"),
    CONSTRAINT "promotions_limits_positive" CHECK (
        ("usage_limit" IS NULL OR "usage_limit" > 0)
        AND ("per_customer_limit" IS NULL OR "per_customer_limit" > 0)
    ),
    CONSTRAINT "promotions_amounts_non_negative" CHECK ("value" >= 0 AND "min_subtotal_poysha" >= 0)
);

-- CreateTable
CREATE TABLE "promotion_redemptions" (
    "id" UUID NOT NULL,
    "promotion_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "discount_poysha" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promotion_redemptions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "promotion_redemptions_discount_positive" CHECK ("discount_poysha" > 0)
);

-- CreateIndex
CREATE UNIQUE INDEX "promotions_code_key" ON "promotions"("code");

-- CreateIndex
CREATE INDEX "promotions_is_active_starts_at_ends_at_idx" ON "promotions"("is_active", "starts_at", "ends_at");

-- CreateIndex
CREATE UNIQUE INDEX "promotion_redemptions_order_id_key" ON "promotion_redemptions"("order_id");

-- CreateIndex
CREATE INDEX "promotion_redemptions_promotion_id_user_id_idx" ON "promotion_redemptions"("promotion_id", "user_id");

-- AddForeignKey
ALTER TABLE "promotion_redemptions" ADD CONSTRAINT "promotion_redemptions_promotion_id_fkey" FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_redemptions" ADD CONSTRAINT "promotion_redemptions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_redemptions" ADD CONSTRAINT "promotion_redemptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
