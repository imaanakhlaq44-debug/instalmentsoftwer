import { describe, it, expect, beforeEach, afterAll } from 'vitest';

import { repo } from '../../src/db/repositories/index.js';
import { disconnectDatabase } from '../../src/db/prisma.js';
import { resetAndSeedPostgres } from '../../src/db/seedPostgres.js';
import { PaymentService, PaymentActor } from '../../src/services/PaymentService.js';
import {
  Installment, InstallmentPlan, Payment, Transaction, Device,
} from '../../src/types/index.js';

const actor: PaymentActor = {
  userId: 'user-dealer-admin-1',
  userName: 'Tariq Mehmood',
  userRole: 'DEALER_ADMIN',
  ipAddress: '127.0.0.1',
};

/**
 * Seeded fixtures used throughout. plan-1 finances Rs. 40,500 over six 6,750
 * installments, of which the first two are already paid.
 */
const PLAN = 'plan-1';
const CUSTOMER = 'cust-1';
const DEALER = 'dealer-1';
const MONTHLY = 6_750;

let ref = 0;
const uniqueRef = () => `TEST-REF-${++ref}`;

function installments(planId = PLAN): Promise<Installment[]> {
  return repo.installments.findByPlan(planId);
}

async function plan(planId = PLAN): Promise<InstallmentPlan> {
  return (await repo.installmentPlans.findById(planId))!;
}

beforeEach(async () => {
  await resetAndSeedPostgres();
}, 60_000);

afterAll(async () => {
  await disconnectDatabase();
});

describe('recordPayment — allocation', () => {
  it('settles the next unpaid installment and reduces the plan balance', async () => {
    const before = (await plan()).remainingBalance;

    const outcome = await PaymentService.recordPayment({
      dealerId: DEALER,
      customerId: CUSTOMER,
      planId: PLAN,
      amount: MONTHLY,
      paymentMethod: 'CASH',
      referenceNumber: uniqueRef(),
      actor,
    });

    expect(outcome.allocations).toHaveLength(1);
    expect(outcome.allocations[0].installmentNumber).toBe(3);
    expect(outcome.allocations[0].nowFullyPaid).toBe(true);
    expect((await installments())[2].status).toBe('PAID');
    expect((await plan()).remainingBalance).toBe(before - MONTHLY);
    expect((await plan()).paidInstallments).toBe(3);
  });

  it('spreads a lump sum across several installments oldest-first', async () => {
    const outcome = await PaymentService.recordPayment({
      dealerId: DEALER,
      customerId: CUSTOMER,
      planId: PLAN,
      amount: MONTHLY * 3,
      paymentMethod: 'BANK_TRANSFER',
      referenceNumber: uniqueRef(),
      actor,
    });

    expect(outcome.allocations.map((a) => a.installmentNumber)).toEqual([3, 4, 5]);
    expect(outcome.allocations.every((a) => a.nowFullyPaid)).toBe(true);
    expect((await plan()).paidInstallments).toBe(5);
  });

  it('applies a targeted installment before the oldest one', async () => {
    const target = (await installments())[4]; // #5, out of due order

    const outcome = await PaymentService.recordPayment({
      dealerId: DEALER,
      customerId: CUSTOMER,
      installmentId: target.id,
      amount: MONTHLY,
      paymentMethod: 'CASH',
      referenceNumber: uniqueRef(),
      actor,
    });

    expect(outcome.allocations[0].installmentNumber).toBe(5);
    expect((await installments())[4].status).toBe('PAID');
    expect((await installments())[2].status).not.toBe('PAID'); // #3 deliberately untouched
  });

  it('records a partial payment without marking the installment paid', async () => {
    const outcome = await PaymentService.recordPayment({
      dealerId: DEALER,
      customerId: CUSTOMER,
      planId: PLAN,
      amount: 2_000,
      paymentMethod: 'CASH',
      referenceNumber: uniqueRef(),
      actor,
    });

    expect(outcome.allocations[0].nowFullyPaid).toBe(false);
    expect((await installments())[2].amountPaid).toBe(2_000);
    expect((await installments())[2].status).not.toBe('PAID');
  });

  it('leaves the paid date on an already-settled installment alone', async () => {
    const paidAtBefore = (await installments())[0].paidAt;

    await PaymentService.recordPayment({
      dealerId: DEALER,
      customerId: CUSTOMER,
      planId: PLAN,
      amount: 500,
      paymentMethod: 'CASH',
      referenceNumber: uniqueRef(),
      actor,
    });

    expect((await installments())[0].paidAt).toBe(paidAtBefore);
  });
});

