import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';

import { as, anonymous, reseed, repo, ACCOUNTS } from '../helpers.js';
import { disconnectDatabase } from '../../src/db/prisma.js';
import { SmsAggregatorService } from '../../src/services/SmsAggregatorService.js';
import { OutboundSms, SmsProvider, SmsSendResult } from '../../src/services/sms/SmsProvider.js';
import { SmsChannel } from '../../src/types/index.js';

/**
 * A gateway that answers whatever the test tells it to, and remembers every
 * message it was handed. No real account exists; what matters here is what the
 * queue does with each kind of answer.
 */
class FakeGateway implements SmsProvider {
  public readonly name = 'fake';
  public readonly senderMask = 'ALMAS SDM';
  public readonly received: OutboundSms[] = [];
  public answer: SmsSendResult | (() => Promise<SmsSendResult>) = { accepted: true, providerMessageId: 'gw-1' };

  public async send(sms: OutboundSms): Promise<SmsSendResult> {
    this.received.push(sms);
    return typeof this.answer === 'function' ? this.answer() : this.answer;
  }
}

let gateway: FakeGateway;

beforeEach(async () => {
  await reseed();
  gateway = new FakeGateway();
  SmsAggregatorService.useProvider(gateway);
}, 60_000);

afterEach(() => {
  SmsAggregatorService.useProvider(null);
});

afterAll(async () => {
  await disconnectDatabase();
});

async function setChannel(smsChannel: SmsChannel, account: string = ACCOUNTS.dealerAdmin) {
  const res = await as(account).put('/api/settings/policy').send({ smsChannel });
  expect(res.status).toBe(200);
}

async function queueSms(message = 'Your installment of Rs 5,000 is overdue.') {
  const customer = (await repo.customers.findFirst({ dealerId: 'dealer-1' }))!;

  const res = await as(ACCOUNTS.dealerStaff).post('/api/notifications/send').send({
    customerId: customer.id,
    channel: 'SMS',
    type: 'PAYMENT_OVERDUE',
    title: 'Payment overdue',
    message,
  });

  expect(res.status).toBe(201);
  return { id: res.body.notification.id as string, customer };
}

async function pairedRelay() {
  const res = await as(ACCOUNTS.dealerAdmin).post('/api/notifications/relays').send({ name: 'Counter phone' });
  expect(res.status).toBe(201);
  return `Relay ${res.body.pairingCode}`;
}

async function poll(credential: string) {
  const res = await anonymous().post('/api/sms-relay/poll').set('Authorization', credential).send({ limit: 20 });
  expect(res.status).toBe(200);
  return (res.body.messages as { id: string }[]).map((m) => m.id);
}

/** Makes a message that is waiting out its backoff due again. */
async function skipBackoff(id: string) {
  await repo.notifications.update(id, { nextAttemptAt: new Date(Date.now() - 1000).toISOString() });
}

/** The seeded fixture queues messages of its own; only the test's message is under test. */
async function clearSeededQueue() {
  await repo.notifications.updateMany({ status: 'QUEUED' }, { status: 'FAILED' });
}

describe('choosing how a shop sends its SMS', () => {
  it('starts every shop on its paired phone', async () => {
    const res = await as(ACCOUNTS.dealerAdmin).get('/api/settings');
    expect(res.body.policy.smsChannel).toBe('PHONE');
    expect(res.body.smsAggregator).toEqual({ configured: true, provider: 'fake', senderMask: 'ALMAS SDM' });
  });

  it('refuses the aggregator on a server that has no account', async () => {
    SmsAggregatorService.useProvider(null);

    const res = await as(ACCOUNTS.dealerAdmin).put('/api/settings/policy').send({ smsChannel: 'AGGREGATOR' });
    expect(res.status).toBe(400);
    expect(res.body.error ?? res.body.message).toMatch(/No SMS gateway account/i);

    const policy = (await repo.devicePolicies.findByDealer('dealer-1'))!;
    expect(policy.smsChannel).toBe('PHONE');
  });

  it('is the shop owner\'s decision, not the counter staff\'s', async () => {
    const res = await as(ACCOUNTS.dealerStaff).put('/api/settings/policy').send({ smsChannel: 'AGGREGATOR' });
    expect(res.status).toBe(403);
  });

  it('records the change in the audit trail', async () => {
    await setChannel('AGGREGATOR_THEN_PHONE');

    const logs = await repo.auditLogs.findMany({ where: { dealerId: 'dealer-1', targetType: 'POLICY' } });
    expect(logs.some((l) => /SMS gateway, with the paired phone as a fallback/.test(l.details))).toBe(true);
  });

  it('falls back to the phone if the account is later removed from the server', async () => {
    // A shop left on "aggregator" with no aggregator would have a queue that
    // nobody is allowed to drain.
    await setChannel('AGGREGATOR');
    await clearSeededQueue();
    const { id } = await queueSms();
    const relay = await pairedRelay();

    SmsAggregatorService.useProvider(null);

    expect(await poll(relay)).toContain(id);
  });
});

