-- A phone paired to a dealership to send its SMS.
--
-- No aggregator is connected yet, so a shop can pair its own handset: it polls
-- for queued messages, sends them from its own SIM and reports the outcome. It
-- authenticates the way the DPC does — only the SHA-256 hash of the token is
-- stored — and it is scoped to one dealer.
CREATE TABLE "sms_relays" (
  "id"           TEXT         NOT NULL,
  "dealer_id"    TEXT         NOT NULL,
  "name"         VARCHAR(80)  NOT NULL,
  "token_hash"   VARCHAR(64)  NOT NULL,
  "last_seen_at" TIMESTAMPTZ(3),
  "sent_count"   INTEGER      NOT NULL DEFAULT 0,
  "failed_count" INTEGER      NOT NULL DEFAULT 0,
  "revoked_at"   TIMESTAMPTZ(3),
  "created_at"   TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "sms_relays_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "sms_relays_dealer_id_idx" ON "sms_relays"("dealer_id");

ALTER TABLE "sms_relays"
  ADD CONSTRAINT "sms_relays_dealer_id_fkey"
  FOREIGN KEY ("dealer_id") REFERENCES "dealers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Delivery state on the message itself.
--
-- `lease_until` is what stops two relays sending the same overdue-payment text:
-- claiming is a compare-and-set on this column, and a phone that loses signal
-- mid-batch simply lets its lease expire instead of stranding the message.
ALTER TABLE "notifications"
  ADD COLUMN "lease_until"    TIMESTAMPTZ(3),
  ADD COLUMN "attempts"       INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "failure_reason" VARCHAR(300);

-- The claim query: this dealer's unsent SMS, oldest first.
CREATE INDEX "notifications_dealer_id_status_channel_idx"
  ON "notifications"("dealer_id", "status", "channel");