describe('recordPayment — late fees', () => {
  beforeEach(async () => {
    await repo.installments.update('inst-1-3', { lateFee: 500, lateFeePaid: 0, status: 'OVERDUE' });
  });

  it('settles the outstanding late fee before any principal', async () => {
    await PaymentService.recordPayment({
      dealerId: DEALER,
      customerId: CUSTOMER,
      planId: PLAN,
      amount: 1_000,
      paymentMethod: 'CASH',
      referenceNumber: uniqueRef(),
      actor,
    });

    const inst = (await repo.installments.findById('inst-1-3'))!;
    expect(inst.lateFeePaid).toBe(500);
    expect(inst.amountPaid).toBe(500);
  });

  it('writes a separate LATE_FEE ledger entry for the fee portion', async () => {
    const outcome = await PaymentService.recordPayment({
      dealerId: DEALER,
      customerId: CUSTOMER,
      planId: PLAN,
      amount: 1_000,
      paymentMethod: 'CASH',
      referenceNumber: uniqueRef(),
      actor,
    });

    const feeTx = await repo.transactions.findFirst({ paymentId: outcome.payment.id, type: 'LATE_FEE' });
    expect(feeTx?.amount).toBe(500);
    expect((await repo.payments.findById(outcome.payment.id))!.lateFeePortion).toBe(500);
  });

  it('does not mark an installment paid while its late fee is outstanding', async () => {
    await PaymentService.recordPayment({
      dealerId: DEALER,
      customerId: CUSTOMER,
      installmentId: 'inst-1-3',
      amount: MONTHLY,
      paymentMethod: 'CASH',
      referenceNumber: uniqueRef(),
      actor,
    });

    const inst = (await repo.installments.findById('inst-1-3'))!;
    expect(inst.lateFeePaid).toBe(500);
    expect(inst.amountPaid).toBe(MONTHLY - 500);
    expect(inst.status).not.toBe('PAID');
  });
});

describe('recordPayment — overpayment', () => {
  it('carries the excess forward as advance credit instead of losing it', async () => {
    // 4 unpaid installments remain (27,000); pay 30,000.
    const outcome = await PaymentService.recordPayment({
      dealerId: DEALER,
      customerId: CUSTOMER,
      planId: PLAN,
      amount: 30_000,
      paymentMethod: 'BANK_TRANSFER',
      referenceNumber: uniqueRef(),
      actor,
    });

    expect(outcome.creditBalanceAdded).toBe(30_000 - MONTHLY * 4);
    expect((await plan()).creditBalance).toBe(3_000);
    expect((await plan()).status).toBe('COMPLETED');
    expect((await plan()).remainingBalance).toBe(0);
  });

  it('spends existing credit on the next payment', async () => {
    await repo.installmentPlans.update(PLAN, { creditBalance: 750 });

    const outcome = await PaymentService.recordPayment({
      dealerId: DEALER,
      customerId: CUSTOMER,
      planId: PLAN,
      amount: MONTHLY - 750,
      paymentMethod: 'CASH',
      referenceNumber: uniqueRef(),
      actor,
    });

    // The 750 already on the plan plus 6,000 cash settles installment #3 in full.
    expect(outcome.allocations[0].nowFullyPaid).toBe(true);
    expect((await plan()).creditBalance).toBe(0);
  });

  it('records a standalone payment when the customer has no plan to allocate to', async () => {
    // The seed rotates 25 devices over 20 customers, so cust-1 owns two plans.
    for (const p of await repo.installmentPlans.findByCustomer(CUSTOMER)) {
      await repo.installmentPlans.update(p.id, { status: 'CANCELLED' });
    }

    const outcome = await PaymentService.recordPayment({
      dealerId: DEALER,
      customerId: CUSTOMER,
      amount: 5_000,
      paymentMethod: 'CASH',
      referenceNumber: uniqueRef(),
      actor,
    });

    expect(outcome.allocations).toHaveLength(0);
    expect(outcome.payment.planId).toBeUndefined();
  });
});

