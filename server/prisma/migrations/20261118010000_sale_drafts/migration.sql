CREATE TABLE "sale_drafts" (
 "id" UUID PRIMARY KEY, "dealer_id" TEXT NOT NULL REFERENCES "dealers"("id") ON DELETE CASCADE,
 "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
 "data" JSONB NOT NULL, "version" INTEGER NOT NULL DEFAULT 1, "completed_at" TIMESTAMPTZ(3), "device_id" TEXT,
 "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "sale_drafts_dealer_id_completed_at_updated_at_idx" ON "sale_drafts"("dealer_id","completed_at","updated_at");

ALTER TABLE "devices" ADD COLUMN "command_version" INTEGER NOT NULL DEFAULT 0;
