-- Where a payment record came from.
--
-- It changes how much the record is worth on its own. COUNTER means staff saw
-- the money. CUSTOMER means somebody reported a transfer and nobody has checked
-- yet — the amount is a claim until it is verified. GATEWAY is not reachable
-- yet; it is named now so that when a processor is integrated the difference is
-- a column rather than a guess from the payment method.
CREATE TYPE "PaymentSource" AS ENUM ('COUNTER', 'CUSTOMER', 'GATEWAY');

ALTER TABLE "payments"
  ADD COLUMN "source"      "PaymentSource" NOT NULL DEFAULT 'COUNTER',
  ADD COLUMN "proof_image" TEXT;

-- The verification queue reads exactly this: one dealership's unverified
-- customer submissions, oldest first.
CREATE INDEX "payments_dealer_id_status_source_idx"
  ON "payments"("dealer_id", "status", "source");
