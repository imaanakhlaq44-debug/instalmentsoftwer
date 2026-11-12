/**
 * What the notifications page says about one message's delivery.
 *
 * Kept apart from the page so the wording can be tested: a queued reminder
 * shown with a tick, or a failure shown without its reason, is how a shop ends
 * up believing a customer was warned when they were not.
 */

export interface SmsCost {
  encoding: 'GSM-7' | 'UCS-2';
  unicode: boolean;
  length: number;
  segments: number;
}

export interface DeliveryFacts {
  status: string;
  channel?: string;
  sentVia?: string;
  failureReason?: string;
  nextAttemptAt?: string;
  phoneFallbackAt?: string;
  attempts?: number;
  aggregatorAttempts?: number;
  sms?: SmsCost;
}

export type DeliveryTone = 'sent' | 'waiting' | 'failed';

export interface DeliveryView {
  label: string;
  tone: DeliveryTone;
  /** Which sender actually sent it. Only ever set for a message that was sent. */
  via?: string;
  /** Why it has not gone, when there is a reason on record. */
  reason?: string;
}

export function describeDelivery(n: DeliveryFacts): DeliveryView {
  const via =
    n.sentVia === 'AGGREGATOR' ? 'via SMS gateway' : n.sentVia === 'PHONE' ? 'via paired phone' : undefined;

  switch (n.status) {
    case 'DELIVERED':
      return { label: 'Delivered', tone: 'sent', via };
    case 'SENT':
      return { label: 'Sent', tone: 'sent', via };
    case 'FAILED':
      return { label: 'Failed', tone: 'failed', reason: n.failureReason };
    default:
      // Still on the queue. Say what it is waiting for rather than just "queued".
      if (n.phoneFallbackAt) {
        return { label: 'Waiting for paired phone', tone: 'waiting', reason: n.failureReason };
      }
      if (n.failureReason) {
        return { label: 'Will retry', tone: 'waiting', reason: n.failureReason };
      }
      return { label: 'Queued', tone: 'waiting' };
  }
}

/** "2 SMS · 71 characters · Urdu script" — what the message costs to send. */
export function smsCostLabel(sms: SmsCost | undefined): string | undefined {
  if (!sms || sms.segments === 0) return undefined;
  const base = `${sms.segments} SMS · ${sms.length} characters`;
  return sms.unicode ? `${base} · Urdu script` : base;
}

export type SmsChannel = 'PHONE' | 'AGGREGATOR' | 'AGGREGATOR_THEN_PHONE';

export const SMS_CHANNEL_OPTIONS: { value: SmsChannel; label: string; needsGateway: boolean }[] = [
  { value: 'PHONE', label: 'Paired phone (shop SIM)', needsGateway: false },
  { value: 'AGGREGATOR', label: 'SMS gateway (brand name)', needsGateway: true },
  { value: 'AGGREGATOR_THEN_PHONE', label: 'SMS gateway, then paired phone', needsGateway: true },
];
