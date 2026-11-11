import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';

import { as, reseed, repo, ACCOUNTS } from '../helpers.js';
import { disconnectDatabase, prisma } from '../../src/db/prisma.js';
import { amountOutstanding } from '../../src/services/InstallmentMath.js';
import { OverdueEngine } from '../../src/services/OverdueEngine.js';
import { WhatsAppDispatchService } from '../../src/services/whatsapp/WhatsAppDispatchService.js';
import { CloudApiWhatsAppProvider } from '../../src/services/whatsapp/WhatsAppProvider.js';
import { resolveWhatsAppCloudConfig } from '../../src/services/whatsapp/cloudConfig.js';
import { toWhatsAppNumber } from '../../src/services/whatsapp/phone.js';

beforeEach(async () => {
  await reseed();
  // Every test starts where a real deployment does: no credentials, no provider.
  WhatsAppDispatchService.setProviderForTests(null);
}, 60_000);

afterEach(() => {
  WhatsAppDispatchService.setProviderForTests(undefined);
  vi.restoreAllMocks();
});

afterAll(async () => {
  await disconnectDatabase();
});

/** A dealer-1 customer who is genuinely behind, with what the ledger says they owe. */
async function overdueCustomer() {
  const rows = await repo.installments.findMany({
    where: { dealerId: 'dealer-1', status: 'OVERDUE' },
    orderBy: { dueDate: 'asc' },
  });
  const first = rows.find((i) => amountOutstanding(i) > 0)!;
  expect(first, 'the fixture has an overdue installment in dealer-1').toBeTruthy();

  const samePlan = rows.filter((i) => i.planId === first.planId && amountOutstanding(i) > 0);
  const customer = (await repo.customers.findById(first.customerId))!;
  const plan = (await repo.installmentPlans.findById(first.planId))!;
  const device = (await repo.devices.findById(plan.deviceId))!;

  return {
    customer,
    plan,
    device,
    owed: samePlan.reduce((sum, i) => sum + amountOutstanding(i), 0),
  };
}

const rupees = (n: number) => `Rs. ${Math.round(n).toLocaleString('en-US')}`;

