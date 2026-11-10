-- Serial-number pinning and hardware key attestation.
--
-- enrolled_serial: the handset serial first seen after enrollment; a different
-- serial later means a different phone behind the same IMEI.
-- attestation_*/attested_*: the TEE/StrongBox-signed record of the handset's
-- factory IMEI(s), serial and bootloader state, verified against Google's root.

ALTER TABLE "devices" ADD COLUMN "enrolled_serial" VARCHAR(64);
ALTER TABLE "devices" ADD COLUMN "attestation_challenge" VARCHAR(64);
ALTER TABLE "devices" ADD COLUMN "attestation_challenge_at" TIMESTAMPTZ(3);
ALTER TABLE "devices" ADD COLUMN "attestation_status" VARCHAR(24);
ALTER TABLE "devices" ADD COLUMN "attestation_reason" VARCHAR(300);
ALTER TABLE "devices" ADD COLUMN "attestation_checked_at" TIMESTAMPTZ(3);
ALTER TABLE "devices" ADD COLUMN "attested_at" TIMESTAMPTZ(3);
ALTER TABLE "devices" ADD COLUMN "attestation_security_level" VARCHAR(16);
ALTER TABLE "devices" ADD COLUMN "attested_imeis" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "devices" ADD COLUMN "attested_serial" VARCHAR(64);
ALTER TABLE "devices" ADD COLUMN "attested_brand" VARCHAR(64);
ALTER TABLE "devices" ADD COLUMN "attested_model" VARCHAR(64);
ALTER TABLE "devices" ADD COLUMN "attested_boot_locked" BOOLEAN;
ALTER TABLE "devices" ADD COLUMN "attested_boot_state" VARCHAR(16);

-- Phones already enrolled under DPC 1.4.0 reported their serial at enrollment.
UPDATE "devices"
   SET "enrolled_serial" = "reported_serial"
 WHERE "reported_serial" IS NOT NULL
   AND "status" <> 'PENDING';
