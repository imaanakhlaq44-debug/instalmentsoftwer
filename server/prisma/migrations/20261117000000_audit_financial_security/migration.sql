ALTER TABLE "users" ADD COLUMN "session_version" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "payments" ADD COLUMN "allocation_json" TEXT;
CREATE UNIQUE INDEX "payments_dealer_id_receipt_number_key" ON "payments"("dealer_id", "receipt_number");
