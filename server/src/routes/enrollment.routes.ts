import { Router } from 'express';
import { z } from 'zod';

import { db } from '../db/db.js';
import { EnrollmentToken, Device, Customer } from '../types/index.js';
import { EnrollmentService } from '../services/EnrollmentService.js';
import {
  requireDealerStaff, getAuthUser, resolveDealerScope, resolveWritableDealerId,
  assertDealerAccess, clientIp,
  routeParam,
} from '../middleware/auth.js';
import { validateBody, validateQuery, getQuery } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { AppError } from '../utils/AppError.js';
import { paginationSchema, paginate } from '../utils/validators.js';

export const enrollmentRouter = Router();

// Enrollment is a counter operation; customers have no business here.
enrollmentRouter.use(requireDealerStaff);

const listQuerySchema = paginationSchema.extend({
  status: z.string().trim().max(20).optional(),
  dealerId: z.string().trim().max(64).optional(),
});

enrollmentRouter.get('/tokens', validateQuery(listQuerySchema), (req, res) => {
  const scope = resolveDealerScope(req);
  const q = getQuery<z.infer<typeof listQuerySchema>>(req);

  const devicesById = db.indexBy<Device>('devices', (d) => d.id);
  const customersById = db.indexBy<Customer>('customers', (c) => c.id);
  const now = new Date();

  const tokens = db.find<EnrollmentToken>('enrollmentTokens', (t) => {
    if (scope !== null && t.dealerId !== scope) return false;
    if (q.status && q.status !== 'ALL' && t.status !== q.status) return false;
    return true;
  });

  tokens.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const page = paginate(tokens, { page: q.page, limit: q.limit });

  const enriched = page.data.map((t) => {
    const device = t.deviceId ? devicesById.get(t.deviceId) : undefined;
    const customer = t.customerId ? customersById.get(t.customerId) : undefined;
    const expired = new Date(t.expiresAt) < now;

    return {
      ...t,
      // The token string is the credential. Once it has been used or has
      // expired there is no reason to keep echoing it back to the browser.
      token: t.status === 'WAITING' && !expired ? t.token : undefined,
      deviceInfo: device ? `${device.brand} ${device.model}` : 'Unassigned',
      deviceStatus: device?.status ?? 'N/A',
      customerName: customer?.name ?? 'Unassigned',
      isExpired: expired,
      minutesRemaining: expired ? 0 : Math.max(0, Math.round((new Date(t.expiresAt).getTime() - now.getTime()) / 60000)),
    };
  });

  res.json({ ...page, data: enriched });
});

const generateSchema = z.object({
  dealerId: z.string().trim().max(64).optional(),
  deviceId: z.string().trim().max(64).optional(),
  customerId: z.string().trim().max(64).optional(),
  qrType: z.enum(['STANDARD', 'PRO', 'LEGACY', 'QC']).default('STANDARD'),
  expiresInMinutes: z.number().int().min(5).max(1440).default(60),
});

enrollmentRouter.post('/generate', validateBody(generateSchema), (req, res) => {
  const user = getAuthUser(req);
  const body = req.body as z.infer<typeof generateSchema>;
  const dealerId = resolveWritableDealerId(req, body.dealerId);

  if (body.deviceId) {
    const device = db.findById<Device>('devices', body.deviceId);
    if (!device) throw AppError.notFound('Device');
    assertDealerAccess(req, device.dealerId, 'device');
  }

  const token = EnrollmentService.generateToken({
    dealerId,
    deviceId: body.deviceId,
    customerId: body.customerId,
    qrType: body.qrType,
    expiresInMinutes: body.expiresInMinutes,
    actor: { userId: user.userId, userName: user.name, userRole: user.role },
    ipAddress: clientIp(req),
  });

  res.status(201).json({
    success: true,
    token,
    qrPayloadString: EnrollmentService.buildQrPayload(token),
  });
});

const verifySchema = z.object({
  token: z.string().trim().min(8, 'Enrollment code is required.').max(120),
  deviceId: z.string().trim().max(64).optional(),
});

enrollmentRouter.post(
  '/verify',
  validateBody(verifySchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof verifySchema>;
    const result = await EnrollmentService.verifyAndEnroll({
      token: body.token,
      deviceId: body.deviceId,
      ipAddress: clientIp(req),
    });
    res.json(result);
  })
);

/** Invalidate a printed QR that should no longer work. */
enrollmentRouter.post('/tokens/:id/revoke', (req, res) => {
  const token = db.findById<EnrollmentToken>('enrollmentTokens', routeParam(req, 'id'));
  if (!token) throw AppError.notFound('Enrollment token');
  assertDealerAccess(req, token.dealerId, 'enrollment token');

  if (token.status === 'ENROLLED') {
    throw AppError.badRequest('This token has already been used and cannot be revoked.');
  }

  db.update<EnrollmentToken>('enrollmentTokens', token.id, { status: 'EXPIRED' });
  res.json({ success: true, message: 'Enrollment code revoked.' });
});
