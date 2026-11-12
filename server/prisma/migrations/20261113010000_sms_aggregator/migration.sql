-- An SMS aggregator as a second way out for the notification queue.
--
-- Until now the only route was a phone the shop paired. A shop can now choose,
-- per dealership, whether its SMS leave through that phone, through the
-- platform's aggregator account (branded sender mask), or through the
-- aggregator with the phone as a fallback.
CREATE TYPE "SmsChannel" AS ENUM ('PHONE', 'AGGREGATOR', 'AGGREGATOR_THEN_PHONE');

ALTER TABLE "device_policies"
  ADD COLUMN "sms_channel" "SmsChannel" NOT NULL DEFAULT 'PHONE';

-- Delivery bookkeeping for the aggregator, beside the relay's own columns.
--
-- `lease_until` stays the single lock both senders respect: whoever holds it
-- owns the message, so the aggregator worker and a paired phone can never both
-- send the same reminder. The aggregator keeps its own attempt counter so its
-- retries do not eat the phone's, and `phone_fallback_at` is the explicit
-- hand-over: set once the aggregator has given up, it is the only thing that
-- lets a phone collect a message in "aggregator, then phone" mode.
ALTER TABLE "notifications"
  ADD COLUMN "sent_via"            VARCHAR(20),
  ADD COLUMN "provider_message_id" VARCHAR(120),
  ADD COLUMN "aggregator_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "next_attempt_at"     TIMESTAMPTZ(3),
  ADD COLUMN "phone_fallback_at"   TIMESTAMPTZ(3);
