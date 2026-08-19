import { v4 as uuidv4 } from 'uuid';

import { repo } from '../db/repositories/index.js';
import { AuditService } from './AuditService.js';
import { AppError } from '../utils/AppError.js';
import { issueDeviceToken } from '../utils/deviceToken.js';
import { Notification, SmsRelay, UserRole } from '../types/index.js';

/**
 * Delivery of SMS through a phone the shop pairs with the system.
 *
 * There is no aggregator behind this yet, and rather than let messages sit in
 * the database looking as though they had been sent, a dealership can pair its
 * own handset: the phone asks for queued messages, sends them from its own SIM
 * and reports what happened to each one. Nothing is marked SENT until the phone
 * says the SIM accepted it — the same rule the device lock follows, for the
 * same reason.
 *
 * This is honest about what it is: a way to get reminders moving on one shop's
 * own SIM. Commercial bulk SMS in Pakistan goes through an operator with a
 * registered sender mask, and a relay does not change that.
 */

/** How long a relay holds a claimed batch before the messages return to the queue. */
const LEASE_SECONDS = 180;

/** A phone gets a bounded batch so a lost handset cannot strand the whole queue. */
const MAX_BATCH = 20;

/** A relay seen within this window is considered connected. */
const ONLINE_WINDOW_MS = 10 * 60_000;

/** After this many tries a message stops being re-offered to the phone. */
const MAX_ATTEMPTS = 5;

export interface RelayActor {
  userId: string;
  userName: string;
  userRole: UserRole;
}

/** One message as the phone needs it — the text, and who to send it to. */
export interface OutboxMessage {
  id: string;
  to: string;
  message: string;
  createdAt: string;
}

export class SmsRelayService {
  /**
   * Pairs a phone. The token is returned once and never again.
   */
  public static async pair(params: {
    dealerId: string;
    name: string;
    actor: RelayActor;
    ipAddress?: string;
  }): Promise<{ relay: SmsRelay; token: string }> {
    const credentials = issueDeviceToken();
    const relay = await repo.smsRelays.create({
      id: `relay-${uuidv4().substring(0, 8)}`,
      dealerId: params.dealerId,
      name: params.name,
      tokenHash: credentials.tokenHash,
      sentCount: 0,
      failedCount: 0,
      createdAt: new Date().toISOString(),
    });

    await AuditService.log({
      dealerId: params.dealerId,
      userId: params.actor.userId,
      actorName: params.actor.userName,
      actorRole: params.actor.userRole,
      action: 'SMS_RELAY_PAIRED',
      targetType: 'SMS_RELAY',
      targetId: relay.id,
      details: `${params.actor.userName} paired the phone "${params.name}" to send this dealership's SMS.`,
      ipAddress: params.ipAddress,
    });

    return { relay, token: credentials.token };
  }

  public static async revoke(relayId: string, actor: RelayActor, ipAddress?: string): Promise<SmsRelay> {
    const relay = await repo.smsRelays.findById(relayId);
    if (!relay) throw AppError.notFound('SMS relay');

    const updated = await repo.smsRelays.update(relayId, { revokedAt: new Date().toISOString() });

    await AuditService.log({
      dealerId: relay.dealerId,
      userId: actor.userId,
      actorName: actor.userName,
      actorRole: actor.userRole,
      action: 'SMS_RELAY_REVOKED',
      targetType: 'SMS_RELAY',
      targetId: relayId,
      details: `${actor.userName} unpaired the phone "${relay.name}". It can no longer collect messages.`,
      ipAddress,
    });

    return updated ?? relay;
  }

