-- Location for recovery: off by default, consent-gated, request-driven.
ALTER TABLE "device_policies" ADD COLUMN "location_on_recovery_enabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "devices" ADD COLUMN "location_requested_at" TIMESTAMPTZ(3);
ALTER TABLE "devices" ADD COLUMN "location_requested_by" VARCHAR(120);
ALTER TABLE "devices" ADD COLUMN "location_at" TIMESTAMPTZ(3);
ALTER TABLE "devices" ADD COLUMN "location_accuracy" DOUBLE PRECISION;

-- Coordinates were accepted unconditionally before and the seed invented some.
-- None of them was asked for under a signed agreement, so none is kept.
UPDATE "devices" SET "location_lat" = NULL, "location_lng" = NULL;
