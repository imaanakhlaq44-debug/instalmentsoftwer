import { Router, Request } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';

import { repo, indexBy } from '../db/repositories/index.js';
import {
  Dealer, HandsetTest, HandsetTestOverall, HandsetTestSteps, HANDSET_TEST_STEPS,
} from '../types/index.js';
import { AuditService } from '../services/AuditService.js';
import {
  requireDealerStaff, requireSuperAdmin, getAuthUser, resolveDealerScope, clientIp, routeParam,
} from '../middleware/auth.js';
import { validateBody, validateQuery, getQuery } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { AppError } from '../utils/AppError.js';
import { paginationSchema, pageEnvelope } from '../utils/validators.js';

/**
 * Handset compatibility tests.
 *
 * The lock app is only as good as the phones it has actually been run on, so
 * this is where a person at a counter writes down what happened on one: nine
 * steps, each pass, fail or not tested, with a note. A shop records its own; the
 * platform sees all of them and decides which are fit to show the public.
 */
export const handsetTestsRouter = Router();

// Counter work — customers have no business here.
handsetTestsRouter.use(requireDealerStaff);

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

const stepSchema = z.object({
  result: z.enum(['PASS', 'FAIL', 'NOT_TESTED']),
  notes: z.string().trim().max(500).optional(),
});

/** Exactly the nine steps: a missing one is an error, an unknown one is dropped. */
const stepsSchema = z.object(
  Object.fromEntries(HANDSET_TEST_STEPS.map((key) => [key, stepSchema])) as Record<
    (typeof HANDSET_TEST_STEPS)[number],
    typeof stepSchema
  >
);

const handsetFields = {
  brand: z.string().trim().min(1, 'Brand is required.').max(60),
  model: z.string().trim().min(1, 'Model is required.').max(80),
  androidVersion: z
    .string()
    .trim()
    .regex(/^\d{1,2}(\.\d{1,2}){0,2}$/, 'Android version must look like 13 or 8.1.'),
  oemBuild: z.string().trim().max(120).optional(),
  dpcVersion: z
    .string()
    .trim()
    .regex(/^v?\d+\.\d+(\.\d+)?$/, 'App version must look like 1.5.1.')
    .transform((v) => v.replace(/^v/, '')),
  steps: stepsSchema,
  notes: z.string().trim().max(1000).optional(),
  testedAt: z
    .string()
    .datetime({ offset: true })
    .refine((v) => new Date(v).getTime() <= Date.now() + 5 * 60_000, 'The test date cannot be in the future.')
    .optional(),
};

const createSchema = z.object({
  ...handsetFields,
  /** Super admin only: file the record under a shop. Omitted = the platform's own test. */
  dealerId: z.string().trim().min(1).max(64).optional(),
});

const updateSchema = z.object(handsetFields).partial();

const listQuerySchema = paginationSchema.extend({
  brand: z.string().trim().max(60).optional(),
  androidVersion: z.string().trim().max(20).optional(),
  published: z.enum(['true', 'false']).optional(),
  dealerId: z.string().trim().max(64).optional(),
});

/**
 * One verdict for the whole phone.
 *
 * Any failed step fails the phone. Every step passing is a pass. Anything in
 * between — some passed, some never run — is PARTIAL, which is deliberately not
 * a pass: a phone nobody rebooted has not been shown to stay locked.
 */
export function overallResultOf(steps: HandsetTestSteps): HandsetTestOverall {
  const results = HANDSET_TEST_STEPS.map((key) => steps[key].result);
  if (results.includes('FAIL')) return 'FAIL';
  if (results.every((r) => r === 'PASS')) return 'PASS';
  if (results.every((r) => r === 'NOT_TESTED')) return 'NOT_TESTED';
  return 'PARTIAL';
}

/** Empty notes are not stored at all, so the row carries no `"notes": ""`. */
function cleanSteps(steps: HandsetTestSteps): HandsetTestSteps {
  const out = {} as HandsetTestSteps;
  for (const key of HANDSET_TEST_STEPS) {
    const { result, notes } = steps[key];
    out[key] = notes ? { result, notes } : { result };
  }
  return out;
}

/**
 * Looks a record up and hides it from anyone outside its shop.
 *
 * Not `assertDealerAccess` alone, because a platform test has no dealer and
 * must stay invisible to every shop; a 404 either way, never a 403.
 */
async function findVisible(req: Request): Promise<HandsetTest> {
  const user = getAuthUser(req);
  const record = await repo.handsetTests.findById(routeParam(req, 'id'));
  if (!record) throw AppError.notFound('Handset test');
  if (user.role !== 'SUPER_ADMIN' && (!record.dealerId || record.dealerId !== user.dealerId)) {
    throw AppError.notFound('Handset test');
  }
  return record;
}

