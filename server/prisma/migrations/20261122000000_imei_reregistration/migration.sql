-- A phone the shop takes back and sells again must be registrable again.
--
-- The IMEI was unique across every device row, so the closed registration of
-- a repossessed phone blocked its next sale for good. It is now unique among
-- live registrations only: closing one stamps retired_at and keeps the row,
-- its plan, payments and audit trail exactly as they were.
ALTER TABLE "devices" ADD COLUMN "retired_at" TIMESTAMPTZ(3);

DROP INDEX "devices_imei_key";

CREATE UNIQUE INDEX "devices_imei_active_key" ON "devices"("imei") WHERE ("retired_at" IS NULL);

-- Lookups of a phone's earlier, closed registrations.
CREATE INDEX "devices_imei_idx" ON "devices"("imei");
