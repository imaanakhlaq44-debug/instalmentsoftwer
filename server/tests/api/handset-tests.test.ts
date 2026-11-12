import { describe, it, expect, beforeEach, afterAll } from 'vitest';

import { as, anonymous, reseed, repo, ACCOUNTS } from '../helpers.js';
import { disconnectDatabase } from '../../src/db/prisma.js';
import { overallResultOf } from '../../src/routes/handsetTests.routes.js';
import { HANDSET_TEST_STEPS, HandsetTestSteps, HandsetTestStepResult } from '../../src/types/index.js';

beforeEach(async () => {
  await reseed();
}, 60_000);

afterAll(async () => {
  await disconnectDatabase();
});

const URL = '/api/handset-tests';
const PUBLIC_URL = '/api/public/tested-phones';

/** Every step with one result, then individual steps overridden. */
function steps(
  all: HandsetTestStepResult,
  overrides: Partial<Record<(typeof HANDSET_TEST_STEPS)[number], HandsetTestStepResult>> = {}
): HandsetTestSteps {
  return Object.fromEntries(
    HANDSET_TEST_STEPS.map((key) => [key, { result: overrides[key] ?? all }])
  ) as HandsetTestSteps;
}

function payload(extra: Record<string, unknown> = {}) {
  return {
    brand: 'Samsung',
    model: 'Galaxy A15',
    androidVersion: '14',
    oemBuild: 'One UI 6.1',
    dpcVersion: '1.5.1',
    steps: steps('PASS'),
    ...extra,
  };
}

async function record(userId: string, extra: Record<string, unknown> = {}) {
  const res = await as(userId).post(URL).send(payload(extra));
  expect(res.status).toBe(201);
  return res.body as { id: string; dealerId?: string; overallResult: string; published: boolean };
}

describe('the overall verdict', () => {
  it('fails the phone if any step failed', () => {
    expect(overallResultOf(steps('PASS', { LOCK_AFTER_REBOOT: 'FAIL' }))).toBe('FAIL');
  });

  it('passes only when every step passed', () => {
    expect(overallResultOf(steps('PASS'))).toBe('PASS');
    expect(overallResultOf(steps('PASS', { RE_ENROL: 'NOT_TESTED' }))).toBe('PARTIAL');
  });

  it('is not tested when nothing was run', () => {
    expect(overallResultOf(steps('NOT_TESTED'))).toBe('NOT_TESTED');
  });
});

