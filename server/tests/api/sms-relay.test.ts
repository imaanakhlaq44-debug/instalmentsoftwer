import { describe, it, expect, beforeEach, afterAll } from 'vitest';

import { as, anonymous, reseed, repo, ACCOUNTS } from '../helpers.js';
import { disconnectDatabase } from '../../src/db/prisma.js';
import { hashDeviceToken } from '../../src/utils/deviceToken.js';

beforeEach(async () => {
  await reseed();
}, 60_000);

afterAll(async () => {
  await disconnectDatabase();
});

/** Pairs a phone to dealer-1 and returns the credential it would keep. */
async function pairedRelay(account: string = ACCOUNTS.dealerAdmin) {
  const res = await as(account).post('/api/notifications/relays').send({ name: 'Counter phone' });

  expect(res.status).toBe(201);
  return {
    relayId: res.body.relay.id as string,
    credential: `Relay ${res.body.pairingCode}`,
    pairingCode: res.body.pairingCode as string,
  };
}

/** Queues an SMS to a real seeded customer, which is what a relay collects. */
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
  return { notificationId: res.body.notification.id as string, customer };
}

describe('pairing a phone', () => {
  it('hands over the code once and stores only its hash', async () => {
    const { relayId, pairingCode } = await pairedRelay();

    const token = pairingCode.slice(pairingCode.indexOf('.') + 1);
    const stored = (await repo.smsRelays.findById(relayId))!;

    expect(stored.tokenHash).toBe(hashDeviceToken(token));
    expect(JSON.stringify(stored)).not.toContain(token);
  });

  it('never echoes the code back on a later read', async () => {
    const { pairingCode } = await pairedRelay();

    const res = await as(ACCOUNTS.dealerAdmin).get('/api/notifications/relays');
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain(pairingCode);
  });

  it('refuses a relay credential that was unpaired', async () => {
    const relay = await pairedRelay();
    await queueSms();

    await as(ACCOUNTS.dealerAdmin).post(`/api/notifications/relays/${relay.relayId}/revoke`).send({});

    const res = await anonymous()
      .post('/api/sms-relay/poll')
      .set('Authorization', relay.credential)
      .send({ limit: 5 });

    expect(res.status).toBe(403);
  });

  it('does not let a staff token drive the relay API', async () => {
    const res = await as(ACCOUNTS.dealerAdmin).post('/api/sms-relay/poll').send({ limit: 5 });
    expect(res.status).toBe(401);
  });
});

describe('collecting messages to send', () => {
  it('hands the phone the text and the customer it goes to', async () => {
    const relay = await pairedRelay();
    const { notificationId, customer } = await queueSms();

    const res = await anonymous()
      .post('/api/sms-relay/poll')
      .set('Authorization', relay.credential)
      .send({ limit: 10 });

    expect(res.status).toBe(200);
    const message = res.body.messages.find((m: { id: string }) => m.id === notificationId);
    expect(message.to).toBe(customer.phone);
    expect(message.message).toMatch(/overdue/i);
  });

  it('does not hand the same message to a second poll', async () => {
    // The failure this prevents: a customer texted twice about one overdue
    // payment because two polls raced, or one poll was simply repeated.
    const relay = await pairedRelay();
    const { notificationId } = await queueSms();

    const first = await anonymous()
      .post('/api/sms-relay/poll')
      .set('Authorization', relay.credential)
      .send({ limit: 10 });

    const second = await anonymous()
      .post('/api/sms-relay/poll')
      .set('Authorization', relay.credential)
      .send({ limit: 10 });

    expect(first.body.messages.map((m: { id: string }) => m.id)).toContain(notificationId);
    expect(second.body.messages.map((m: { id: string }) => m.id)).not.toContain(notificationId);
  });

  it('offers a message again once the lease has expired', async () => {
    // A phone that lost signal mid-batch must not strand a payment reminder.
    const relay = await pairedRelay();
    const { notificationId } = await queueSms();

    await anonymous().post('/api/sms-relay/poll').set('Authorization', relay.credential).send({ limit: 10 });

    await repo.notifications.update(notificationId, {
      leaseUntil: new Date(Date.now() - 60_000).toISOString(),
    });

    const res = await anonymous()
      .post('/api/sms-relay/poll')
      .set('Authorization', relay.credential)
      .send({ limit: 10 });

    expect(res.body.messages.map((m: { id: string }) => m.id)).toContain(notificationId);
  });

  it('never hands a relay another dealership\'s messages', async () => {
    const relay = await pairedRelay();

    const otherCustomer = (await repo.customers.findFirst({ dealerId: 'dealer-2' }))!;
    await as(ACCOUNTS.otherDealerAdmin).post('/api/notifications/send').send({
      customerId: otherCustomer.id,
      channel: 'SMS',
      type: 'PAYMENT_DUE',
      title: 'Payment due',
      message: 'Dealer two message.',
    });

    const res = await anonymous()
      .post('/api/sms-relay/poll')
      .set('Authorization', relay.credential)
      .send({ limit: 20 });

    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('Dealer two message.');
    expect(JSON.stringify(res.body)).not.toContain(otherCustomer.phone);
  });

  it('fails a message with no number rather than offering it forever', async () => {
    const relay = await pairedRelay();
    const { notificationId } = await queueSms();

    // A message with no customer attached has nobody to send to.
    await repo.notifications.update(notificationId, { customerId: undefined });

    const res = await anonymous()
      .post('/api/sms-relay/poll')
      .set('Authorization', relay.credential)
      .send({ limit: 10 });

    expect(res.body.messages.map((m: { id: string }) => m.id)).not.toContain(notificationId);
    expect((await repo.notifications.findById(notificationId))!.status).toBe('FAILED');
  });
});

