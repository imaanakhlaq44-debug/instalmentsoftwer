import { repo } from '../db/repositories/index.js';
import { config } from '../config.js';
import { Notification, SmsChannel } from '../types/index.js';
import { HttpSmsProvider, SmsProvider, TwilioSmsProvider } from './sms/SmsProvider.js';

/**
 * Drains the notification queue through an SMS aggregator account.
 *
 * The paired phone was the only way out for a reminder; this is the second,
 * for shops that need volume and a sender mask customers recognise. It obeys
 * the rule the phone obeys: **a message is SENT only when the gateway says it
 * accepted it.** A refusal, a timeout or a dead connection leaves the message
 * unsent with the reason written beside it — retried with a growing wait, and
 * past the attempt cap either FAILED or, for a shop that asked for it, handed
 * to the paired phone.
 *
 * It shares the queue with paired phones through one lock, `leaseUntil`. The
 * worker only ever sends a row it has leased, a phone only ever sends a row it
 * has leased, and neither can lease what the other holds.
 */

/** Long enough for a whole batch at the configured timeout, with room to spare. */
const LEASE_MS = 5 * 60_000;

/** Bounded so one slow gateway cannot hold more than a lease's worth of messages. */
const BATCH = 20;

/** The wait before try 2, 3, 4…; the last value repeats. */
const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000];

export interface AggregatorDescription {
  /** True when an aggregator account is configured on this server. */
  configured: boolean;
  provider?: string;
  senderMask?: string;
}

export interface DrainResult {
  claimed: number;
  sent: number;
  /** Refused or unreachable, and left on the queue for another try. */
  retried: number;
  failed: number;
  /** Given up by the aggregator and left for the shop's paired phone. */
  handedToPhone: number;
}

function providerFromConfig(): SmsProvider | null {
  const sms = config.sms;
  if (sms.provider === 'http') return new HttpSmsProvider({ ...sms.http, timeoutMs: sms.timeoutMs });
  if (sms.provider === 'twilio') return new TwilioSmsProvider({ ...sms.twilio, timeoutMs: sms.timeoutMs });
  return null;
}

export class SmsAggregatorService {
  private static provider: SmsProvider | null = providerFromConfig();
  private static draining = false;

  /** Swaps the provider. Tests use this to put a fake gateway behind the worker. */
  public static useProvider(provider: SmsProvider | null): void {
    this.provider = provider;
  }

  public static isConfigured(): boolean {
    return this.provider !== null;
  }

  public static describe(): AggregatorDescription {
    return this.provider
      ? { configured: true, provider: this.provider.name, senderMask: this.provider.senderMask }
      : { configured: false };
  }

  /**
   * The channel a shop's SMS actually take right now.
   *
   * A shop set to the aggregator on a server that has none configured falls
   * back to its phone: the alternative is a queue nobody is allowed to drain.
   */
  public static effectiveChannel(chosen: SmsChannel | undefined): SmsChannel {
    if (!this.provider) return 'PHONE';
    return chosen ?? 'PHONE';
  }

  public static async effectiveChannelFor(dealerId: string): Promise<SmsChannel> {
    if (!this.provider) return 'PHONE';
    const policy = await repo.devicePolicies.findByDealer(dealerId);
    return this.effectiveChannel(policy?.smsChannel);
  }

