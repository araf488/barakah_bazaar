-- CreateEnum
CREATE TYPE "PaymentDirection" AS ENUM ('CHARGE', 'REFUND');

-- CreateEnum
CREATE TYPE "PaymentTransactionStatus" AS ENUM ('PENDING', 'CAPTURED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "payment_transactions" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "direction" "PaymentDirection" NOT NULL DEFAULT 'CHARGE',
    "status" "PaymentTransactionStatus" NOT NULL DEFAULT 'PENDING',
    "amount_poysha" BIGINT NOT NULL,
    "gateway_reference" TEXT,
    "collected_by" UUID,
    "failure_reason" TEXT,
    "captured_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_transactions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payment_transactions_amount_positive" CHECK ("amount_poysha" > 0),
    CONSTRAINT "payment_transactions_captured_has_time"
        CHECK ("status" <> 'CAPTURED' OR "captured_at" IS NOT NULL)
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_transactions_gateway_reference_key" ON "payment_transactions"("gateway_reference");

-- CreateIndex
CREATE INDEX "payment_transactions_order_id_created_at_idx" ON "payment_transactions"("order_id", "created_at");

-- CreateIndex
CREATE INDEX "payment_transactions_status_created_at_idx" ON "payment_transactions"("status", "created_at");

-- AddForeignKey
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