const label = (r: Pick<HandsetTest, 'brand' | 'model' | 'androidVersion'>) =>
  `${r.brand} ${r.model} (Android ${r.androidVersion})`;

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/** The results table. A shop sees its own records; a super admin sees all. */
handsetTestsRouter.get(
  '/',
  validateQuery(listQuerySchema),
  asyncHandler(async (req, res) => {
    const q = getQuery<z.infer<typeof listQuerySchema>>(req);
    const scope = resolveDealerScope(req);

    const [page, facets] = await Promise.all([
      repo.handsetTests.list({
        dealerId: scope,
        brand: q.brand || undefined,
        androidVersion: q.androidVersion || undefined,
        published: q.published === undefined ? undefined : q.published === 'true',
        page: q.page,
        limit: q.limit,
      }),
      repo.handsetTests.facets(scope),
    ]);

    const dealerIds = [...new Set(page.data.map((r) => r.dealerId).filter((id): id is string => Boolean(id)))];
    const dealersById = indexBy<Dealer>(await repo.dealers.findByIds(dealerIds), (d) => d.id);

    const rows = page.data.map((r) => ({
      ...r,
      dealerName: r.dealerId ? dealersById.get(r.dealerId)?.name ?? 'Unknown dealer' : null,
    }));

    res.json({ ...pageEnvelope(rows, page, q.limit), facets, steps: HANDSET_TEST_STEPS });
  })
);

handsetTestsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json(await findVisible(req));
  })
);

/** Records one tested phone. Who and which shop come from the session. */
handsetTestsRouter.post(
  '/',
  validateBody(createSchema),
  asyncHandler(async (req, res) => {
    const user = getAuthUser(req);
    const body = req.body as z.infer<typeof createSchema>;

    let dealerId: string | undefined;
    if (user.role === 'SUPER_ADMIN') {
      if (body.dealerId) {
        if (!(await repo.dealers.findById(body.dealerId))) throw AppError.notFound(`Dealer ${body.dealerId}`);
        dealerId = body.dealerId;
      }
    } else {
      if (!user.dealerId) throw AppError.forbidden('Your account is not linked to any dealer.');
      if (body.dealerId && body.dealerId !== user.dealerId) {
        throw AppError.forbidden('You cannot create records for another dealer.');
      }
      dealerId = user.dealerId;
    }

    const steps = cleanSteps(body.steps);
    const now = new Date().toISOString();

    const record = await repo.handsetTests.create({
      id: `htest-${uuidv4().substring(0, 12)}`,
      dealerId,
      brand: body.brand,
      model: body.model,
      androidVersion: body.androidVersion,
      oemBuild: body.oemBuild || undefined,
      dpcVersion: body.dpcVersion,
      steps,
      overallResult: overallResultOf(steps),
      notes: body.notes || undefined,
      testedById: user.userId,
      testedByName: user.name,
      testedAt: body.testedAt ? new Date(body.testedAt).toISOString() : now,
      // Never from the body: publishing is the platform's decision alone.
      published: false,
      createdAt: now,
      updatedAt: now,
    });

    await AuditService.log({
      dealerId,
      userId: user.userId,
      actorName: user.name,
      actorRole: user.role,
      action: 'HANDSET_TEST_RECORDED',
      targetType: 'HANDSET_TEST',
      targetId: record.id,
      details: `Recorded a handset test for ${label(record)} on app v${record.dpcVersion}: ${record.overallResult}.`,
      ipAddress: clientIp(req),
    });

    res.status(201).json(record);
  })
);

/**
 * Corrects a record.
 *
 * A super admin may correct anything. A shop may correct its own records — an
 * owner any of them, staff only the ones they filed — and only until the
 * platform publishes one: after that the public list rests on it, and changing
 * what it says is no longer the shop's call.
 */
handsetTestsRouter.patch(
  '/:id',
  validateBody(updateSchema),
  asyncHandler(async (req, res) => {
    const user = getAuthUser(req);
    const body = req.body as z.infer<typeof updateSchema>;
    const record = await findVisible(req);

    if (user.role !== 'SUPER_ADMIN') {
      if (record.published) {
        throw AppError.forbidden('This record is published. Ask Almas SDM support to change it.');
      }
      if (user.role === 'DEALER_STAFF' && record.testedById !== user.userId) {
        throw AppError.forbidden('You can only edit handset tests you recorded yourself.');
      }
    }

    const updates: Partial<HandsetTest> = { updatedAt: new Date().toISOString() };
    if (body.brand !== undefined) updates.brand = body.brand;
    if (body.model !== undefined) updates.model = body.model;
    if (body.androidVersion !== undefined) updates.androidVersion = body.androidVersion;
    if (body.dpcVersion !== undefined) updates.dpcVersion = body.dpcVersion;
    if ('oemBuild' in body) updates.oemBuild = body.oemBuild || undefined;
    if ('notes' in body) updates.notes = body.notes || undefined;
    if (body.testedAt !== undefined) updates.testedAt = new Date(body.testedAt).toISOString();
    if (body.steps !== undefined) {
      updates.steps = cleanSteps(body.steps);
      updates.overallResult = overallResultOf(updates.steps);
      // A published record that no longer has anything to show comes off the
      // public list rather than appearing there as "not tested".
      if (record.published && updates.overallResult === 'NOT_TESTED') {
        updates.published = false;
        updates.publishedAt = undefined;
      }
    }

    const updated = await repo.handsetTests.update(record.id, updates);
    if (!updated) throw AppError.notFound('Handset test');

    await AuditService.log({
      dealerId: record.dealerId,
      userId: user.userId,
      actorName: user.name,
      actorRole: user.role,
      action: 'HANDSET_TEST_UPDATED',
      targetType: 'HANDSET_TEST',
      targetId: record.id,
      details: `Updated the handset test for ${label(updated)}: ${updated.overallResult}.`,
      ipAddress: clientIp(req),
    });

    res.json(updated);
  })
);

