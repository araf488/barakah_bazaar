-- CreateTable
CREATE TABLE "carts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "carts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cart_items" (
    "id" UUID NOT NULL,
    "cart_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price_poysha_at_add" BIGINT NOT NULL,
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cart_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- One cart per customer. A second live cart would mean the storefront and the app disagree.
CREATE UNIQUE INDEX "carts_user_id_key" ON "carts"("user_id");

-- One line per variant: adding the same item twice raises the quantity rather than creating
-- a second line the customer has to reconcile by hand.
CREATE UNIQUE INDEX "cart_items_cart_id_variant_id_key" ON "cart_items"("cart_id", "variant_id");
CREATE INDEX "cart_items_variant_id_idx" ON "cart_items"("variant_id");

-- A basket line is never zero or negative; removing an item deletes the row.
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_price_non_negative"
    CHECK ("unit_price_poysha_at_add" >= 0);

-- AddForeignKey
-- CASCADE from user and cart: a basket is disposable, unlike an order.
ALTER TABLE "carts" ADD CONSTRAINT "carts_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_cart_id_fkey"
    FOREIGN KEY ("cart_id") REFERENCES "carts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- RESTRICT on the variant: a variant sitting in somebody's basket must not vanish.
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_variant_id_fkey"
    FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
