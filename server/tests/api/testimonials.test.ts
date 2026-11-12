import { describe, it, expect, beforeEach, afterAll } from 'vitest';

import { as, anonymous, reseed, repo, ACCOUNTS } from '../helpers.js';
import { prisma, disconnectDatabase } from '../../src/db/prisma.js';
import { TESTIMONIAL_CONSENT_TEXT } from '../../src/routes/testimonials.routes.js';

beforeEach(async () => {
  await reseed();
}, 60_000);

afterAll(async () => {
  await disconnectDatabase();
});

// Test fixtures only. These are not real shops' words and exist nowhere but here.
const feedback = {
  quote: 'Fixture quote for the test suite: the reminders go out on time.',
  rating: 5,
  displayName: 'Fixture Owner',
  city: 'Testabad',
  consent: true,
};
const urduFeedback = { ...feedback, quote: 'یہ صرف ٹیسٹ کے لیے لکھا گیا جملہ ہے، کسی دکان کا نہیں۔', rating: 4 };

const owner = () => as(ACCOUNTS.dealerAdmin);
const admin = () => as(ACCOUNTS.superAdmin);
const publicList = async () => (await anonymous().get('/api/public/testimonials')).body.testimonials as unknown[];

async function submit(body: Record<string, unknown> = feedback, account: string = ACCOUNTS.dealerAdmin) {
  const res = await as(account).put('/api/testimonials/mine').send(body);
  expect(res.status).toBe(200);
  return res.body.testimonial as { id: string; updatedAt: string; status: string };
}
const approve = (t: { id: string; updatedAt: string }) =>
  admin().post(`/api/testimonials/${t.id}/approve`).send({ seenUpdatedAt: t.updatedAt });

const auditActions = async () =>
  (await prisma.auditLog.findMany({ where: { targetType: 'Testimonial' }, orderBy: { createdAt: 'asc' } })).map((a) => a.action);

describe('the seeded database', () => {
  it('holds no testimonials: none are ever invented', async () => {
    expect(await prisma.testimonial.count()).toBe(0);
    expect(await publicList()).toEqual([]);
  });
});

describe('consent', () => {
  it.each([
    ['missing', undefined],
    ['false', false],
    ['the string "true"', 'true'],
    ['1', 1],
  ])('refuses a submission when consent is %s, and stores nothing', async (_label, consent) => {
    const res = await owner().put('/api/testimonials/mine').send({ ...feedback, consent });
    expect(res.status).toBe(422);
    expect(res.body.details.some((d: { field: string }) => d.field === 'consent')).toBe(true);
    expect(await prisma.testimonial.count()).toBe(0);
  });

  it('records the exact consent wording, who gave it and when', async () => {
    const shown = await owner().get('/api/testimonials/mine');
    expect(shown.body).toEqual({ testimonial: null, consentText: TESTIMONIAL_CONSENT_TEXT });

    const t = await submit();
    const row = await prisma.testimonial.findUniqueOrThrow({ where: { id: t.id } });
    expect(row.consentText).toBe(TESTIMONIAL_CONSENT_TEXT);
    expect(row.consentByUserId).toBe(ACCOUNTS.dealerAdmin);
    expect(Date.now() - row.consentAt.getTime()).toBeLessThan(60_000);
    expect(row.status).toBe('PENDING');
  });

  it('is the owner\'s to give: staff, customers and the platform cannot submit for a shop', async () => {
    for (const account of [ACCOUNTS.dealerStaff, ACCOUNTS.customer, ACCOUNTS.superAdmin]) {
      expect((await as(account).put('/api/testimonials/mine').send(feedback)).status).toBe(403);
    }
    expect((await anonymous().put('/api/testimonials/mine').send(feedback)).status).toBe(401);
    expect(await prisma.testimonial.count()).toBe(0);
  });

  it('validates the rating, the length and refuses links or markup', async () => {
    for (const bad of [
      { rating: 0 }, { rating: 6 }, { rating: 4.5 },
      { quote: 'too short' },
      { quote: 'Visit https://example.com for the best phones in town today' },
      { displayName: '<b>Owner</b>' },
    ]) {
      expect((await owner().put('/api/testimonials/mine').send({ ...feedback, ...bad })).status).toBe(422);
    }
  });

  it('detects Urdu script, and treats Roman Urdu as left-to-right', async () => {
    await submit(urduFeedback);
    expect((await owner().get('/api/testimonials/mine')).body.testimonial.language).toBe('ur');
    await submit({ ...feedback, quote: 'Yeh sirf test ke liye likha gaya jumla hai, kisi dukaan ka nahin.' });
    expect((await owner().get('/api/testimonials/mine')).body.testimonial.language).toBe('en');
  });
});

