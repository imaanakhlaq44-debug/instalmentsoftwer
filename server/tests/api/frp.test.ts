import { describe, it, expect, beforeEach, afterAll } from 'vitest';

import { as, anonymous, reseed, repo, ACCOUNTS } from '../helpers.js';
import { disconnectDatabase } from '../../src/db/prisma.js';
import { hashDeviceToken } from '../../src/utils/deviceToken.js';

const DEALER_GOOGLE_ID = '118223344556677889900';

beforeEach(async () => {
  await reseed();
}, 60_000);

afterAll(async () => {
  await disconnectDatabase();
});

/** An enrolled dealer-1 handset with a plan on it, and the credential it would hold. */
async function financedDevice() {
  const plan = (await repo.installmentPlans.findFirst({ dealerId: 'dealer-1', status: 'CURRENT' }))!;
  const token = 'frp-test-token-0123456789abcdefghijklmnop';
  await repo.devices.update(plan.deviceId, { status: 'ACTIVE', authTokenHash: hashDeviceToken(token) });
  return { plan, credential: `Device ${plan.deviceId}.${token}` };
}

async function setFrp(ids: unknown) {
  return as(ACCOUNTS.dealerAdmin).put('/api/settings/policy').send({ frpAccountIds: ids });
}

describe('PUT /api/settings/policy — frpAccountIds', () => {
  it('stores numeric Google account ids, de-duplicated', async () => {
    const res = await setFrp([DEALER_GOOGLE_ID, DEALER_GOOGLE_ID]);
    expect(res.status).toBe(200);
    expect(res.body.policy.frpAccountIds).toEqual([DEALER_GOOGLE_ID]);
  });

  it('rejects an email address, which would lock a wiped phone out for everyone', async () => {
    const res = await setFrp(['dealer@gmail.com']);
    expect(res.status).toBe(422);
    expect((await repo.devicePolicies.findByDealer('dealer-1'))?.frpAccountIds ?? []).toEqual([]);
  });

  it('records the change in the audit trail', async () => {
    await setFrp([DEALER_GOOGLE_ID]);
    const logs = await repo.auditLogs.findMany({ where: { dealerId: 'dealer-1' } });
    expect(logs.some((l) => /Factory Reset Protection/.test(l.details))).toBe(true);
  });

  it('is off by default', async () => {
    const res = await as(ACCOUNTS.dealerAdmin).get('/api/settings');
    expect(res.body.policy.frpAccountIds ?? []).toEqual([]);
  });
});

describe('DPC policy view — frpAccountIds', () => {
  it('sends the dealer accounts to a handset that still owes money', async () => {
    await setFrp([DEALER_GOOGLE_ID]);
    const { credential } = await financedDevice();

    const res = await anonymous().get('/api/dpc/policy').set('Authorization', credential);
    expect(res.status).toBe(200);
    expect(res.body.policy.frpAccountIds).toEqual([DEALER_GOOGLE_ID]);
  });

  it('sends none once the plan is paid off, so the phone drops the protection', async () => {
    await setFrp([DEALER_GOOGLE_ID]);
    const { plan, credential } = await financedDevice();
    for (const inst of await repo.installments.findByPlan(plan.id)) {
      await repo.installments.update(inst.id, { status: 'PAID', amountPaid: inst.amountDue });
    }

    const res = await anonymous().get('/api/dpc/policy').set('Authorization', credential);
    expect(res.body.policy.frpAccountIds).toEqual([]);
  });

  it('sends none when the dealer has not configured it', async () => {
    const { credential } = await financedDevice();
    const res = await anonymous().get('/api/dpc/policy').set('Authorization', credential);
    expect(res.body.policy.frpAccountIds).toEqual([]);
  });
});