describe('recording a handset test', () => {
  it('lets staff record one for their own shop, stamped with who and when', async () => {
    const res = await as(ACCOUNTS.dealerStaff)
      .post(URL)
      .send(payload({ steps: { ...steps('PASS'), LOCK: { result: 'PASS', notes: '  Locked in 4 seconds  ' } } }));

    expect(res.status).toBe(201);
    expect(res.body.dealerId).toBe('dealer-1');
    expect(res.body.testedById).toBe(ACCOUNTS.dealerStaff);
    expect(res.body.testedByName).toBeTruthy();
    expect(new Date(res.body.testedAt).getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect(res.body.overallResult).toBe('PASS');
    expect(res.body.published).toBe(false);
    expect(res.body.steps.LOCK.notes).toBe('Locked in 4 seconds');

    const stored = await repo.handsetTests.findById(res.body.id);
    expect(stored?.steps.LOCK).toEqual({ result: 'PASS', notes: 'Locked in 4 seconds' });

    const audit = await repo.auditLogs.findFirst({ targetType: 'HANDSET_TEST', targetId: res.body.id });
    expect(audit?.action).toBe('HANDSET_TEST_RECORDED');
  });

  it('ignores a published flag or a tester name sent in the body', async () => {
    const res = await as(ACCOUNTS.dealerAdmin)
      .post(URL)
      .send(payload({ published: true, testedByName: 'Someone Else', overallResult: 'PASS', steps: steps('FAIL') }));

    expect(res.status).toBe(201);
    expect(res.body.published).toBe(false);
    expect(res.body.testedByName).not.toBe('Someone Else');
    expect(res.body.overallResult).toBe('FAIL');
  });

  it('refuses a shop filing a record under another shop', async () => {
    const res = await as(ACCOUNTS.dealerAdmin).post(URL).send(payload({ dealerId: 'dealer-2' }));
    expect(res.status).toBe(403);
  });

  it('lets a super admin record a platform test, or one for a named shop', async () => {
    const own = await record(ACCOUNTS.superAdmin);
    expect(own.dealerId).toBeUndefined();

    const forShop = await record(ACCOUNTS.superAdmin, { dealerId: 'dealer-2' });
    expect(forShop.dealerId).toBe('dealer-2');

    const missing = await as(ACCOUNTS.superAdmin).post(URL).send(payload({ dealerId: 'dealer-nope' }));
    expect(missing.status).toBe(404);
  });

  it('rejects a checklist with a step missing or an invalid result', async () => {
    const { RE_ENROL: _dropped, ...incomplete } = steps('PASS');
    const missing = await as(ACCOUNTS.dealerStaff).post(URL).send(payload({ steps: incomplete }));
    expect(missing.status).toBe(422);

    const invalid = await as(ACCOUNTS.dealerStaff)
      .post(URL)
      .send(payload({ steps: { ...steps('PASS'), LOCK: { result: 'MAYBE' } } }));
    expect(invalid.status).toBe(422);

    const badVersion = await as(ACCOUNTS.dealerStaff).post(URL).send(payload({ androidVersion: 'Tiramisu' }));
    expect(badVersion.status).toBe(422);
  });

  it('is closed to customers and to anyone not signed in', async () => {
    expect((await as(ACCOUNTS.customer).post(URL).send(payload())).status).toBe(403);
    expect((await as(ACCOUNTS.customer).get(URL)).status).toBe(403);
    expect((await anonymous().get(URL)).status).toBe(401);
    expect((await anonymous().post(URL).send(payload())).status).toBe(401);
  });
});

describe('who sees which records', () => {
  it('shows a shop only its own, and a super admin all of them', async () => {
    const mine = await record(ACCOUNTS.dealerStaff);
    const theirs = await record(ACCOUNTS.otherDealerAdmin, { brand: 'Infinix', model: 'Hot 40', androidVersion: '13' });
    const platform = await record(ACCOUNTS.superAdmin, { brand: 'Tecno', model: 'Spark 20', androidVersion: '13' });

    const shop = await as(ACCOUNTS.dealerAdmin).get(URL);
    expect(shop.status).toBe(200);
    expect(shop.body.data.map((r: { id: string }) => r.id)).toEqual([mine.id]);
    // The filter options must not reveal what other shops tested either.
    expect(shop.body.facets.brands).toEqual(['Samsung']);

    // Asking for another shop by query string changes nothing.
    const probe = await as(ACCOUNTS.dealerAdmin).get(`${URL}?dealerId=dealer-2`);
    expect(probe.body.data.map((r: { id: string }) => r.id)).toEqual([mine.id]);

    const all = await as(ACCOUNTS.superAdmin).get(URL);
    expect(all.body.data.map((r: { id: string }) => r.id).sort()).toEqual([mine.id, theirs.id, platform.id].sort());
    expect(all.body.facets.brands).toEqual(['Infinix', 'Samsung', 'Tecno']);

    const oneShop = await as(ACCOUNTS.superAdmin).get(`${URL}?dealerId=dealer-2`);
    expect(oneShop.body.data.map((r: { id: string }) => r.id)).toEqual([theirs.id]);
  });

  it('answers 404 for another shop\'s record and for a platform record', async () => {
    const theirs = await record(ACCOUNTS.otherDealerAdmin);
    const platform = await record(ACCOUNTS.superAdmin);

    expect((await as(ACCOUNTS.dealerAdmin).get(`${URL}/${theirs.id}`)).status).toBe(404);
    expect((await as(ACCOUNTS.dealerAdmin).get(`${URL}/${platform.id}`)).status).toBe(404);
    expect((await as(ACCOUNTS.dealerAdmin).patch(`${URL}/${theirs.id}`).send({ model: 'Hacked' })).status).toBe(404);
    expect((await as(ACCOUNTS.superAdmin).get(`${URL}/${theirs.id}`)).status).toBe(200);
  });

  it('filters by brand and by Android version', async () => {
    await record(ACCOUNTS.dealerStaff);
    await record(ACCOUNTS.dealerStaff, { brand: 'Samsung', model: 'Galaxy A05', androidVersion: '13' });
    await record(ACCOUNTS.dealerStaff, { brand: 'Vivo', model: 'Y17s', androidVersion: '13' });

    const samsung = await as(ACCOUNTS.dealerStaff).get(`${URL}?brand=samsung`);
    expect(samsung.body.pagination.total).toBe(2);

    const android13 = await as(ACCOUNTS.dealerStaff).get(`${URL}?androidVersion=13`);
    expect(android13.body.data.map((r: { model: string }) => r.model).sort()).toEqual(['Galaxy A05', 'Y17s']);

    const both = await as(ACCOUNTS.dealerStaff).get(`${URL}?brand=Samsung&androidVersion=13`);
    expect(both.body.data.map((r: { model: string }) => r.model)).toEqual(['Galaxy A05']);

    expect(both.body.facets.androidVersions).toEqual(['13', '14']);
  });
});

describe('correcting a record', () => {
  it('recomputes the verdict when the steps change', async () => {
    const rec = await record(ACCOUNTS.dealerStaff);
    const res = await as(ACCOUNTS.dealerStaff)
      .patch(`${URL}/${rec.id}`)
      .send({ steps: steps('PASS', { OFFLINE_SELF_LOCK: 'FAIL' }) });

    expect(res.status).toBe(200);
    expect(res.body.overallResult).toBe('FAIL');
  });

  it('lets staff edit only what they recorded, and the owner anything in the shop', async () => {
    const byAdmin = await record(ACCOUNTS.dealerAdmin);
    const byStaff = await record(ACCOUNTS.dealerStaff);

    expect((await as(ACCOUNTS.dealerStaff).patch(`${URL}/${byAdmin.id}`).send({ model: 'A16' })).status).toBe(403);
    expect((await as(ACCOUNTS.dealerAdmin).patch(`${URL}/${byStaff.id}`).send({ model: 'A16' })).status).toBe(200);
  });

  it('freezes a published record for the shop but not for the super admin', async () => {
    const rec = await record(ACCOUNTS.dealerAdmin);
    await as(ACCOUNTS.superAdmin).patch(`${URL}/${rec.id}/publish`).send({ published: true });

    expect((await as(ACCOUNTS.dealerAdmin).patch(`${URL}/${rec.id}`).send({ model: 'A16' })).status).toBe(403);
    expect((await as(ACCOUNTS.superAdmin).patch(`${URL}/${rec.id}`).send({ model: 'A16' })).status).toBe(200);
  });

  it('lets only a super admin delete', async () => {
    const rec = await record(ACCOUNTS.dealerAdmin);
    expect((await as(ACCOUNTS.dealerAdmin).delete(`${URL}/${rec.id}`)).status).toBe(403);
    expect((await as(ACCOUNTS.superAdmin).delete(`${URL}/${rec.id}`)).status).toBe(200);
    expect(await repo.handsetTests.findById(rec.id)).toBeUndefined();
  });
});

describe('publishing', () => {
  it('is for the super admin alone', async () => {
    const rec = await record(ACCOUNTS.dealerAdmin);

    expect((await as(ACCOUNTS.dealerAdmin).patch(`${URL}/${rec.id}/publish`).send({ published: true })).status).toBe(403);
    expect((await as(ACCOUNTS.dealerStaff).patch(`${URL}/${rec.id}/publish`).send({ published: true })).status).toBe(403);
    // And not through the ordinary edit route either.
    await as(ACCOUNTS.dealerAdmin).patch(`${URL}/${rec.id}`).send({ published: true });
    expect((await repo.handsetTests.findById(rec.id))?.published).toBe(false);

    const res = await as(ACCOUNTS.superAdmin).patch(`${URL}/${rec.id}/publish`).send({ published: true });
    expect(res.status).toBe(200);
    expect(res.body.published).toBe(true);
    expect(res.body.publishedAt).toBeTruthy();
  });

  it('refuses to publish a record with nothing tested', async () => {
    const rec = await record(ACCOUNTS.dealerAdmin, { steps: steps('NOT_TESTED') });
    const res = await as(ACCOUNTS.superAdmin).patch(`${URL}/${rec.id}/publish`).send({ published: true });
    expect(res.status).toBe(400);
  });

  it('can be undone', async () => {
    const rec = await record(ACCOUNTS.dealerAdmin);
    await as(ACCOUNTS.superAdmin).patch(`${URL}/${rec.id}/publish`).send({ published: true });
    const res = await as(ACCOUNTS.superAdmin).patch(`${URL}/${rec.id}/publish`).send({ published: false });

    expect(res.body.published).toBe(false);
    expect(res.body.publishedAt).toBeUndefined();
    expect((await anonymous().get(PUBLIC_URL)).body.phones).toEqual([]);
  });
});

describe('the public tested-phones list', () => {
  it('is empty, not invented, when nothing is published', async () => {
    await record(ACCOUNTS.dealerAdmin);
    const res = await anonymous().get(PUBLIC_URL);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ phones: [] });
  });

  it('returns only published records, and only four fields of each', async () => {
    const shown = await record(ACCOUNTS.dealerAdmin, {
      notes: 'Tested at the Hall Road counter',
      steps: steps('PASS', { RE_ENROL: 'NOT_TESTED' }),
    });
    await record(ACCOUNTS.otherDealerAdmin, { brand: 'Oppo', model: 'A18', androidVersion: '13' });
    await as(ACCOUNTS.superAdmin).patch(`${URL}/${shown.id}/publish`).send({ published: true });

    const res = await anonymous().get(PUBLIC_URL);

    expect(res.status).toBe(200);
    expect(res.body.phones).toEqual([
      { brand: 'Samsung', model: 'Galaxy A15', androidVersion: '14', overallResult: 'PARTIAL' },
    ]);
    // No shop, no person, no notes — anywhere in the response.
    expect(res.text).not.toMatch(/dealer|tested|notes|Hall Road|steps|htest-/i);
  });

  it('can be read from any origin, including one the dashboard would refuse', async () => {
    const res = await anonymous().get(PUBLIC_URL).set('Origin', 'https://almassdm.pro');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  it('is read-only', async () => {
    const res = await anonymous().post(PUBLIC_URL).send({ brand: 'Fake', model: 'Phone' });
    expect(res.status).toBe(404);
    expect(await repo.handsetTests.count()).toBe(0);
  });

  it('shows one line per phone, and never hides a failure behind a pass', async () => {
    const pass = await record(ACCOUNTS.dealerAdmin);
    const fail = await record(ACCOUNTS.otherDealerAdmin, { steps: steps('PASS', { UNLOCK: 'FAIL' }) });
    for (const r of [pass, fail]) {
      await as(ACCOUNTS.superAdmin).patch(`${URL}/${r.id}/publish`).send({ published: true });
    }

    const res = await anonymous().get(PUBLIC_URL);
    expect(res.body.phones).toEqual([
      { brand: 'Samsung', model: 'Galaxy A15', androidVersion: '14', overallResult: 'FAIL' },
    ]);
  });
});