  /**
   * Hands a relay the messages it should send.
   *
   * A message with no reachable number is failed here rather than given to the
   * phone: a relay cannot do anything with a customer who has no number on
   * file, and leaving it queued would keep re-offering it forever.
   */
  public static async claim(relay: SmsRelay, requested: number): Promise<OutboxMessage[]> {
    const limit = Math.min(Math.max(requested, 1), MAX_BATCH);
    const leaseUntil = new Date(Date.now() + LEASE_SECONDS * 1000);

    // Recorded before anything else. A relay that polls an empty queue is still
    // a phone that is switched on and reachable, and that is exactly what the
    // dashboard's "delivery is working" flag is asserting — most polls find
    // nothing, so counting only the productive ones would show a healthy relay
    // as offline.
    await repo.smsRelays.update(relay.id, { lastSeenAt: new Date().toISOString() });

    const claimed = await repo.notifications.claimForRelay(relay.dealerId, limit, leaseUntil);
    if (claimed.length === 0) return [];

    const customerIds = [...new Set(claimed.map((n) => n.customerId).filter(Boolean))] as string[];
    const customers = await repo.customers.findByIds(customerIds);
    const phoneById = new Map(customers.map((c) => [c.id, c.phone]));

    const sendable: OutboxMessage[] = [];

    for (const notification of claimed) {
      const to = notification.customerId ? phoneById.get(notification.customerId) : undefined;

      if (!to) {
        await this.markUnsendable(notification);
        continue;
      }

      sendable.push({
        id: notification.id,
        to,
        // The phone sends the body. The title is a dashboard label and would
        // only pad an SMS the shop is paying for.
        message: notification.message,
        createdAt: notification.createdAt,
      });
    }

    return sendable;
  }

  /**
   * Records what the phone reported for one message.
   *
   * SENT means the SIM accepted it. It is not DELIVERED — a handset relay has
   * no delivery receipt to offer, and claiming one would be inventing a fact
   * about whether a customer was warned before their phone was locked.
   */
  public static async report(params: {
    relay: SmsRelay;
    notificationId: string;
    sent: boolean;
    error?: string;
  }): Promise<Notification> {
    const notification = await repo.notifications.findById(params.notificationId);
    if (!notification) throw AppError.notFound('Notification');

    // A relay reports on its own dealership's messages and nothing else, even
    // if it guesses another dealer's notification id.
    if (notification.dealerId !== params.relay.dealerId) {
      throw AppError.forbidden('That message does not belong to this dealership.');
    }

    const nowIso = new Date().toISOString();

    const updated = params.sent
      ? await repo.notifications.update(params.notificationId, {
          status: 'SENT',
          sentAt: nowIso,
          leaseUntil: undefined,
          failureReason: undefined,
        })
      : await repo.notifications.update(params.notificationId, {
          // Released, not failed outright: a phone with no signal should not
          // permanently bury a payment reminder. It is retried until the
          // attempt cap, and only then does it stop.
          status: (notification.attempts ?? 0) >= MAX_ATTEMPTS ? 'FAILED' : 'QUEUED',
          leaseUntil: undefined,
          failureReason: (params.error ?? 'The phone did not report a reason.').slice(0, 300),
        });

    await repo.smsRelays.update(params.relay.id, {
      lastSeenAt: nowIso,
      sentCount: params.sent ? params.relay.sentCount + 1 : params.relay.sentCount,
      failedCount: params.sent ? params.relay.failedCount : params.relay.failedCount + 1,
    });

    return updated ?? notification;
  }

  /** Whether this dealership currently has a phone able to send its messages. */
  public static async deliveryState(dealerId: string | null): Promise<{
    enabled: boolean;
    relays: { id: string; name: string; lastSeenAt?: string; online: boolean; sentCount: number; failedCount: number }[];
  }> {
    if (dealerId === null) return { enabled: false, relays: [] };

    const relays = await repo.smsRelays.findActiveByDealer(dealerId);
    const cutoff = Date.now() - ONLINE_WINDOW_MS;

    const described = relays.map((relay) => ({
      id: relay.id,
      name: relay.name,
      lastSeenAt: relay.lastSeenAt,
      online: !!relay.lastSeenAt && new Date(relay.lastSeenAt).getTime() > cutoff,
      sentCount: relay.sentCount,
      failedCount: relay.failedCount,
    }));

    return { enabled: described.some((r) => r.online), relays: described };
  }

  private static async markUnsendable(notification: Notification): Promise<void> {
    await repo.notifications.update(notification.id, {
      status: 'FAILED',
      leaseUntil: undefined,
      failureReason: 'No phone number is on file for this customer.',
    });
  }
}
