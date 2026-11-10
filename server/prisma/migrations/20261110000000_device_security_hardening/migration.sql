-- Device hardware-identity verification & anti-tamper telemetry.
-- Records dual-SIM IMEIs reported by the Device Owner DPC, Device Owner status,
-- and OS/hardware integrity flags (IMEI mismatch, unlocked bootloader, root,
-- custom build keys, or loss of Device Owner privilege).

ALTER TABLE "devices" ADD COLUMN "reported_imei" VARCHAR(20);
ALTER TABLE "devices" ADD COLUMN "reported_imeis" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "devices" ADD COLUMN "reported_serial" VARCHAR(64);
ALTER TABLE "devices" ADD COLUMN "imei_verified_at" TIMESTAMPTZ(3);
ALTER TABLE "devices" ADD COLUMN "is_device_owner" BOOLEAN;
ALTER TABLE "devices" ADD COLUMN "tamper_flags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "devices" ADD COLUMN "tamper_detected_at" TIMESTAMPTZ(3);
ALTER TABLE "devices" ADD COLUMN "tamper_reason" VARCHAR(500);
ALTER TABLE "devices" ADD COLUMN "integrity_checked_at" TIMESTAMPTZ(3);

CREATE INDEX "devices_dealer_id_tamper_detected_at_idx" ON "devices"("dealer_id", "tamper_detected_at");

