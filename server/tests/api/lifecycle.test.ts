import { describe, it, expect, beforeEach } from 'vitest';

import { as, reseed, db, ACCOUNTS } from '../helpers.js';
import { Customer, Device, InstallmentPlan, Installment, Payment } from '../../src/types/index.js';

beforeEach(() => {
  reseed();
});

/** 15 digits with a valid Luhn checksum — the schema rejects anything else. */
const IMEI = '359871080012348';

const registration = {
  customer: {
    name: 'Lifecycle Test Customer',
    phone: '0300-1112233',
    cnic: '35202-1234567-1',
    address: 'House 1, Test Street, Model Town, Lahore',
    emergencyContactName: 'Lifecycle Contact',
    emergencyContactPhone: '0300-4445566',
  },
  device: {
    brand: 'Samsung',
    model: 'Galaxy A16',
    imei: IMEI,
    purchasePrice: 60_000,
  },
  plan: {
    downPayment: 12_000,
    totalInstallments: 6,
    firstDueDate: '2026-09-20',
    gracePeriodDays: 3,
  },
};

async function register() {
  const res = await as(ACCOUNTS.dealerStaff).post('/api/customers').send(registration);
  expect(res.status).toBeLessThan(300);
  return res;
}

function created() {
  const customer = db.findOne<Customer>('customers', (c) => c.name === registration.customer.name)!;
  const device = db.findOne<Device>('devices', (d) => d.imei === IMEI)!;
  const plan = db.findOne<InstallmentPlan>('installmentPlans', (p) => p.deviceId === device.id)!;
  const installments = db
    .find<Installment>('installments', (i) => i.planId === plan.id)
    .sort((a, b) => a.installmentNumber - b.installmentNumber);
  return { customer, device, plan, installments };
}

describe('registration', () => {
  it('creates the customer, the device and a balanced schedule in one call', async () => {
    await register();
    const { customer, device, plan, installments } = created();

    expect(customer.dealerId).toBe('dealer-1');
    expect(device.customerId).toBe(customer.id);

    expect(plan.financedAmount).toBe(48_000);
    expect(installments).toHaveLength(6);
    expect(installments.reduce((s, i) => s + i.amountDue, 0)).toBe(48_000);
    expect(plan.remainingBalance).toBe(48_000);
  });

  it('dates the installments monthly from the first due date', async () => {
    await register();
    const { installments } = created();

    expect(installments.map((i) => i.dueDate)).toEqual([
      '2026-09-20', '2026-10-20', '2026-11-20',
      '2026-12-20', '2027-01-20', '2027-02-20',
    ]);
    expect(installments[0].graceDate).toBe('2026-09-23');
  });

  it('rejects a duplicate CNIC within the same dealership', async () => {
    await register();

    const res = await as(ACCOUNTS.dealerStaff).post('/api/customers').send({
      customer: { ...registration.customer, name: 'Different Name', phone: '0300-9998877' },
    });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/CNIC/i);
  });

  it('rejects a duplicate phone number within the same dealership', async () => {
    await register();

    const res = await as(ACCOUNTS.dealerStaff).post('/api/customers').send({
      customer: { ...registration.customer, name: 'Different Name', cnic: '35202-7654321-9' },
    });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/phone/i);
  });

  it('rejects an IMEI already registered anywhere in the system', async () => {
    await register();

    const res = await as(ACCOUNTS.dealerStaff).post('/api/customers').send({
      customer: { ...registration.customer, name: 'Second Buyer', phone: '0300-9998877', cnic: '35202-7654321-9' },
      device: registration.device,
      plan: registration.plan,
    });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/IMEI/i);
  });

  it('rejects an IMEI that fails its checksum', async () => {
    const res = await as(ACCOUNTS.dealerStaff).post('/api/customers').send({
      ...registration,
      device: { ...registration.device, imei: '359871080012341' },
    });

    expect(res.status).toBe(422);
  });

  it('refuses a device without a financing plan', async () => {
    const res = await as(ACCOUNTS.dealerStaff).post('/api/customers').send({
      customer: registration.customer,
      device: registration.device,
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/financing plan is required/i);
  });
});