describe('recordPayment — guards', () => {
  it('rejects a zero or negative amount', async () => {
    await expect(
      PaymentService.recordPayment({
        dealerId: DEALER, customerId: CUSTOMER, planId: PLAN,
        amount: 0, paymentMethod: 'CASH', referenceNumber: uniqueRef(), actor,
      })
    ).rejects.toThrow(/greater than zero/i);
  });

  it('rejects a second payment carrying the same reference number', async () => {
    const duplicated = uniqueRef();
    const args = {
      dealerId: DEALER, customerId: CUSTOMER, planId: PLAN,
      amount: 1_000, paymentMethod: 'CASH' as const, referenceNumber: duplicated, actor,
    };

    await PaymentService.recordPayment(args);
    await expect(PaymentService.recordPayment(args)).rejects.toThrow(/already exists/i);
  });

  it('rejects a payment against another customer\'s plan', async () => {
    await expect(
      PaymentService.recordPayment({
        dealerId: DEALER, customerId: 'cust-2', planId: PLAN,
        amount: 1_000, paymentMethod: 'CASH', referenceNumber: uniqueRef(), actor,
      })
    ).rejects.toThrow(/does not belong to the selected customer/i);
  });

  it('rejects a payment against a cancelled plan', async () => {
    await repo.installmentPlans.update(PLAN, { status: 'CANCELLED' });

    await expect(
      PaymentService.recordPayment({
        dealerId: DEALER, customerId: CUSTOMER, planId: PLAN,
        amount: 1_000, paymentMethod: 'CASH', referenceNumber: uniqueRef(), actor,
      })
    ).rejects.toThrow(/cancelled/i);
  });

  it('refuses to guess when the customer has more than one open plan', async () => {
    // cust-1 owns two devices in the seed rotation, hence two open plans.
    const open = await repo.installmentPlans.findOpenForCustomer(CUSTOMER);
    expect(open.length).toBeGreaterThan(1);

    await expect(
      PaymentService.recordPayment({
        dealerId: DEALER, customerId: CUSTOMER,
        amount: 1_000, paymentMethod: 'CASH', referenceNumber: uniqueRef(), actor,
      })
    ).rejects.toThrow(/more than one active financing plan/i);
  });
});

describe('verifyPayment', () => {
  it('holds an unverified payment out of the balance until it is verified', async () => {
    const before = (await plan()).remainingBalance;

    const outcome = await PaymentService.recordPayment({
      dealerId: DEALER, customerId: CUSTOMER, planId: PLAN,
      amount: MONTHLY, paymentMethod: 'BANK_TRANSFER', referenceNumber: uniqueRef(),
      autoVerify: false, actor,
    });

    expect(outcome.payment.status).toBe('PENDING');
    expect(outcome.payment.receiptNumber).toBeUndefined();
    expect(outcome.allocations).toHaveLength(0);
    expect((await plan()).remainingBalance).toBe(before);

    const verified = await PaymentService.verifyPayment(outcome.payment.id, actor);

    expect(verified.payment.status).toBe('VERIFIED');
    expect(verified.payment.receiptNumber).toMatch(/^RCP-\d{4}-\d{6}$/);
    expect((await plan()).remainingBalance).toBe(before - MONTHLY);
  });

  it('refuses to verify the same payment twice', async () => {
    const outcome = await PaymentService.recordPayment({
      dealerId: DEALER, customerId: CUSTOMER, planId: PLAN,
      amount: 1_000, paymentMethod: 'CASH', referenceNumber: uniqueRef(), actor,
    });

    await expect(PaymentService.verifyPayment(outcome.payment.id, actor))
      .rejects.toThrow(/already been verified/i);
  });
});