describe('click-to-WhatsApp: the message', () => {
  it('builds an overdue notice from the real plan figures and the shop’s details', async () => {
    const { customer, device, owed, plan } = await overdueCustomer();
    const dealer = (await repo.dealers.findById('dealer-1'))!;

    const res = await as(ACCOUNTS.dealerStaff)
      .get('/api/notifications/whatsapp/message')
      .query({ customerId: customer.id, kind: 'OVERDUE', planId: plan.id });

    expect(res.status).toBe(200);
    expect(res.body.waNumber).toBe(toWhatsAppNumber(customer.phone));
    expect(res.body.waNumber).toMatch(/^923\d{9}$/);
    expect(res.body.message).toContain(customer.name);
    expect(res.body.message).toContain(rupees(owed));
    expect(res.body.message).toContain(`${device.brand} ${device.model}`);
    expect(res.body.message).toContain(`${dealer.name} — ${dealer.phone}`);

    expect(res.body.url).toBe(
      `https://wa.me/${res.body.waNumber}?text=${encodeURIComponent(res.body.message)}`
    );
  });

  it('previewing records nothing', async () => {
    const { customer } = await overdueCustomer();

    await as(ACCOUNTS.dealerStaff)
      .get('/api/notifications/whatsapp/message')
      .query({ customerId: customer.id, kind: 'OVERDUE' });

    expect(await repo.auditLogs.findMany({ where: { action: 'WHATSAPP_OPENED' } })).toHaveLength(0);
  });

  it('writes in the language the shop chose in Settings', async () => {
    const { customer } = await overdueCustomer();
    const ask = () =>
      as(ACCOUNTS.dealerStaff)
        .get('/api/notifications/whatsapp/message')
        .query({ customerId: customer.id, kind: 'OVERDUE' });

    // Roman Urdu until somebody changes it.
    const before = await ask();
    expect(before.body.language).toBe('ROMAN_UR');
    expect(before.body.message).toContain('Assalam o Alaikum');

    const saved = await as(ACCOUNTS.dealerAdmin).put('/api/settings/policy').send({ whatsappLanguage: 'UR' });
    expect(saved.status).toBe(200);
    expect(saved.body.policy.whatsappLanguage).toBe('UR');

    const after = await ask();
    expect(after.body.language).toBe('UR');
    expect(after.body.message).toContain('السلام علیکم');

    const bad = await as(ACCOUNTS.dealerAdmin).put('/api/settings/policy').send({ whatsappLanguage: 'FR' });
    expect([400, 422]).toContain(bad.status);
  });

  it('sends a receipt only for a verified payment, with its own figures', async () => {
    const payment = (
      await repo.payments.findMany({
        where: { dealerId: 'dealer-1', status: 'VERIFIED', reversedAt: null, reversalOfPaymentId: null },
        take: 1,
      })
    )[0];
    expect(payment).toBeTruthy();

    const res = await as(ACCOUNTS.dealerStaff)
      .get('/api/notifications/whatsapp/message')
      .query({ customerId: payment.customerId, kind: 'PAYMENT_RECEIVED', paymentId: payment.id });

    expect(res.status).toBe(200);
    expect(res.body.message).toContain(rupees(payment.amount));
    expect(res.body.message).toContain(payment.receiptNumber || payment.id);

    await repo.payments.update(payment.id, { status: 'PENDING' });
    const unverified = await as(ACCOUNTS.dealerStaff)
      .get('/api/notifications/whatsapp/message')
      .query({ customerId: payment.customerId, kind: 'PAYMENT_RECEIVED', paymentId: payment.id });
    expect(unverified.status).toBe(400);
  });

  it('will not quote another customer’s payment', async () => {
    const { customer } = await overdueCustomer();
    const other = (
      await repo.payments.findMany({ where: { dealerId: 'dealer-1', status: 'VERIFIED', NOT: { customerId: customer.id } }, take: 1 })
    )[0];

    const res = await as(ACCOUNTS.dealerStaff)
      .get('/api/notifications/whatsapp/message')
      .query({ customerId: customer.id, kind: 'PAYMENT_RECEIVED', paymentId: other.id });

    expect(res.status).toBe(404);
  });

  it('refuses a lock warning with no signed agreement behind it, and allows one with', async () => {
    const { customer, device, plan } = await overdueCustomer();
    const ask = () =>
      as(ACCOUNTS.dealerStaff)
        .get('/api/notifications/whatsapp/message')
        .query({ customerId: customer.id, kind: 'LOCK_WARNING', planId: plan.id });

    const existing = await repo.contracts.findByDevice(device.id);
    if (existing) await repo.contracts.update(existing.id, { status: 'DRAFT' });

    const refused = await ask();
    expect(refused.status).toBe(400);
    expect(refused.body.message ?? refused.body.error).toMatch(/signed agreement/);

    if (existing) {
      await repo.contracts.update(existing.id, { status: 'SIGNED' });
    } else {
      await repo.contracts.create({
        id: 'contract-wa-test',
        dealerId: device.dealerId,
        customerId: customer.id,
        deviceId: device.id,
        planId: plan.id,
        termsVersion: 'v1.3',
        snapshot: '{}',
        status: 'SIGNED',
        signedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      });
    }

    const allowed = await ask();
    expect(allowed.status).toBe(200);
    expect(allowed.body.message).toContain('lock ho sakta hai');

    // A phone sold without a lock cannot be threatened with one.
    await repo.devices.update(device.id, { noLock: true });
    expect((await ask()).status).toBe(400);
  });

  it('refuses an overdue notice for somebody who is not behind', async () => {
    const { customer } = await overdueCustomer();
    await repo.installments.updateMany({ customerId: customer.id }, { status: 'PAID', amountPaid: 10_000_000 });

    const res = await as(ACCOUNTS.dealerStaff)
      .get('/api/notifications/whatsapp/message')
      .query({ customerId: customer.id, kind: 'OVERDUE' });

    expect(res.status).toBe(400);
  });

  it('refuses a number that is not a Pakistani mobile instead of opening a stranger’s chat', async () => {
    const { customer } = await overdueCustomer();
    await repo.customers.update(customer.id, { phone: '042-35761234' });

    const res = await as(ACCOUNTS.dealerStaff)
      .get('/api/notifications/whatsapp/message')
      .query({ customerId: customer.id, kind: 'OVERDUE' });

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/not a valid Pakistani mobile/);
  });
});

