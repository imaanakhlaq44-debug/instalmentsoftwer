-- The offline rule: a handset that stops reporting restricts itself.
--
-- Until now, a customer who kept the phone off the network could not be
-- reached. The lock command sat in LOCK_PENDING forever, which was honest but
-- useless — the one thing a financed handset must not be able to do is opt out
-- of management by turning off mobile data.
--
-- The rule is enforced on the phone, because the phone is the only party still
-- present when there is no network. The server's part is to name the number of
-- days and to hear about it afterwards.
--
-- It is OFF by default. A dealer turns it on deliberately, and only contracts
-- signed under terms v1.1 or later disclose it, so the policy value alone is
-- not enough to restrict a handset.
ALTER TABLE "device_policies"
  ADD COLUMN "offline_lock_after_days" INTEGER NOT NULL DEFAULT 0;

-- Reported by the handset at its next check-in, and kept apart from `status`.
-- LOCKED means a lock this server issued and the phone confirmed; this means a
-- lock the phone applied on its own authority while it could not ask.
ALTER TABLE "devices"
  ADD COLUMN "offline_lock_active" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "offline_lock_since"  TIMESTAMPTZ(3);
