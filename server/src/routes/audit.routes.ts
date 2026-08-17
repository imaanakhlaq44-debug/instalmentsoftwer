import { Router } from 'express';
import { z } from 'zod';

import { repo, dealerScope } from '../db/repositories/index.js';
import { requireDealerAdmin, getAuthUser, resolveDealerScope, assertDealerAccess } from '../middleware/auth.js';
import { validateQuery, getQuery } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { paginationSchema, pageEnvelope } from '../utils/validators.js';

export const auditRouter = Router();

// The audit trail records who locked whose phone — dealer admin and above only.
auditRouter.use(requireDealerAdmin);

const listQuerySchema = paginationSchema.extend({
  targetType: z.string().trim().max(40).optional(),
  action: z.string().trim().max(60).optional(),
  userId: z.string().trim().max(64).optional(),
  from: z.string().trim().max(30).optional(),
  to: z.string().trim().max(30).optional(),
  search: z.string().trim().max(120).optional(),
  dealerId: z.string().trim().max(64).optional(),
});

auditRouter.get(
  '/',
  validateQuery(listQuerySchema),
  asyncHandler(async (req, res) => {
    const user = getAuthUser(req);
    const scope = resolveDealerScope(req);
    const q = getQuery<z.infer<typeof listQuerySchema>>(req);

    // System-wide entries carry no dealerId and belong to the super admin's
    // view only; nobody else ever reaches an unscoped query.
    if (scope === null && user.role !== 'SUPER_ADMIN') {
      res.json({ ...pageEnvelope([], { total: 0, page: 1 }, q.limit), facets: { actions: [], targetTypes: [] } });
      return;
    }

    const filters = {
      dealerId: scope,
      targetType: q.targetType,
      action: q.action,
      userId: q.userId,
      search: q.search,
      from: q.from,
      to: q.to,
    };

    const [page, facets] = await Promise.all([
      repo.auditLogs.list({ ...filters, page: q.page, limit: q.limit }),
      // Powers the filter dropdowns without a second round trip from the client.
      repo.auditLogs.facets(repo.auditLogs.buildWhere(filters)),
    ]);

    res.json({ ...pageEnvelope(page.data, page, q.limit), facets });
  })
);

const deviceActionsQuerySchema = paginationSchema.extend({
  deviceId: z.string().trim().max(64).optional(),
  action: z.string().trim().max(30).optional(),
  dealerId: z.string().trim().max(64).optional(),
});

auditRouter.get(
  '/device-actions',
  validateQuery(deviceActionsQuerySchema),
  asyncHandler(async (req, res) => {
    const scope = resolveDealerScope(req);
    const q = getQuery<z.infer<typeof deviceActionsQuerySchema>>(req);

    if (q.deviceId) {
      const device = await repo.devices.findById(q.deviceId);
      if (device) assertDealerAccess(req, device.dealerId, 'device');
    }

    const where: Record<string, unknown> = { ...dealerScope(scope) };
    if (q.deviceId) where.deviceId = q.deviceId;
    if (q.action && q.action !== 'ALL') where.action = q.action;

    const page = await repo.deviceActionLogs.paginate({
      where,
      orderBy: { createdAt: 'desc' },
      page: q.page,
      limit: q.limit,
    });

    res.json(pageEnvelope(page.data, page, q.limit));
  })
);
