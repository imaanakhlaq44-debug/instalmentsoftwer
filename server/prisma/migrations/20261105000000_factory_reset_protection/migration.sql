-- Factory Reset Protection for financed handsets.
--
-- The DPC already blocks a factory reset from Settings, but a reset from the
-- recovery menu (hardware buttons) happens below Android and wipes the app with
-- everything else. Without FRP the phone then comes back clean and unmanaged.
--
-- With FRP, a phone wiped that way can only be set up again by signing in with
-- one of these Google accounts — the dealer's — who then re-enrols it.
--
-- These are Google account ids (the numeric id), not email addresses: that is
-- what Android's FactoryResetProtectionPolicy takes. Empty by default, so
-- nothing changes for a dealer until they configure it.
ALTER TABLE "device_policies"
  ADD COLUMN "frp_account_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
