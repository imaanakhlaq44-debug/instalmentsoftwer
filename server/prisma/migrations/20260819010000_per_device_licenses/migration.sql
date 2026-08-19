-- Licensing moves from a subscription tier to a lock sold per handset.
--
-- The old model rented a *ceiling*: a dealer paid monthly for the right to have
-- up to N devices under management at once, and a device that finished its plan
-- freed its slot for the next customer. The product is not sold that way. What a
-- shop buys is the ability to hold one specific phone, once — so a lock is now a
-- physical-feeling thing: it is bought in a pack, spent on exactly one IMEI at
-- enrolment, and never comes back.
--
-- Every existing tier licence is dropped rather than converted. This was the
-- explicit decision: no dealer keeps a grandfathered quota, and both systems do
-- not run side by side.

-- A lock's whole life. VOID exists for a pack the platform writes off (refunded,
-- or issued to the wrong dealer) — never spent, and never spendable.
CREATE TYPE "DeviceLicenseStatus" AS ENUM ('AVAILABLE', 'CONSUMED', 'VOID');

-- One purchase.
CREATE TABLE "license_packs" (
  "id"             TEXT         NOT NULL,
  "dealer_id"      TEXT         NOT NULL,
  "size"           INTEGER      NOT NULL,
  "unit_price"     INTEGER      NOT NULL,
  "total_price"    INTEGER      NOT NULL,
  "reference"      VARCHAR(80),
  "issued_by_id"   TEXT,
  "issued_by_name" VARCHAR(120) NOT NULL,
  "created_at"     TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "license_packs_pkey" PRIMARY KEY ("id")
);

-- One lock for one handset.
CREATE TABLE "device_licenses" (
  "id"          TEXT                  NOT NULL,
  "dealer_id"   TEXT                  NOT NULL,
  "pack_id"     TEXT                  NOT NULL,
  "license_key" VARCHAR(40)           NOT NULL,
  "status"      "DeviceLicenseStatus" NOT NULL DEFAULT 'AVAILABLE',
  "device_id"   TEXT,
  "imei"        VARCHAR(20),
  "consumed_at" TIMESTAMPTZ(3),
  "created_at"  TIMESTAMPTZ(3)        NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "device_licenses_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "device_licenses_license_key_key" ON "device_licenses"("license_key");

-- The rule the product rests on, enforced by the database rather than by code:
-- a device can hold at most one lock. Re-enrolling a handset after a factory
-- reset therefore cannot quietly spend a second one.
CREATE UNIQUE INDEX "device_licenses_device_id_key" ON "device_licenses"("device_id");

-- "Have we got a lock left?" — asked at every enrolment and on every dashboard.
CREATE INDEX "device_licenses_dealer_id_status_idx" ON "device_licenses"("dealer_id", "status");
CREATE INDEX "device_licenses_pack_id_idx" ON "device_licenses"("pack_id");
CREATE INDEX "license_packs_dealer_id_idx" ON "license_packs"("dealer_id");

ALTER TABLE "license_packs"
  ADD CONSTRAINT "license_packs_dealer_id_fkey"
  FOREIGN KEY ("dealer_id") REFERENCES "dealers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "device_licenses"
  ADD CONSTRAINT "device_licenses_dealer_id_fkey"
  FOREIGN KEY ("dealer_id") REFERENCES "dealers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "device_licenses"
  ADD CONSTRAINT "device_licenses_pack_id_fkey"
  FOREIGN KEY ("pack_id") REFERENCES "license_packs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The tier model, and the pointer the dealer row kept into it.
ALTER TABLE "dealers" DROP COLUMN IF EXISTS "license_key_id";
DROP TABLE IF EXISTS "license_keys";
DROP TYPE IF EXISTS "LicensePlan";
DROP TYPE IF EXISTS "LicenseStatus";