describe('payment lifecycle over the API', () => {
  it('takes a plan from registration to fully paid', async () => {
    await register();
    const { customer, plan, installments } = created();

    for (const inst of installments) {
      const res = await as(ACCOUNTS.dealerStaff).post('/api/payments').send({
        customerId: customer.id,
        installmentId: inst.id,
        amount: inst.amountDue,
        paymentMethod: 'CASH',
        referenceNumber: `LIFECYCLE-${inst.installmentNumber}`,
      });
      expect(res.status).toBeLessThan(300);
    }

    const final = db.findById<InstallmentPlan>('installmentPlans', plan.id)!;
    expect(final.status).toBe('COMPLETED');
    expect(final.remainingBalance).toBe(0);
    expect(final.paidInstallments).toBe(6);
    expect(final.closedAt).toBeTruthy();
  });

  it('produces a printable receipt showing the remaining balance', async () => {
    await register();
    const { customer, installments } = created();

    const paid = await as(ACCOUNTS.dealerStaff).post('/api/payments').send({
      customerId: customer.id,
      installmentId: installments[0].id,
      amount: installments[0].amountDue,
      paymentMethod: 'JAZZCASH',
      referenceNumber: 'LIFECYCLE-RECEIPT',
    });

    const paymentId = paid.body.payment?.id ?? paid.body.data?.payment?.id;
    expect(paymentId).toBeTruthy();

    const receipt = await as(ACCOUNTS.dealerStaff).get(`/api/payments/${paymentId}/receipt`);
    expect(receipt.status).toBe(200);
    expect(JSON.stringify(receipt.body)).toContain('LIFECYCLE-RECEIPT');
  });

  it('rejects a duplicate payment reference from a double-submit', async () => {
    await register();
    const { customer, installments } = created();

    const body = {
      customerId: customer.id,
      installmentId: installments[0].id,
      amount: 5_000,
      paymentMethod: 'CASH',
      referenceNumber: 'LIFECYCLE-DOUBLE-SUBMIT',
    };

    expect((await as(ACCOUNTS.dealerStaff).post('/api/payments').send(body)).status).toBeLessThan(300);
    expect((await as(ACCOUNTS.dealerStaff).post('/api/payments').send(body)).status).toBe(409);

    const recorded = db.find<Payment>('payments', (p) => p.referenceNumber === body.referenceNumber);
    expect(recorded).toHaveLength(1);
  });

  it('leaves the ledger balanced after a reversal', async () => {
    await register();
    const { customer, plan, installments } = created();

    const paid = await as(ACCOUNTS.dealerStaff).post('/api/payments').send({
      customerId: customer.id,
      installmentId: installments[0].id,
      amount: installments[0].amountDue,
      paymentMethod: 'BANK_TRANSFER',
      referenceNumber: 'LIFECYCLE-REVERSE',
    });
    const paymentId = paid.body.payment?.id ?? paid.body.data?.payment?.id;

    const reversal = await as(ACCOUNTS.dealerAdmin)
      .post(`/api/payments/${paymentId}/reverse`)
      .send({ reason: 'Cheque returned unpaid by the bank.' });

    expect(reversal.status).toBeLessThan(300);
    expect(db.findById<InstallmentPlan>('installmentPlans', plan.id)!.remainingBalance).toBe(48_000);
    expect(db.findById<Payment>('payments', paymentId)!.status).toBe('REFUNDED');
  });

  it('does not let counter staff reverse a payment', async () => {
    await register();
    const { customer, installments } = created();

    const paid = await as(ACCOUNTS.dealerStaff).post('/api/payments').send({
      customerId: customer.id,
      installmentId: installments[0].id,
      amount: 1_000,
      paymentMethod: 'CASH',
      referenceNumber: 'LIFECYCLE-STAFF-REVERSE',
    });
    const paymentId = paid.body.payment?.id ?? paid.body.data?.payment?.id;

    const res = await as(ACCOUNTS.dealerStaff)
      .post(`/api/payments/${paymentId}/reverse`)
      .send({ reason: 'Staff attempting a reversal.' });

    expect(res.status).toBe(403);
    expect(db.findById<Payment>('payments', paymentId)!.status).toBe('VERIFIED');
  });
});

describe('audit trail', () => {
  it('records the registration and the payment', async () => {
    await register();
    const { customer, installments } = created();

    await as(ACCOUNTS.dealerStaff).post('/api/payments').send({
      customerId: customer.id,
      installmentId: installments[0].id,
      amount: 1_000,
      paymentMethod: 'CASH',
      referenceNumber: 'LIFECYCLE-AUDIT',
    });

    const res = await as(ACCOUNTS.dealerAdmin).get('/api/audit-logs?limit=200');
    const actions = res.body.data.map((l: { action: string }) => l.action);

    expect(actions).toContain('CUSTOMER_CREATED');
    expect(actions).toContain('PAYMENT_VERIFIED');
  });
});
