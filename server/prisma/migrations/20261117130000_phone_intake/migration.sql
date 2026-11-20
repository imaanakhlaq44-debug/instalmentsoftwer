CREATE TABLE "phone_intakes" (
 "id" TEXT PRIMARY KEY,
 "dealer_id" TEXT NOT NULL REFERENCES "dealers"("id") ON DELETE CASCADE,
 "token_id" TEXT NOT NULL UNIQUE REFERENCES "enrollment_tokens"("id") ON DELETE CASCADE,
 "report" JSONB,
 "identity_hash" VARCHAR(64),
 "device_id" TEXT UNIQUE REFERENCES "devices"("id") ON DELETE RESTRICT,
 "reported_at" TIMESTAMPTZ(3),
 "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "phone_intakes_dealer_id_created_at_idx" ON "phone_intakes"("dealer_id", "created_at");