const publishSchema = z.object({ published: z.boolean() });

/**
 * Puts a record on, or takes it off, the public "tested phones" list.
 *
 * Super admin only: the list is the platform vouching for a phone in public,
 * and a shop must not be able to vouch on its behalf.
 */
handsetTestsRouter.patch(
  '/:id/publish',
  requireSuperAdmin,
  validateBody(publishSchema),
  asyncHandler(async (req, res) => {
    const user = getAuthUser(req);
    const { published } = req.body as z.infer<typeof publishSchema>;
    const record = await findVisible(req);

    if (published && record.overallResult === 'NOT_TESTED') {
      throw AppError.badRequest('This record has no tested steps yet, so there is nothing to publish.');
    }

    const updated = await repo.handsetTests.update(record.id, {
      published,
      publishedAt: published ? record.publishedAt ?? new Date().toISOString() : undefined,
      updatedAt: new Date().toISOString(),
    });
    if (!updated) throw AppError.notFound('Handset test');

    if (published !== record.published) {
      await AuditService.log({
        dealerId: record.dealerId,
        userId: user.userId,
        actorName: user.name,
        actorRole: user.role,
        action: published ? 'HANDSET_TEST_PUBLISHED' : 'HANDSET_TEST_UNPUBLISHED',
        targetType: 'HANDSET_TEST',
        targetId: record.id,
        details: `${published ? 'Published' : 'Unpublished'} the handset test for ${label(record)} (${record.overallResult}).`,
        ipAddress: clientIp(req),
      });
    }

    res.json(updated);
  })
);

handsetTestsRouter.delete(
  '/:id',
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const user = getAuthUser(req);
    const record = await findVisible(req);
    await repo.handsetTests.delete(record.id);

    await AuditService.log({
      dealerId: record.dealerId,
      userId: user.userId,
      actorName: user.name,
      actorRole: user.role,
      action: 'HANDSET_TEST_DELETED',
      targetType: 'HANDSET_TEST',
      targetId: record.id,
      details: `Deleted the handset test for ${label(record)} recorded by ${record.testedByName}.`,
      ipAddress: clientIp(req),
    });

    res.json({ message: 'Handset test deleted.' });
  })
);

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

/**
 * The public "tested phones" list, for the marketing site.
 *
 * No session, read-only, and only what the platform chose to publish: brand,
 * model, Android version and the overall verdict. Nothing about which shop or
 * which person ran the test leaves the server — the repository selects those
 * four columns and no others.
 *
 * The site lives on a different origin from the API, and this data is public by
 * definition, so the route answers any origin instead of joining the
 * dashboard's allow-list. It is mounted ahead of that CORS check for the same
 * reason.
 */
export const publicTestedPhonesRouter = Router();

publicTestedPhonesRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const rows = await repo.handsetTests.findPublished();

    // Two published tests of the same phone on the same Android are one line
    // to a reader. A failure anywhere wins: the list must not hide one.
    const rank: Record<HandsetTestOverall, number> = { FAIL: 3, PARTIAL: 2, PASS: 1, NOT_TESTED: 0 };
    const byPhone = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      const key = `${row.brand}|${row.model}|${row.androidVersion}`.toLowerCase();
      const seen = byPhone.get(key);
      if (!seen || rank[row.overallResult] > rank[seen.overallResult]) byPhone.set(key, row);
    }

    res.set('Access-Control-Allow-Origin', '*');
    res.set('Cross-Origin-Resource-Policy', 'cross-origin');
    res.set('Cache-Control', 'public, max-age=300');
    res.json({
      phones: [...byPhone.values()].map((r) => ({
        brand: r.brand,
        model: r.model,
        androidVersion: r.androidVersion,
        overallResult: r.overallResult,
      })),
    });
  })
);
