-- Staged restrictions: instead of a full lock at the first missed installment,
-- one missed installment blocks outgoing calls and SMS, two also suspend
-- social and video apps, and three lock the phone.
--
-- Off for every existing dealership, so nothing changes for a shop until it
-- chooses; new shops are created with it on. A handset only acts on it when
-- the contract its customer signed describes it (terms v1.2).
ALTER TABLE "device_policies"
  ADD COLUMN "staged_restrictions_enabled" BOOLEAN NOT NULL DEFAULT false;
