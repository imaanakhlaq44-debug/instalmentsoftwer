-- Hosted-checkout attempts at a payment gateway (JazzCash today).
--
-- One row per "Pay now" press. The row is what a gateway callback is checked
-- against: the reference must exist, the merchant and the amount must match,
-- and the status moves to PAID exactly once — in the same transaction that
-- records the payment — so a repeated callback can never apply money twice.
--
-- No secrets are stored here: `merchant_id` is the public merchant identifier.

CREATE TABLE "gateway_checkouts" (
    "id" TEXT NOT NULL,
    "dealer_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "provider" VARCHAR(20) NOT NULL,
    "reference" VARCHAR(40) NOT NULL,
    "merchant_id" VARCHAR(60) NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" VARCHAR(12) NOT NULL DEFAULT 'CREATED',
    "payment_id" TEXT,
    "provider_txn_id" VARCHAR(80),
    "response_code" VARCHAR(20),
    "response_message" VARCHAR(300),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "gateway_checkouts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "gateway_checkouts_reference_key" ON "gateway_checkouts"("reference");
CREATE INDEX "gateway_checkouts_customer_id_created_at_idx" ON "gateway_checkouts"("customer_id", "created_at" DESC);
CREATE INDEX "gateway_checkouts_dealer_id_status_idx" ON "gateway_checkouts"("dealer_id", "status");
