import { Router } from 'express';
import { z } from 'zod';

import { db } from '../db/db.js';
import { AuditLog, DeviceActionLog, Device } from '../types/index.js';
import { requireDealerAdmin, getAuthUser, resolveDealerScope, assertDealerAccess } from '../middleware/auth.js';
import { validateQuery, getQuery } from '../middleware/validate.js';
import { paginationSchema, paginate } from '../utils/validators.js';

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

auditRouter.get('/', validateQuery(listQuerySchema), (req, res) => {
  const user = getAuthUser(req);
  const scope = resolveDealerScope(req);
  const q = getQuery<z.infer<typeof listQuerySchema>>(req);

  let logs = db.find<AuditLog>('auditLogs', (l) => {
    // System-wide entries (no dealerId) belong to the super admin's view only.
    if (scope !== null && l.dealerId !== scope) return false;
    if (scope === null && user.role !== 'SUPER_ADMIN') return false;
    if (q.targetType && q.targetType !== 'ALL' && l.targetType !== q.targetType) return false;
    if (q.action && q.action !== 'ALL' && l.action !== q.action) return false;
    if (q.userId && l.userId !== q.userId) return false;
    if (q.from && l.createdAt < q.from) return false;
    if (q.to && l.createdAt > `${q.to}T23:59:59.999Z`) return false;
    return true;
  });

  if (q.search) {
    const needle = q.search.toLowerCase();
    logs = logs.filter(
      (l) =>
        l.actorName.toLowerCase().includes(needle) ||
        l.action.toLowerCase().includes(needle) ||
        l.details.toLowerCase().includes(needle)
    );
  }

  logs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const page = paginate(logs, { page: q.page, limit: q.limit });

  res.json({
    ...page,
    // Powers the filter dropdowns without a second round trip.
    facets: {
      actions: [...new Set(logs.map((l) => l.action))].sort(),
      targetTypes: [...new Set(logs.map((l) => l.targetType))].sort(),
    },
  });
});

const deviceActionsQuerySchema = paginationSchema.extend({
  deviceId: z.string().trim().max(64).optional(),
  action: z.string().trim().max(30).optional(),
  dealerId: z.string().trim().max(64).optional(),
});

auditRouter.get('/device-actions', validateQuery(deviceActionsQuerySchema), (req, res) => {
  const scope = resolveDealerScope(req);
  const q = getQuery<z.infer<typeof deviceActionsQuerySchema>>(req);

  if (q.deviceId) {
    const device = db.findById<Device>('devices', q.deviceId);
    if (device) assertDealerAccess(req, device.dealerId, 'device');
  }

  const logs = db.find<DeviceActionLog>('deviceActionLogs', (l) => {
    if (scope !== null && l.dealerId !== scope) return false;
    if (q.deviceId && l.deviceId !== q.deviceId) return false;
    if (q.action && q.action !== 'ALL' && l.action !== q.action) return false;
    return true;
  });

  logs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  res.json(paginate(logs, { page: q.page, limit: q.limit }));
});
