-- AlterTable
ALTER TABLE "payment_transactions" ADD COLUMN     "gateway_transaction_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "payment_transactions_gateway_transaction_id_key" ON "payment_transactions"("gateway_transaction_id");