describe('approval', () => {
  it('publishes nothing until the platform approves', async () => {
    const t = await submit();
    expect(await publicList()).toEqual([]);

    expect((await approve(t)).status).toBe(200);
    expect(await publicList()).toHaveLength(1);
  });

  it('is the super admin\'s decision alone', async () => {
    const t = await submit();
    for (const account of [ACCOUNTS.dealerAdmin, ACCOUNTS.otherDealerAdmin, ACCOUNTS.dealerStaff, ACCOUNTS.customer]) {
      expect((await as(account).post(`/api/testimonials/${t.id}/approve`).send({ seenUpdatedAt: t.updatedAt })).status).toBe(403);
      expect((await as(account).get('/api/testimonials')).status).toBe(403);
    }
    expect(await publicList()).toEqual([]);
  });

  it('rejects with a note the shop can read, and keeps it off the site', async () => {
    const t = await submit();
    expect((await admin().post(`/api/testimonials/${t.id}/reject`).send({})).status).toBe(422);
    const res = await admin().post(`/api/testimonials/${t.id}/reject`).send({ note: 'Please fix the spelling of the city.' });
    expect(res.status).toBe(200);

    const mine = (await owner().get('/api/testimonials/mine')).body.testimonial;
    expect(mine).toMatchObject({ status: 'REJECTED', reviewNote: 'Please fix the spelling of the city.' });
    expect(await publicList()).toEqual([]);
  });

  it('unpublishes an approved one immediately', async () => {
    const t = await submit();
    await approve(t);
    const res = await admin().post(`/api/testimonials/${t.id}/unpublish`).send({ note: 'Shop asked by phone.' });
    expect(res.status).toBe(200);
    expect(await publicList()).toEqual([]);
    // Unpublish is for published feedback only.
    expect((await admin().post(`/api/testimonials/${t.id}/unpublish`).send({ note: 'again' })).status).toBe(409);
  });

  it('gives the platform no way to change a shop\'s words', async () => {
    const t = await submit();
    // Extra fields on a decision are dropped, not applied.
    await admin()
      .post(`/api/testimonials/${t.id}/approve`)
      .send({ seenUpdatedAt: t.updatedAt, quote: 'Rewritten by the platform, which must never work.', displayName: 'Someone Else', rating: 5 });
    for (const method of ['put', 'patch'] as const) {
      const res = await admin()[method](`/api/testimonials/${t.id}`).send({ quote: 'Rewritten by the platform, which must never work.' });
      expect(res.status).toBe(404);
    }
    const row = await prisma.testimonial.findUniqueOrThrow({ where: { id: t.id } });
    expect(row).toMatchObject({ quote: feedback.quote, displayName: feedback.displayName, city: feedback.city });
  });

  it('refuses to approve words the reviewer has not seen', async () => {
    const first = await submit();
    await submit({ ...feedback, quote: 'Fixture quote, edited by the shop after the reviewer opened it.' });

    const stale = await approve(first);
    expect(stale.status).toBe(409);
    expect(await publicList()).toEqual([]);
  });

  it('sends an edited testimonial back to review with a fresh consent', async () => {
    const t = await submit();
    await approve(t);
    expect(await publicList()).toHaveLength(1);

    const edited = await submit({ ...feedback, quote: 'Fixture quote, second version, written by the shop itself.' });
    expect(edited.status).toBe('PENDING');
    expect(await publicList()).toEqual([]);
  });
});

describe('withdrawal', () => {
  it('takes a published testimonial off the site at once', async () => {
    const t = await submit();
    await approve(t);

    const res = await owner().post('/api/testimonials/mine/withdraw');
    expect(res.status).toBe(200);
    expect(res.body.testimonial.status).toBe('WITHDRAWN');
    expect(await publicList()).toEqual([]);
  });

  it('cannot be overridden by the platform', async () => {
    const t = await submit();
    await approve(t);
    const withdrawn = (await owner().post('/api/testimonials/mine/withdraw')).body.testimonial;

    expect((await approve(withdrawn)).status).toBe(409);
    expect(await publicList()).toEqual([]);
  });

  it('is only the shop\'s own to withdraw', async () => {
    const t = await submit();
    await approve(t);
    expect((await as(ACCOUNTS.otherDealerAdmin).post('/api/testimonials/mine/withdraw')).status).toBe(404);
    expect((await as(ACCOUNTS.dealerStaff).post('/api/testimonials/mine/withdraw')).status).toBe(403);
    expect(await publicList()).toHaveLength(1);
  });

  it('lets the shop come back later by submitting again', async () => {
    await submit();
    await owner().post('/api/testimonials/mine/withdraw');
    const again = await submit();
    expect(again.status).toBe('PENDING');
    expect(await prisma.testimonial.count()).toBe(1);
  });
});

