-- Credentials the Device Policy Controller on the phone uses to authenticate.
--
-- Only the token's hash is stored. The token itself is shown once, at the end of
-- enrollment, and lives on the handset from then on — a leak of this table must
-- not let anyone impersonate a customer's device.
ALTER TABLE "devices"
  ADD COLUMN "auth_token_hash"      VARCHAR(64),
  ADD COLUMN "auth_token_issued_at" TIMESTAMPTZ(3),
  ADD COLUMN "dpc_version"          VARCHAR(20),
  ADD COLUMN "last_check_in_at"     TIMESTAMPTZ(3);

-- Every DPC request resolves the device by this hash before doing anything else.
CREATE INDEX "devices_auth_token_hash_idx" ON "devices"("auth_token_hash");