describe('reversePayment', () => {
  it('claws the money back off the installment and reopens it', async () => {
    const outcome = await PaymentService.recordPayment({
      dealerId: DEALER, customerId: CUSTOMER, planId: PLAN,
      amount: MONTHLY, paymentMethod: 'BANK_TRANSFER', referenceNumber: uniqueRef(), actor,
    });
    const balanceAfterPayment = (await plan()).remainingBalance;

    await PaymentService.reversePayment({
      paymentId: outcome.payment.id,
      reason: 'Cheque bounced.',
      actor,
    });

    expect((await plan()).remainingBalance).toBe(balanceAfterPayment + MONTHLY);
    expect((await installments())[2].status).toBe('PENDING');
    expect((await installments())[2].amountPaid).toBe(0);
    expect((await repo.payments.findById(outcome.payment.id))!.status).toBe('REFUNDED');
  });

  it('leaves a contra-entry in the ledger rather than deleting the original', async () => {
    const outcome = await PaymentService.recordPayment({
      dealerId: DEALER, customerId: CUSTOMER, planId: PLAN,
      amount: MONTHLY, paymentMethod: 'BANK_TRANSFER', referenceNumber: uniqueRef(), actor,
    });

    await PaymentService.reversePayment({
      paymentId: outcome.payment.id, reason: 'Mis-keyed amount.', actor,
    });

    const reversal = await repo.transactions.findFirst({ paymentId: outcome.payment.id, type: 'REVERSAL' });
    expect(reversal?.amount).toBe(-MONTHLY);

    const original = await repo.transactions.findFirst({
      paymentId: outcome.payment.id,
      type: 'MONTHLY_INSTALLMENT',
    });
    expect(original?.status).toBe('REVERSED');
  });

  it('takes back the advance credit before touching installments', async () => {
    const outcome = await PaymentService.recordPayment({
      dealerId: DEALER, customerId: CUSTOMER, planId: PLAN,
      amount: 30_000, paymentMethod: 'BANK_TRANSFER', referenceNumber: uniqueRef(), actor,
    });
    expect((await plan()).creditBalance).toBe(3_000);

    await PaymentService.reversePayment({
      paymentId: outcome.payment.id, reason: 'Transfer recalled.', actor,
    });

    expect((await plan()).creditBalance).toBe(0);
    expect((await plan()).remainingBalance).toBe(MONTHLY * 4);
  });

  it('cancels an unverified payment without touching any balance', async () => {
    const before = (await plan()).remainingBalance;
    const outcome = await PaymentService.recordPayment({
      dealerId: DEALER, customerId: CUSTOMER, planId: PLAN,
      amount: MONTHLY, paymentMethod: 'BANK_TRANSFER', referenceNumber: uniqueRef(),
      autoVerify: false, actor,
    });

    const result = await PaymentService.reversePayment({
      paymentId: outcome.payment.id, reason: 'Entered against the wrong customer.', actor,
    });

    expect(result.message).toMatch(/cancelled/i);
    expect((await repo.payments.findById(outcome.payment.id))!.status).toBe('FAILED');
    expect((await plan()).remainingBalance).toBe(before);
  });

  it('refuses to reverse the same payment twice', async () => {
    const outcome = await PaymentService.recordPayment({
      dealerId: DEALER, customerId: CUSTOMER, planId: PLAN,
      amount: 1_000, paymentMethod: 'CASH', referenceNumber: uniqueRef(), actor,
    });
    await PaymentService.reversePayment({ paymentId: outcome.payment.id, reason: 'x', actor });

    await expect(PaymentService.reversePayment({ paymentId: outcome.payment.id, reason: 'y', actor }))
      .rejects.toThrow(/already been reversed/i);
  });
});

describe('auto-unlock on settlement', () => {
  it('clears the OVERDUE flag once nothing on the plan is overdue', async () => {
    // plan-2 / dev-2: one installment paid, installment #2 overdue, device OVERDUE.
    const device = (await repo.devices.findById('dev-2'))!;
    expect(device.status).toBe('OVERDUE');

    const overdue = (await repo.installments.findById('inst-2-2'))!;

    const outcome = await PaymentService.recordPayment({
      dealerId: DEALER,
      customerId: device.customerId!,
      installmentId: overdue.id,
      amount: overdue.amountDue,
      paymentMethod: 'JAZZCASH',
      referenceNumber: uniqueRef(),
      actor,
    });

    expect(outcome.unlockTriggered).toBe(true);
    const after = (await repo.devices.findById('dev-2'))!;
    expect(after.status).toBe('ACTIVE');
    expect(after.lockReason).toBeUndefined();
  });

  it('leaves the device restricted while another installment is still overdue', async () => {
    await repo.installments.update('inst-2-3', { status: 'OVERDUE' });
    const overdue = (await repo.installments.findById('inst-2-2'))!;

    const outcome = await PaymentService.recordPayment({
      dealerId: DEALER,
      customerId: 'cust-2',
      installmentId: overdue.id,
      amount: overdue.amountDue,
      paymentMethod: 'JAZZCASH',
      referenceNumber: uniqueRef(),
      actor,
    });

    expect(outcome.unlockTriggered).toBe(false);
    expect((await repo.devices.findById('dev-2'))!.status).toBe('OVERDUE');
  });
});