describe('draining the queue through the aggregator', () => {
  beforeEach(async () => {
    await clearSeededQueue();
  });

  it('marks a message SENT only once the gateway accepts it', async () => {
    await setChannel('AGGREGATOR');
    const { id, customer } = await queueSms();

    expect((await repo.notifications.findById(id))!.status).toBe('QUEUED');

    const result = await SmsAggregatorService.drainOnce();
    expect(result).toMatchObject({ claimed: 1, sent: 1 });

    // The body goes to the customer's own number; the title is a dashboard label.
    expect(gateway.received).toEqual([{ to: customer.phone, message: 'Your installment of Rs 5,000 is overdue.' }]);

    const sent = (await repo.notifications.findById(id))!;
    expect(sent.status).toBe('SENT');
    expect(sent.sentVia).toBe('AGGREGATOR');
    expect(sent.providerMessageId).toBe('gw-1');
    expect(sent.sentAt).toBeDefined();
    expect(sent.leaseUntil).toBeUndefined();
    expect(sent.failureReason).toBeUndefined();
  });

  it('leaves a shop that sends through its phone alone', async () => {
    const { id } = await queueSms();

    const result = await SmsAggregatorService.drainOnce();

    expect(result.claimed).toBe(0);
    expect(gateway.received).toHaveLength(0);
    expect((await repo.notifications.findById(id))!.status).toBe('QUEUED');
  });

  it('does not send the same message on a second pass', async () => {
    await setChannel('AGGREGATOR');
    await queueSms();

    await SmsAggregatorService.drainOnce();
    await SmsAggregatorService.drainOnce();

    expect(gateway.received).toHaveLength(1);
  });

  it('sends each message once when two passes race', async () => {
    await setChannel('AGGREGATOR');
    await queueSms('first');
    await queueSms('second');

    // Two claims at the same instant, as two server processes would make.
    const lease = new Date(Date.now() + 60_000);
    const [a, b] = await Promise.all([
      repo.notifications.claimForAggregator(['dealer-1'], 20, lease, 4),
      repo.notifications.claimForAggregator(['dealer-1'], 20, lease, 4),
    ]);

    const ids = [...a, ...b].map((n) => n.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it('keeps a refused message unsent, with the reason, and waits before retrying', async () => {
    await setChannel('AGGREGATOR');
    const { id } = await queueSms();
    gateway.answer = { accepted: false, retryable: true, reason: 'The SMS gateway did not accept the message: Insufficient balance' };

    const first = await SmsAggregatorService.drainOnce();
    expect(first).toMatchObject({ claimed: 1, sent: 0, retried: 1 });

    const waiting = (await repo.notifications.findById(id))!;
    expect(waiting.status).toBe('QUEUED');
    expect(waiting.sentAt).toBeUndefined();
    expect(waiting.failureReason).toMatch(/Insufficient balance/);
    expect(waiting.aggregatorAttempts).toBe(1);
    expect(new Date(waiting.nextAttemptAt!).getTime()).toBeGreaterThan(Date.now() + 30_000);

    // Still inside the backoff: the next pass must not hammer the gateway.
    await SmsAggregatorService.drainOnce();
    expect(gateway.received).toHaveLength(1);

    // Once it is due, and the gateway has recovered, it goes.
    await skipBackoff(id);
    gateway.answer = { accepted: true, providerMessageId: 'gw-2' };
    await SmsAggregatorService.drainOnce();

    const sent = (await repo.notifications.findById(id))!;
    expect(sent.status).toBe('SENT');
    expect(sent.aggregatorAttempts).toBe(2);
    expect(sent.failureReason).toBeUndefined();
  });

  it('waits longer after each failure', async () => {
    await setChannel('AGGREGATOR');
    const { id } = await queueSms();
    gateway.answer = { accepted: false, retryable: true, reason: 'gateway busy' };

    const waits: number[] = [];
    for (let i = 0; i < 3; i++) {
      await SmsAggregatorService.drainOnce();
      waits.push(new Date((await repo.notifications.findById(id))!.nextAttemptAt!).getTime() - Date.now());
      await skipBackoff(id);
    }

    expect(waits[1]).toBeGreaterThan(waits[0]);
    expect(waits[2]).toBeGreaterThan(waits[1]);
  });

  it('fails a message after the attempt cap, and then stops trying', async () => {
    await setChannel('AGGREGATOR');
    const { id } = await queueSms();
    gateway.answer = { accepted: false, retryable: true, reason: 'gateway busy' };

    for (let i = 0; i < 6; i++) {
      await SmsAggregatorService.drainOnce();
      const row = (await repo.notifications.findById(id))!;
      if (row.status === 'QUEUED') await skipBackoff(id);
    }

    const failed = (await repo.notifications.findById(id))!;
    expect(failed.status).toBe('FAILED');
    expect(failed.failureReason).toBe('gateway busy');
    expect(failed.sentAt).toBeUndefined();
    // The default cap is four tries, not six.
    expect(gateway.received).toHaveLength(4);
  });

  it('fails at once when another try cannot help', async () => {
    await setChannel('AGGREGATOR');
    const { id } = await queueSms();
    gateway.answer = { accepted: false, retryable: false, reason: '"042-111" is not a valid mobile number.' };

    const result = await SmsAggregatorService.drainOnce();

    expect(result.failed).toBe(1);
    expect((await repo.notifications.findById(id))!.status).toBe('FAILED');
  });

  it('fails a message with no customer number without calling the gateway', async () => {
    await setChannel('AGGREGATOR');
    const res = await as(ACCOUNTS.dealerStaff).post('/api/notifications/send').send({
      channel: 'SMS', type: 'PAYMENT_DUE', title: 'To everyone', message: 'Shop closed on Friday.',
    });

    await SmsAggregatorService.drainOnce();

    const row = (await repo.notifications.findById(res.body.notification.id))!;
    expect(row.status).toBe('FAILED');
    expect(row.failureReason).toMatch(/No phone number/);
    expect(gateway.received).toHaveLength(0);
  });

  it('survives a provider that throws, and does not call it sent', async () => {
    await setChannel('AGGREGATOR');
    const { id } = await queueSms();
    gateway.answer = () => Promise.reject(new Error('boom'));

    const result = await SmsAggregatorService.drainOnce();

    expect(result).toMatchObject({ sent: 0, retried: 1 });
    expect((await repo.notifications.findById(id))!.status).toBe('QUEUED');
  });

  it('never sends another dealership\'s messages for a shop that did not choose it', async () => {
    await setChannel('AGGREGATOR');
    const other = (await repo.customers.findFirst({ dealerId: 'dealer-2' }))!;
    const res = await as(ACCOUNTS.otherDealerAdmin).post('/api/notifications/send').send({
      customerId: other.id, channel: 'SMS', type: 'PAYMENT_DUE', title: 'Due', message: 'dealer two text',
    });

    await SmsAggregatorService.drainOnce();

    expect(gateway.received.map((m) => m.message)).not.toContain('dealer two text');
    expect((await repo.notifications.findById(res.body.notification.id))!.status).toBe('QUEUED');
  });
});

describe('sharing the queue with a paired phone', () => {
  beforeEach(async () => {
    await clearSeededQueue();
  });

  it('gives an aggregator-only shop\'s phone nothing', async () => {
    await setChannel('AGGREGATOR');
    const relay = await pairedRelay();
    await queueSms();

    expect(await poll(relay)).toEqual([]);
  });

  it('does not send a message a paired phone has already claimed', async () => {
    // The phone took it while the shop was on PHONE; the shop then switches.
    // The phone still holds the lease, so the aggregator must keep its hands off.
    const relay = await pairedRelay();
    const { id } = await queueSms();
    expect(await poll(relay)).toContain(id);

    await setChannel('AGGREGATOR');
    const result = await SmsAggregatorService.drainOnce();

    expect(result.claimed).toBe(0);
    expect(gateway.received).toHaveLength(0);
  });

  it('does not hand a phone a message the aggregator is holding', async () => {
    await setChannel('AGGREGATOR_THEN_PHONE');
    const relay = await pairedRelay();
    const { id } = await queueSms();

    let phoneSawIt: string[] = [];
    gateway.answer = async () => {
      // Mid-send: the gateway call is in flight when the phone polls.
      phoneSawIt = await poll(relay);
      return { accepted: true, providerMessageId: 'gw-9' };
    };

    await SmsAggregatorService.drainOnce();

    expect(phoneSawIt).not.toContain(id);
    expect((await repo.notifications.findById(id))!.sentVia).toBe('AGGREGATOR');
  });

  it('keeps the phone away while the aggregator is still retrying', async () => {
    await setChannel('AGGREGATOR_THEN_PHONE');
    const relay = await pairedRelay();
    const { id } = await queueSms();
    gateway.answer = { accepted: false, retryable: true, reason: 'gateway busy' };

    await SmsAggregatorService.drainOnce();

    expect(await poll(relay)).not.toContain(id);
  });

  it('hands a message to the phone once the aggregator has given up', async () => {
    await setChannel('AGGREGATOR_THEN_PHONE');
    const relay = await pairedRelay();
    const { id } = await queueSms();
    gateway.answer = { accepted: false, retryable: true, reason: 'gateway busy' };

    for (let i = 0; i < 4; i++) {
      await SmsAggregatorService.drainOnce();
      await skipBackoff(id);
    }

    const handedOver = (await repo.notifications.findById(id))!;
    expect(handedOver.status).toBe('QUEUED');
    expect(handedOver.phoneFallbackAt).toBeDefined();
    expect(handedOver.failureReason).toBe('gateway busy');

    // The aggregator is done with it…
    gateway.answer = { accepted: true };
    await SmsAggregatorService.drainOnce();
    expect(gateway.received).toHaveLength(4);

    // …and the phone now collects and sends it.
    expect(await poll(relay)).toContain(id);
    await anonymous().post('/api/sms-relay/results').set('Authorization', relay)
      .send({ results: [{ id, sent: true }] });

    const sent = (await repo.notifications.findById(id))!;
    expect(sent.status).toBe('SENT');
    expect(sent.sentVia).toBe('PHONE');
  });

  it('does not let a late phone report un-send a message', async () => {
    // The phone claimed it, went quiet, the lease ran out and the aggregator
    // sent it. The phone then wakes up and reports a failure.
    const relay = await pairedRelay();
    const { id } = await queueSms();
    await poll(relay);

    await repo.notifications.update(id, { leaseUntil: new Date(Date.now() - 60_000).toISOString() });
    await setChannel('AGGREGATOR');
    await SmsAggregatorService.drainOnce();
    expect((await repo.notifications.findById(id))!.status).toBe('SENT');

    await anonymous().post('/api/sms-relay/results').set('Authorization', relay)
      .send({ results: [{ id, sent: false, error: 'No signal' }] });

    const after = (await repo.notifications.findById(id))!;
    expect(after.status).toBe('SENT');
    expect(after.sentVia).toBe('AGGREGATOR');

    await SmsAggregatorService.drainOnce();
    expect(gateway.received).toHaveLength(1);
  });

  it('gives waiting messages a fresh start when the shop changes channel', async () => {
    await setChannel('AGGREGATOR_THEN_PHONE');
    const { id } = await queueSms();
    gateway.answer = { accepted: false, retryable: false, reason: 'refused' };
    await SmsAggregatorService.drainOnce();
    expect((await repo.notifications.findById(id))!.phoneFallbackAt).toBeDefined();

    // Without a reset this message would be stranded: handed to a phone the
    // shop no longer uses, and off-limits to the aggregator.
    await setChannel('AGGREGATOR');
    gateway.answer = { accepted: true };
    await SmsAggregatorService.drainOnce();

    expect((await repo.notifications.findById(id))!.status).toBe('SENT');
  });
});

describe('what the notifications page is told', () => {
  it('shows the channel, the reason for a failure and the SMS count', async () => {
    await clearSeededQueue();
    await setChannel('AGGREGATOR');

    const sent = await queueSms('Aap ki qist kal due hai.');
    await SmsAggregatorService.drainOnce();

    const urdu = 'ق'.repeat(71);
    const refused = await queueSms(urdu);
    gateway.answer = { accepted: false, retryable: false, reason: 'Sender mask not approved' };
    await SmsAggregatorService.drainOnce();

    const res = await as(ACCOUNTS.dealerAdmin).get('/api/notifications?limit=100');
    expect(res.status).toBe(200);
    expect(res.body.smsChannel).toBe('AGGREGATOR');
    expect(res.body.aggregator).toMatchObject({ configured: true, senderMask: 'ALMAS SDM' });
    expect(res.body.deliveryEnabled).toBe(true);
    expect(res.body.deliveryNote).toMatch(/gateway accepted the message, not that it was delivered/);

    const rows = res.body.data as Record<string, any>[];
    const okRow = rows.find((r) => r.id === sent.id)!;
    expect(okRow).toMatchObject({ status: 'SENT', sentVia: 'AGGREGATOR', providerMessageId: 'gw-1' });
    expect(okRow.sms).toMatchObject({ encoding: 'GSM-7', segments: 1 });

    const badRow = rows.find((r) => r.id === refused.id)!;
    expect(badRow).toMatchObject({ status: 'FAILED', failureReason: 'Sender mask not approved' });
    expect(badRow.sentVia).toBeUndefined();
    expect(badRow.sms).toMatchObject({ encoding: 'UCS-2', segments: 2 });
  });

  it('does not claim delivery for a phone-only shop with no phone, even with an account on the server', async () => {
    const res = await as(ACCOUNTS.dealerAdmin).get('/api/notifications');

    expect(res.body.smsChannel).toBe('PHONE');
    expect(res.body.deliveryEnabled).toBe(false);
  });
});
