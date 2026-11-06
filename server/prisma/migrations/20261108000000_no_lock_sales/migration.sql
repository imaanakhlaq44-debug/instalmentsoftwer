-- A sale on a phone this system cannot lock (newer Huawei without Google
-- services, an iPhone, a handset older than Android 8). The plan, contract and
-- ledger work as for any sale; the phone never gets a QR, never spends a lock
-- and is never sent a lock command.
ALTER TABLE "devices"
  ADD COLUMN "no_lock" BOOLEAN NOT NULL DEFAULT false;
