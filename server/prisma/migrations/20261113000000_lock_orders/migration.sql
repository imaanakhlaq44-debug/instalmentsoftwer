-- Lock orders: a shop buys a pack from its own dashboard.
--
-- Until now a shop ordered over WhatsApp and the super admin issued the pack by
-- hand. An order records what the shop asked for, the transfer it says it made
-- and the platform's decision. The order itself mints nothing: approval by a
-- super admin is what issues the pack, and "pack_id" is unique so one order can
-- never produce two.

CREATE TYPE "LockOrderStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

CREATE TABLE "lock_orders" (
  "id"                TEXT              NOT NULL,
  "dealer_id"         TEXT              NOT NULL,
  "size"              INTEGER           NOT NULL,
  "unit_price"        INTEGER           NOT NULL,
  "total_price"       INTEGER           NOT NULL,
  "status"            "LockOrderStatus" NOT NULL DEFAULT 'PENDING',
  "payment_method"    "PaymentMethod"   NOT NULL,
  "transaction_id"    VARCHAR(60)       NOT NULL,
  "amount_paid"       INTEGER           NOT NULL,
  "proof_image"       TEXT,
  "note"              VARCHAR(500),
  "submitted_by_id"   VARCHAR(64)       NOT NULL,
  "submitted_by_name" VARCHAR(120)      NOT NULL,
  "reviewed_by_id"    VARCHAR(64),
  "reviewed_by_name"  VARCHAR(120),
  "reviewed_at"       TIMESTAMPTZ(3),
  "rejection_reason"  VARCHAR(500),
  "pack_id"           TEXT,
  "created_at"        TIMESTAMPTZ(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "lock_orders_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "lock_orders_pack_id_key" ON "lock_orders"("pack_id");
CREATE INDEX "lock_orders_dealer_id_created_at_idx" ON "lock_orders"("dealer_id", "created_at" DESC);
CREATE INDEX "lock_orders_status_created_at_idx" ON "lock_orders"("status", "created_at");

ALTER TABLE "lock_orders"
  ADD CONSTRAINT "lock_orders_dealer_id_fkey"
  FOREIGN KEY ("dealer_id") REFERENCES "dealers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "lock_orders"
  ADD CONSTRAINT "lock_orders_pack_id_fkey"
  FOREIGN KEY ("pack_id") REFERENCES "license_packs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Settings the super admin edits from the dashboard; today, the payment
-- instructions a shop sees when it buys locks.
CREATE TABLE "platform_settings" (
  "id"              VARCHAR(60)    NOT NULL,
  "value"           TEXT           NOT NULL,
  "updated_by_id"   VARCHAR(64),
  "updated_by_name" VARCHAR(120),
  "updated_at"      TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("id")
);