  /**
   * One pass over the queue: claim a batch, send each message, record what the
   * gateway said. Safe to call on a timer — a pass that is still running makes
   * the next one a no-op rather than a second sender.
   */
  public static async drainOnce(): Promise<DrainResult> {
    const result: DrainResult = { claimed: 0, sent: 0, retried: 0, failed: 0, handedToPhone: 0 };
    const provider = this.provider;
    if (!provider || this.draining) return result;

    this.draining = true;
    try {
      const policies = await repo.devicePolicies.findUsingAggregator();
      if (policies.length === 0) return result;

      const channelByDealer = new Map(policies.map((p) => [p.dealerId, p.smsChannel ?? 'PHONE']));
      const maxAttempts = config.sms.maxAttempts;
      const leaseUntil = new Date(Date.now() + LEASE_MS);

      const claimed = await repo.notifications.claimForAggregator(
        [...channelByDealer.keys()],
        BATCH,
        leaseUntil,
        maxAttempts
      );
      result.claimed = claimed.length;
      if (claimed.length === 0) return result;

      const customerIds = [...new Set(claimed.map((n) => n.customerId).filter(Boolean))] as string[];
      const customers = await repo.customers.findByIds(customerIds);
      const phoneById = new Map(customers.map((c) => [c.id, c.phone]));

      for (let i = 0; i < claimed.length; i++) {
        // Never send on a lease that is about to lapse: once it does, a phone
        // or another worker may claim the row, and both would send it.
        if (Date.now() + config.sms.timeoutMs + 5_000 > leaseUntil.getTime()) {
          await this.release(claimed.slice(i));
          break;
        }

        const notification = claimed[i];
        const canFallBack = channelByDealer.get(notification.dealerId) === 'AGGREGATOR_THEN_PHONE';
        const to = notification.customerId ? phoneById.get(notification.customerId) : undefined;

        if (!to) {
          // No phone could send this either; handing it over would only move
          // the same dead end to another queue.
          await this.fail(notification, 'No phone number is on file for this customer.');
          result.failed++;
          continue;
        }

        let outcome;
        try {
          // The body only. The title is a dashboard label and would pad an SMS
          // the shop is paying for by the part.
          outcome = await provider.send({ to, message: notification.message });
        } catch (err) {
          // A provider is meant to return its failures. One that throws has
          // not accepted anything, and must not take the batch down with it.
          const name = err instanceof Error ? err.name : 'Error';
          outcome = { accepted: false as const, retryable: true, reason: `The SMS provider failed unexpectedly (${name}).` };
        }

        if (outcome.accepted) {
          await repo.notifications.update(notification.id, {
            status: 'SENT',
            sentAt: new Date().toISOString(),
            sentVia: 'AGGREGATOR',
            providerMessageId: outcome.providerMessageId?.slice(0, 120),
            leaseUntil: undefined,
            nextAttemptAt: undefined,
            failureReason: undefined,
          });
          result.sent++;
          continue;
        }

        const attempts = notification.aggregatorAttempts ?? 1;
        const exhausted = !outcome.retryable || attempts >= maxAttempts;

        if (!exhausted) {
          const wait = BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)];
          await repo.notifications.update(notification.id, {
            leaseUntil: undefined,
            nextAttemptAt: new Date(Date.now() + wait).toISOString(),
            failureReason: outcome.reason.slice(0, 300),
          });
          result.retried++;
        } else if (canFallBack) {
          await repo.notifications.update(notification.id, {
            leaseUntil: undefined,
            nextAttemptAt: undefined,
            phoneFallbackAt: new Date().toISOString(),
            failureReason: outcome.reason.slice(0, 300),
          });
          result.handedToPhone++;
        } else {
          await this.fail(notification, outcome.reason);
          result.failed++;
        }
      }

      return result;
    } finally {
      this.draining = false;
    }
  }

  private static async fail(notification: Notification, reason: string): Promise<void> {
    await repo.notifications.update(notification.id, {
      status: 'FAILED',
      leaseUntil: undefined,
      nextAttemptAt: undefined,
      failureReason: reason.slice(0, 300),
    });
  }

  /** Puts back messages that were claimed but never tried, without charging them an attempt. */
  private static async release(notifications: Notification[]): Promise<void> {
    for (const n of notifications) {
      await repo.notifications.update(n.id, {
        leaseUntil: undefined,
        aggregatorAttempts: Math.max((n.aggregatorAttempts ?? 1) - 1, 0),
      });
    }
  }
}
