-- WhatsApp reminders.
--
-- 1. A WHATSAPP channel on the notification queue, for messages that go out
--    through the WhatsApp Business Cloud API when the platform has credentials
--    for it. Nothing is queued on it until a shop chooses it.
-- 2. Two per-shop settings: the language of the click-to-WhatsApp messages the
--    shop sends from its own WhatsApp, and which channel automatic reminders
--    are queued on. Existing shops keep SMS, so nothing changes for them.
ALTER TYPE "NotificationChannel" ADD VALUE IF NOT EXISTS 'WHATSAPP';

ALTER TABLE "device_policies"
  ADD COLUMN "whatsapp_language" VARCHAR(12) NOT NULL DEFAULT 'ROMAN_UR',
  ADD COLUMN "reminder_channel" "NotificationChannel" NOT NULL DEFAULT 'SMS';
