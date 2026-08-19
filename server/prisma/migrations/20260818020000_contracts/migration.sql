-- The customer's recorded consent to the financing terms and to the device
-- restriction that enforces them.
--
-- The system can lock a phone somebody is paying for. Doing that on the
-- strength of a verbal understanding at a counter is not defensible, so a
-- signed contract is what a lock now rests on.
CREATE TYPE "ContractStatus" AS ENUM ('DRAFT', 'SIGNED', 'VOID');

CREATE TABLE "contracts" (
  "id"              TEXT             NOT NULL,
  "dealer_id"       TEXT             NOT NULL,
  "customer_id"     TEXT             NOT NULL,
  "device_id"       TEXT             NOT NULL,
  "plan_id"         TEXT             NOT NULL,
  "terms_version"   VARCHAR(20)      NOT NULL,
  -- The facts the document was rendered from, frozen as JSON.
  "snapshot"        TEXT             NOT NULL,
  "status"          "ContractStatus" NOT NULL DEFAULT 'DRAFT',
  "signed_at"       TIMESTAMPTZ(3),
  "signer_name"     VARCHAR(120),
  "signature_image" TEXT,
  "signed_ip"       VARCHAR(64),
  -- SHA-256 over the terms version and the snapshot. Editing the plan after
  -- signing therefore cannot quietly change what somebody agreed to.
  "document_hash"   VARCHAR(64),
  "voided_at"       TIMESTAMPTZ(3),
  "void_reason"     VARCHAR(300),
  "created_at"      TIMESTAMPTZ(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- One plan per device, so one contract per device. Unique rather than merely
-- indexed: two live contracts for one handset would leave it ambiguous which
-- consent a lock was resting on.
CREATE UNIQUE INDEX "contracts_device_id_key" ON "contracts"("device_id");
CREATE UNIQUE INDEX "contracts_plan_id_key" ON "contracts"("plan_id");
CREATE INDEX "contracts_dealer_id_created_at_idx" ON "contracts"("dealer_id", "created_at" DESC);
CREATE INDEX "contracts_customer_id_idx" ON "contracts"("customer_id");
CREATE INDEX "contracts_status_idx" ON "contracts"("status");

ALTER TABLE "contracts"
  ADD CONSTRAINT "contracts_dealer_id_fkey"
  FOREIGN KEY ("dealer_id") REFERENCES "dealers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "contracts"
  ADD CONSTRAINT "contracts_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "contracts"
  ADD CONSTRAINT "contracts_device_id_fkey"
  FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "contracts"
  ADD CONSTRAINT "contracts_plan_id_fkey"
  FOREIGN KEY ("plan_id") REFERENCES "installment_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