describe('GET /api/public/testimonials', () => {
  it('needs no sign-in and exposes exactly five fields', async () => {
    await approve(await submit(urduFeedback));
    await approve(await submit({ ...feedback, rating: 3 }, ACCOUNTS.otherDealerAdmin));

    const res = await anonymous().get('/api/public/testimonials');
    expect(res.status).toBe(200);
    expect(res.body.testimonials).toHaveLength(2);
    for (const t of res.body.testimonials) {
      expect(Object.keys(t).sort()).toEqual(['city', 'displayName', 'language', 'quote', 'rating']);
    }
    expect(res.body.testimonials).toContainEqual({
      quote: urduFeedback.quote, displayName: 'Fixture Owner', city: 'Testabad', rating: 4, language: 'ur',
    });
  });

  it('carries no shop id, shop name, email or phone number anywhere in the response', async () => {
    const t = await submit();
    await approve(t);

    const dealer = (await repo.dealers.findById('dealer-1'))!;
    const user = (await repo.users.findById(ACCOUNTS.dealerAdmin))!;
    const body = (await anonymous().get('/api/public/testimonials')).text;
    for (const secret of [dealer.id, dealer.name, dealer.email, dealer.phone, dealer.ownerName, user.email, user.id, t.id, TESTIMONIAL_CONSENT_TEXT]) {
      expect(body).not.toContain(secret);
    }
  });

  it('leaves out pending, rejected, unpublished and withdrawn ones', async () => {
    const mine = await submit();
    const theirs = await submit(feedback, ACCOUNTS.otherDealerAdmin);
    expect(await publicList()).toEqual([]);

    await admin().post(`/api/testimonials/${theirs.id}/reject`).send({ note: 'Not this time.' });
    await approve(mine);
    expect(await publicList()).toHaveLength(1);
  });

  it('drops a suspended shop\'s testimonial', async () => {
    await approve(await submit());
    await prisma.dealer.update({ where: { id: 'dealer-1' }, data: { active: false } });
    expect(await publicList()).toEqual([]);
  });

  it('is read-only', async () => {
    for (const method of ['post', 'put', 'patch', 'delete'] as const) {
      const res = await anonymous()[method]('/api/public/testimonials').send(feedback);
      expect(res.status).toBe(404);
    }
    expect(await prisma.testimonial.count()).toBe(0);
  });
});

describe('the audit trail', () => {
  it('records every step, with the words that were consented to', async () => {
    const t = await submit();
    await admin().post(`/api/testimonials/${t.id}/reject`).send({ note: 'Typo in the city.' });
    const fixed = await submit({ ...feedback, city: 'Testabad Cantt' });
    await approve(fixed);
    await admin().post(`/api/testimonials/${t.id}/unpublish`).send({ note: 'Checking with the shop.' });
    await owner().post('/api/testimonials/mine/withdraw');

    expect(await auditActions()).toEqual([
      'TESTIMONIAL_SUBMITTED',
      'TESTIMONIAL_REJECTED',
      'TESTIMONIAL_RESUBMITTED',
      'TESTIMONIAL_APPROVED',
      'TESTIMONIAL_UNPUBLISHED',
      'TESTIMONIAL_WITHDRAWN',
    ]);
    const first = await prisma.auditLog.findFirstOrThrow({ where: { action: 'TESTIMONIAL_SUBMITTED' } });
    expect(first.details).toContain(feedback.quote);
    expect(first.dealerId).toBe('dealer-1');
  });

  it('shows the review queue to the super admin with the shop it came from', async () => {
    await submit();
    const res = await admin().get('/api/testimonials');
    expect(res.status).toBe(200);
    expect(res.body.testimonials).toHaveLength(1);
    expect(res.body.testimonials[0]).toMatchObject({ dealerId: 'dealer-1', status: 'PENDING', quote: feedback.quote });
    expect(res.body.testimonials[0].dealerName).toBeTruthy();
  });
});