describe('click-to-WhatsApp: the record', () => {
  it('records who opened it, as opened — never sent or delivered', async () => {
    const { customer } = await overdueCustomer();

    const res = await as(ACCOUNTS.dealerStaff)
      .post('/api/notifications/whatsapp/opened')
      .send({ customerId: customer.id, kind: 'OVERDUE' });

    expect(res.status).toBe(201);
    expect(res.body.url).toMatch(/^https:\/\/wa\.me\/923\d{9}\?text=/);

    const logs = await repo.auditLogs.findMany({ where: { action: 'WHATSAPP_OPENED' } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      dealerId: 'dealer-1',
      userId: ACCOUNTS.dealerStaff,
      targetType: 'CUSTOMER',
      targetId: customer.id,
    });
    expect(logs[0].details).toContain('opened WhatsApp');
    expect(logs[0].details).toContain(customer.name);
    expect(logs[0].details).toContain('not known');
    // The claim stops at "opened".
    expect(logs[0].details).not.toMatch(/\b(sent (a|an|the|to)|delivered to|has been (sent|delivered))\b/i);

    // And nothing joins the delivery queue pretending to be a sent message.
    expect(await repo.notifications.findMany({ where: { channel: 'WHATSAPP' } })).toHaveLength(0);
  });

  it('shows the opens on the customer’s page, with the staff member’s name', async () => {
    const { customer } = await overdueCustomer();
    await as(ACCOUNTS.dealerStaff)
      .post('/api/notifications/whatsapp/opened')
      .send({ customerId: customer.id, kind: 'OVERDUE' });

    const res = await as(ACCOUNTS.dealerAdmin).get(`/api/customers/${customer.id}`);
    const staff = (await repo.users.findById(ACCOUNTS.dealerStaff))!;

    expect(res.status).toBe(200);
    expect(res.body.whatsappOpens).toHaveLength(1);
    expect(res.body.whatsappOpens[0].actorName).toBe(staff.name);
    expect(res.body.whatsappOpens[0].details).toContain('opened WhatsApp to');
  });

  it('does not show staff names to a customer login', async () => {
    await as(ACCOUNTS.dealerStaff)
      .post('/api/notifications/whatsapp/opened')
      .send({ customerId: 'cust-1', kind: 'DUE_REMINDER' });

    const res = await as(ACCOUNTS.customer).get('/api/customers/cust-1');
    expect(res.status).toBe(200);
    expect(res.body.whatsappOpens).toEqual([]);
  });

  it('is for shop staff only', async () => {
    const res = await as(ACCOUNTS.customer)
      .post('/api/notifications/whatsapp/opened')
      .send({ customerId: 'cust-1', kind: 'DUE_REMINDER' });

    expect(res.status).toBe(403);
  });

  it('will not build a message for another dealership’s customer', async () => {
    const { customer } = await overdueCustomer();

    const peek = await as(ACCOUNTS.otherDealerAdmin)
      .get('/api/notifications/whatsapp/message')
      .query({ customerId: customer.id, kind: 'OVERDUE' });
    const open = await as(ACCOUNTS.otherDealerAdmin)
      .post('/api/notifications/whatsapp/opened')
      .send({ customerId: customer.id, kind: 'OVERDUE' });

    expect([403, 404]).toContain(peek.status);
    expect([403, 404]).toContain(open.status);
    expect(JSON.stringify(peek.body)).not.toContain(customer.name);
    expect(await repo.auditLogs.findMany({ where: { action: 'WHATSAPP_OPENED' } })).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// The Business Cloud API, with Meta played by a mock.
// ---------------------------------------------------------------------------

const cloudConfig = resolveWhatsAppCloudConfig({
  WHATSAPP_CLOUD_ACCESS_TOKEN: 'test-token-not-a-real-one',
  WHATSAPP_CLOUD_PHONE_NUMBER_ID: '100000000000001',
  WHATSAPP_CLOUD_API_VERSION: 'v21.0',
  WHATSAPP_CLOUD_TEMPLATE_NAME: 'almas_reminder',
  WHATSAPP_CLOUD_TEMPLATE_LANGUAGE: 'ur',
})!;

type MetaReply = { status: number; body: unknown };

/** Connects the real Cloud API adapter to a fake Meta that answers from a script. */
function connectCloudApi(reply: (call: number) => MetaReply) {
  const fetchMock = vi.fn(async (_url: string, _init: { body: string }) => {
    const { status, body } = reply(fetchMock.mock.calls.length);
    return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
  });
  WhatsAppDispatchService.setProviderForTests(new CloudApiWhatsAppProvider(cloudConfig, fetchMock as never), {
    name: 'almas_reminder',
    language: 'ur',
    byType: { PAYMENT_OVERDUE: 'almas_overdue' },
  });
  return fetchMock;
}

const ACCEPTED: MetaReply = { status: 200, body: { messaging_product: 'whatsapp', messages: [{ id: 'wamid.OK' }] } };

async function queueWhatsApp(customerId: string, type = 'PAYMENT_OVERDUE') {
  const res = await as(ACCOUNTS.dealerStaff).post('/api/notifications/send').send({
    customerId,
    channel: 'WHATSAPP',
    type,
    title: 'Payment overdue',
    message: 'Your installment of Rs. 5,000 is overdue.',
  });
  return res;
}

describe('WhatsApp Business Cloud API: off by default', () => {
  it('says so, and refuses to queue a message nothing would ever send', async () => {
    const { customer } = await overdueCustomer();

    const list = await as(ACCOUNTS.dealerAdmin).get('/api/notifications');
    expect(list.body.whatsappCloudEnabled).toBe(false);

    const settings = await as(ACCOUNTS.dealerAdmin).get('/api/settings');
    expect(settings.body.whatsappCloudEnabled).toBe(false);

    const res = await queueWhatsApp(customer.id);
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/not connected/);
    expect(await repo.notifications.findMany({ where: { channel: 'WHATSAPP' } })).toHaveLength(0);
  });

  it('will not let a shop switch reminders to a channel that is not there', async () => {
    const res = await as(ACCOUNTS.dealerAdmin).put('/api/settings/policy').send({ reminderChannel: 'WHATSAPP' });

    expect(res.status).toBe(400);
    expect((await repo.devicePolicies.findByDealer('dealer-1'))?.reminderChannel ?? 'SMS').toBe('SMS');
  });

  it('dispatches nothing and reports itself disabled', async () => {
    expect(await WhatsAppDispatchService.dispatchQueued()).toMatchObject({ enabled: false, claimed: 0, sent: 0 });
  });
});

describe('WhatsApp Business Cloud API: sending from the queue', () => {
  it('marks a message SENT only once Meta has accepted it', async () => {
    const { customer } = await overdueCustomer();
    const dealer = (await repo.dealers.findById('dealer-1'))!;
    const fetchMock = connectCloudApi(() => ACCEPTED);

    const queued = await queueWhatsApp(customer.id);
    expect(queued.status).toBe(201);
    const id = queued.body.notification.id as string;

    // Queued, and nothing has been said to Meta yet.
    expect((await repo.notifications.findById(id))!.status).toBe('QUEUED');
    expect(fetchMock).not.toHaveBeenCalled();

    const result = await WhatsAppDispatchService.dispatchQueued();
    expect(result).toMatchObject({ enabled: true, claimed: 1, sent: 1, failed: 0, requeued: 0 });

    const after = (await repo.notifications.findById(id))!;
    expect(after.status).toBe('SENT');
    expect(after.sentAt).toBeTruthy();
    expect(after.leaseUntil).toBeUndefined();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://graph.facebook.com/v21.0/100000000000001/messages');
    const body = JSON.parse(init.body);
    expect(body.to).toBe(toWhatsAppNumber(customer.phone));
    expect(body.type).toBe('template');
    // The type's own approved template, not the default.
    expect(body.template.name).toBe('almas_overdue');
    expect(body.template.components[0].parameters.map((p: { text: string }) => p.text)).toEqual([
      customer.name,
      'Your installment of Rs. 5,000 is overdue.',
      `${dealer.name} — ${dealer.phone}`,
    ]);
  });

  it('does not send the same message twice', async () => {
    const { customer } = await overdueCustomer();
    const fetchMock = connectCloudApi(() => ACCEPTED);
    await queueWhatsApp(customer.id);

    await WhatsAppDispatchService.dispatchQueued();
    const again = await WhatsAppDispatchService.dispatchQueued();

    expect(again.claimed).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('leaves SMS alone — that queue belongs to the paired phone', async () => {
    const { customer } = await overdueCustomer();
    const fetchMock = connectCloudApi(() => ACCEPTED);

    const sms = await as(ACCOUNTS.dealerStaff).post('/api/notifications/send').send({
      customerId: customer.id, channel: 'SMS', type: 'PAYMENT_OVERDUE', title: 'Overdue', message: 'Pay please.',
    });
    await WhatsAppDispatchService.dispatchQueued();

    expect(fetchMock).not.toHaveBeenCalled();
    expect((await repo.notifications.findById(sms.body.notification.id))!.status).toBe('QUEUED');
  });

  it('keeps a message queued, with the reason, when Meta turns it down', async () => {
    const { customer } = await overdueCustomer();
    connectCloudApi(() => ({
      status: 400,
      body: { error: { message: '(#131026) Message undeliverable', code: 131026 } },
    }));
    const id = (await queueWhatsApp(customer.id)).body.notification.id as string;

    const result = await WhatsAppDispatchService.dispatchQueued();
    expect(result).toMatchObject({ sent: 0, requeued: 1 });
    expect(result.fatalError).toBeUndefined();

    const after = (await repo.notifications.findById(id))!;
    expect(after.status).toBe('QUEUED');
    expect(after.sentAt).toBeUndefined();
    expect(after.failureReason).toContain('131026');
  });

  it('gives up after five refusals rather than retrying for ever', async () => {
    const { customer } = await overdueCustomer();
    connectCloudApi(() => ({ status: 500, body: { error: { message: 'Internal error', code: 2 } } }));
    const id = (await queueWhatsApp(customer.id)).body.notification.id as string;

    for (let i = 0; i < 5; i++) await WhatsAppDispatchService.dispatchQueued();

    const after = (await repo.notifications.findById(id))!;
    expect(after.status).toBe('FAILED');
    expect(after.attempts).toBe(5);
    expect((await WhatsAppDispatchService.dispatchQueued()).claimed).toBe(0);
  });

  it('fails loudly on a bad token: stops, shouts, and marks nothing SENT', async () => {
    const { customer } = await overdueCustomer();
    const fetchMock = connectCloudApi(() => ({
      status: 401,
      body: { error: { message: 'Error validating access token: Session has expired', code: 190 } },
    }));
    const shout = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const first = (await queueWhatsApp(customer.id)).body.notification.id as string;
    const second = (await queueWhatsApp(customer.id, 'PAYMENT_DUE')).body.notification.id as string;

    const result = await WhatsAppDispatchService.dispatchQueued();

    expect(result.sent).toBe(0);
    expect(result.requeued).toBe(2);
    expect(result.fatalError).toContain('Session has expired');
    // One refusal is enough to know; the second message is not thrown at a dead token.
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const printed = shout.mock.calls.map((c) => String(c[0])).join('\n');
    expect(printed).toContain('DELIVERY IS FAILING');
    expect(printed).not.toContain('test-token-not-a-real-one');

    for (const id of [first, second]) {
      const row = (await repo.notifications.findById(id))!;
      expect(row.status).toBe('QUEUED');
      expect(row.failureReason).toContain('Session has expired');
      // Our fault, not the customer's: it does not cost the message a retry.
      expect(row.attempts ?? 0).toBe(0);
    }
  });

  it('fails a message whose customer has no usable number, without calling Meta', async () => {
    const { customer } = await overdueCustomer();
    const fetchMock = connectCloudApi(() => ACCEPTED);
    const id = (await queueWhatsApp(customer.id)).body.notification.id as string;
    await repo.customers.update(customer.id, { phone: '042-35761234' });

    const result = await WhatsAppDispatchService.dispatchQueued();

    expect(result.failed).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await repo.notifications.findById(id))!.status).toBe('FAILED');
  });
});

describe('automatic reminders on WhatsApp', () => {
  it('queues the overdue engine’s reminders on WhatsApp for a shop that chose it', async () => {
    connectCloudApi(() => ACCEPTED);

    const saved = await as(ACCOUNTS.dealerAdmin).put('/api/settings/policy').send({ reminderChannel: 'WHATSAPP' });
    expect(saved.status).toBe(200);

    await prisma.notification.deleteMany({});
    await OverdueEngine.runEvaluation();

    const mine = await repo.notifications.findMany({ where: { dealerId: 'dealer-1', type: 'PAYMENT_OVERDUE' } });
    const others = await repo.notifications.findMany({ where: { dealerId: 'dealer-2', type: 'PAYMENT_OVERDUE' } });

    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((n) => n.channel === 'WHATSAPP')).toBe(true);
    // A shop that did not choose it is untouched.
    expect(others.every((n) => n.channel === 'SMS')).toBe(true);
  });

  it('falls back to SMS if the credentials go away', async () => {
    connectCloudApi(() => ACCEPTED);
    await as(ACCOUNTS.dealerAdmin).put('/api/settings/policy').send({ reminderChannel: 'WHATSAPP' });
    WhatsAppDispatchService.setProviderForTests(null);

    await prisma.notification.deleteMany({});
    await OverdueEngine.runEvaluation();

    const mine = await repo.notifications.findMany({ where: { dealerId: 'dealer-1', type: 'PAYMENT_OVERDUE' } });
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((n) => n.channel === 'SMS')).toBe(true);
  });
});
