-- Live Factory Reset Protection (FRP) verification status reported by DPC.
-- Records whether the OS actually retained the enterprise FRP policy, fell back
-- to legacy Play services managed config, or refused/dropped FRP on read-back.

ALTER TABLE "devices" ADD COLUMN "frp_status" VARCHAR(24);
ALTER TABLE "devices" ADD COLUMN "frp_error" VARCHAR(300);
ALTER TABLE "devices" ADD COLUMN "frp_verified_at" TIMESTAMPTZ(3);

CREATE INDEX "devices_dealer_id_frp_status_idx" ON "devices"("dealer_id", "frp_status");