/**
 * These could not be written against the JSON store: `db.batch` ran the writes
 * and flushed, with no rollback, so a payment that failed part-way left the
 * ledger holding rows for money nobody received.
 */
describe('atomicity', () => {
  it('leaves nothing behind when the payment is rejected', async () => {
    const paymentsBefore = await repo.payments.count();
    const transactionsBefore = await repo.transactions.count();
    const notificationsBefore = await repo.notifications.count();

    await expect(
      PaymentService.recordPayment({
        dealerId: DEALER,
        customerId: 'cust-2', // does not own PLAN — rejected mid-transaction
        planId: PLAN,
        amount: MONTHLY,
        paymentMethod: 'CASH',
        referenceNumber: uniqueRef(),
        actor,
      })
    ).rejects.toThrow();

    expect(await repo.payments.count()).toBe(paymentsBefore);
    expect(await repo.transactions.count()).toBe(transactionsBefore);
    expect(await repo.notifications.count()).toBe(notificationsBefore);
  });

  it('does not record a payment row for a rejected duplicate reference', async () => {
    const duplicated = uniqueRef();
    const args = {
      dealerId: DEALER, customerId: CUSTOMER, planId: PLAN,
      amount: 1_000, paymentMethod: 'CASH' as const, referenceNumber: duplicated, actor,
    };

    await PaymentService.recordPayment(args);
    const after = await repo.payments.count();

    await expect(PaymentService.recordPayment(args)).rejects.toThrow(/already exists/i);

    expect(await repo.payments.count()).toBe(after);
    expect(await repo.payments.findMany({ where: { referenceNumber: duplicated } })).toHaveLength(1);
  });

  it('does not touch installment balances when the plan is cancelled', async () => {
    await repo.installmentPlans.update(PLAN, { status: 'CANCELLED' });
    const before = (await installments()).map((i) => i.amountPaid);

    await expect(
      PaymentService.recordPayment({
        dealerId: DEALER, customerId: CUSTOMER, planId: PLAN,
        amount: MONTHLY, paymentMethod: 'CASH', referenceNumber: uniqueRef(), actor,
      })
    ).rejects.toThrow(/cancelled/i);

    expect((await installments()).map((i) => i.amountPaid)).toEqual(before);
  });

  it('is stopped by the database when two payments share a reference', async () => {
    // The application check is a courtesy; the unique index on
    // (dealer, reference) is what actually holds under concurrency.
    const shared = uniqueRef();

    await expect(
      repo.payments.createMany([
        {
          id: 'race-a', dealerId: DEALER, customerId: CUSTOMER, amount: 100,
          paymentMethod: 'CASH', referenceNumber: shared, status: 'VERIFIED',
          createdAt: new Date().toISOString(),
        },
        {
          id: 'race-b', dealerId: DEALER, customerId: CUSTOMER, amount: 100,
          paymentMethod: 'CASH', referenceNumber: shared, status: 'VERIFIED',
          createdAt: new Date().toISOString(),
        },
      ])
    ).rejects.toThrow();

    expect(await repo.payments.findMany({ where: { referenceNumber: shared } })).toHaveLength(0);
  });
});

describe('receipt numbering', () => {
  it('issues sequential receipt numbers per dealer', async () => {
    const first = await PaymentService.recordPayment({
      dealerId: DEALER, customerId: CUSTOMER, planId: PLAN,
      amount: 1_000, paymentMethod: 'CASH', referenceNumber: uniqueRef(), actor,
    });
    const second = await PaymentService.recordPayment({
      dealerId: DEALER, customerId: CUSTOMER, planId: PLAN,
      amount: 1_000, paymentMethod: 'CASH', referenceNumber: uniqueRef(), actor,
    });

    const n = (r?: string) => Number(r!.split('-')[2]);
    expect(n(second.payment.receiptNumber)).toBe(n(first.payment.receiptNumber) + 1);
  });
});