describe('reporting what happened', () => {
  it('marks a message SENT only when the phone says the SIM took it', async () => {
    const relay = await pairedRelay();
    const { notificationId } = await queueSms();

    await anonymous().post('/api/sms-relay/poll').set('Authorization', relay.credential).send({ limit: 10 });

    // Queued, not sent, until the phone reports back — the same rule the
    // device lock follows.
    expect((await repo.notifications.findById(notificationId))!.status).toBe('QUEUED');

    const res = await anonymous()
      .post('/api/sms-relay/results')
      .set('Authorization', relay.credential)
      .send({ results: [{ id: notificationId, sent: true }] });

    expect(res.status).toBe(200);
    const stored = (await repo.notifications.findById(notificationId))!;
    expect(stored.status).toBe('SENT');
    expect(stored.sentAt).toBeTruthy();
  });

  it('returns a refused message to the queue with its reason', async () => {
    const relay = await pairedRelay();
    const { notificationId } = await queueSms();

    await anonymous().post('/api/sms-relay/poll').set('Authorization', relay.credential).send({ limit: 10 });

    await anonymous()
      .post('/api/sms-relay/results')
      .set('Authorization', relay.credential)
      .send({ results: [{ id: notificationId, sent: false, error: 'No SIM balance.' }] });

    const stored = (await repo.notifications.findById(notificationId))!;
    expect(stored.status).toBe('QUEUED');
    expect(stored.failureReason).toMatch(/balance/i);
    // The lease is released, so the next poll picks it up again.
    expect(stored.leaseUntil).toBeUndefined();
  });

  it('gives up after repeated failures instead of retrying forever', async () => {
    const relay = await pairedRelay();
    const { notificationId } = await queueSms();

    for (let attempt = 0; attempt < 6; attempt += 1) {
      await repo.notifications.update(notificationId, { leaseUntil: undefined });
      await anonymous().post('/api/sms-relay/poll').set('Authorization', relay.credential).send({ limit: 10 });
      await anonymous()
        .post('/api/sms-relay/results')
        .set('Authorization', relay.credential)
        .send({ results: [{ id: notificationId, sent: false, error: 'Send failed.' }] });
    }

    expect((await repo.notifications.findById(notificationId))!.status).toBe('FAILED');
  });

  it('refuses a report about another dealership\'s message', async () => {
    const relay = await pairedRelay();

    const otherCustomer = (await repo.customers.findFirst({ dealerId: 'dealer-2' }))!;
    const queued = await as(ACCOUNTS.otherDealerAdmin).post('/api/notifications/send').send({
      customerId: otherCustomer.id,
      channel: 'SMS',
      type: 'PAYMENT_DUE',
      title: 'Payment due',
      message: 'Dealer two message.',
    });

    const res = await anonymous()
      .post('/api/sms-relay/results')
      .set('Authorization', relay.credential)
      .send({ results: [{ id: queued.body.notification.id, sent: true }] });

    // The batch is accepted, the foreign id is not acted on.
    expect(res.status).toBe(200);
    expect(res.body.recorded[0].status).toBe('UNKNOWN');
    expect((await repo.notifications.findById(queued.body.notification.id))!.status).toBe('QUEUED');
  });
});

describe('the dashboard tells the truth about delivery', () => {
  it('reports delivery as off while no phone is paired', async () => {
    const res = await as(ACCOUNTS.dealerAdmin).get('/api/notifications');

    expect(res.body.deliveryEnabled).toBe(false);
    expect(res.body.deliveryNote).toMatch(/not delivered/i);
  });

  it('still reports delivery as off for a paired phone that has never checked in', async () => {
    // A relay left switched off in a drawer must not make the dashboard imply
    // customers are being texted.
    await pairedRelay();

    const res = await as(ACCOUNTS.dealerAdmin).get('/api/notifications');
    expect(res.body.deliveryEnabled).toBe(false);
    expect(res.body.deliveryNote).toMatch(/has not checked in/i);
  });

  it('reports delivery as on once the phone has polled', async () => {
    const relay = await pairedRelay();
    await anonymous().post('/api/sms-relay/poll').set('Authorization', relay.credential).send({ limit: 5 });

    const res = await as(ACCOUNTS.dealerAdmin).get('/api/notifications');
    expect(res.body.deliveryEnabled).toBe(true);
    expect(res.body.relays[0].online).toBe(true);
  });
});
